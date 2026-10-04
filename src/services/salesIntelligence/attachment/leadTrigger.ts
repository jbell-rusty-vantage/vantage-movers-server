import mongoose, { type ClientSession } from "mongoose";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { publishLeadAttachmentWakeup } from "../../numberActivity/webhookFanout";
import { CsiError } from "../auth";
import { enqueueCsiJob, type JobInput } from "../jobs";
import { leadAttachmentJobInput, loadLead } from "./sources";

/**
 * Lead → Contact Number / attachment trigger. A committed Lead EntityChange
 * (Form Lead or Call Lead create, a phone, contact-snapshot or official-flag
 * change, a Granot apply) nominates the Lead's `attachment-lead:` job, which
 * mints a Form Lead's Contact Number and re-evaluates the Lead's attachment
 * edges. Two paths raise the same job identity (`leadAttachmentJobInput`:
 * policy version + attachment fingerprint), so a duplicate event, a replayed
 * observation or a no-op change never creates redundant work:
 *
 * - fast: `wakeLeadAttachmentsAfterChange`, after a Granot lifecycle commit, and
 *   `wakeLeadAttachmentsAfterLeadCommand`, after a Form Lead create or correction commits;
 * - durable: `scanLeadChangesForAttachments`, a bounded `applied_at` cursor scan
 *   of `entity_changes` on the attachment-refresh cron. The `updatedAt`
 *   watermark in `refresh.ts` stays the last backstop.
 *
 * CSI never writes EntityChange.
 */
type LeadModel = "FormLead" | "CallLead";
type LeadChange = {
  _id: unknown;
  entity: { model: string; id: string };
  revision_before: number;
  changed_paths: readonly string[];
};

/** Lead paths whose change must re-evaluate the complete normalized-phone match set (H2, §5.2). */
const ATTACHMENT_TRIGGER_PATHS = new Set(["phone_number", "normalized_phone_number", "ingested_contact_snapshot", "granot_contact_snapshot", "ringcentral",
  "current_contact_provenance", "duplicate", "bad_lead", "no_sync", "booked", "cancelled", "timestamp"]);
export function changeTriggersAttachment(change: Pick<LeadChange, "revision_before" | "changed_paths">): boolean {
  return change.revision_before === 0 || change.changed_paths.some(path => ATTACHMENT_TRIGGER_PATHS.has(path) || ATTACHMENT_TRIGGER_PATHS.has(path.split(".")[0]!));
}
const isLeadModel = (model: string): model is LeadModel => model === "FormLead" || model === "CallLead";

/** The Lead's `attachment-lead:` job for one change, or null when the change cannot move an attachment. */
export async function leadChangeNomination(change: LeadChange, session: ClientSession): Promise<JobInput | null> {
  if (!isLeadModel(change.entity.model) || !changeTriggersAttachment(change)) return null;
  const lead = await loadLead({ model: change.entity.model, id: change.entity.id }, session);
  return lead ? leadAttachmentJobInput(change.entity.model, change.entity.id, lead) : null;
}

/** Cursor row of the durable scan in `sales_intelligence_sync_state`. */
export const LEAD_CHANGE_SCOPE = "attachment_entity_changes";
/** The commit-lag re-scan window: `applied_at` is taken before the transaction runs, so a change can commit after the cursor passed it. */
export const LEAD_CHANGE_RESCAN_MS = 120_000;
export const LEAD_CHANGE_PAGE = 100;

/**
 * One bounded pass of the durable trigger. Re-scans the trailing commit-lag window on every pass
 * (per-job dedupe makes a re-enqueue a no-op) and advances the strict `(applied_at, _id)` cursor only
 * from the page beyond it. A first pass starts the cursor at `now − LEAD_CHANGE_RESCAN_MS`; older
 * Leads are the watermark backstop's. A stored job whose payload disagrees with today's shape is
 * skipped and logged, so it never pins the cursor.
 */
export async function scanLeadChangesForAttachments(now = new Date()): Promise<{ scanned: number; nominated: number }> {
  return withTransaction(async session => {
    const State = getSalesIntelligenceSyncStateModel();
    const Change = getEntityChangeModel();
    const state = await State.findOne({ scope: LEAD_CHANGE_SCOPE }).session(session).lean();
    const zero = new mongoose.Types.ObjectId("000000000000000000000000");
    const at = state?.cursor?.entity_change_applied_at ?? new Date(+now - LEAD_CHANGE_RESCAN_MS);
    const id = state?.cursor?.entity_change_id ?? zero;
    const models = { $in: ["FormLead", "CallLead"] as LeadModel[] };
    const overlap = state ? await Change.find({ "entity.model": models, applied_at: { $gt: new Date(+at - LEAD_CHANGE_RESCAN_MS), $lte: at }, _id: { $ne: id } })
      .sort({ applied_at: 1, _id: 1 }).limit(500).session(session).lean() : [];
    const changes = await Change.find({ "entity.model": models, $or: [{ applied_at: { $gt: at } }, { applied_at: at, _id: { $gt: id } }] })
      .sort({ applied_at: 1, _id: 1 }).limit(LEAD_CHANGE_PAGE).session(session).lean();
    let nominated = 0;
    const conflicts: string[] = [];
    for (const change of [...overlap, ...changes]) {
      const nomination = await leadChangeNomination(change, session);
      if (!nomination) continue;
      try { await enqueueCsiJob(nomination, session, now); nominated++; }
      catch (error) {
        if (!(error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT")) throw error;
        conflicts.push(nomination.dedupe_key);
      }
    }
    const last = changes.at(-1);
    if (last || !state) {
      await State.updateOne({ scope: LEAD_CHANGE_SCOPE }, { $set: { "cursor.entity_change_applied_at": last?.applied_at ?? at,
        "cursor.entity_change_id": last?._id ?? id } }, { session, upsert: true });
    }
    if (conflicts.length) logger.warn({ msg: "sales_intelligence.attachment.lead_change_conflict_skipped", dedupe_keys: conflicts });
    return { scanned: overlap.length + changes.length, nominated };
  });
}

export type LeadAttachmentWakeDependencies = {
  enabled?: () => boolean;
  findLeadChanges?: (target: { model: LeadModel; id: string }, observationId: string) => Promise<LeadChange[]>;
  enqueue?: (change: LeadChange) => Promise<{ _id: unknown; status: string } | null>;
  publish?: (jobId: string) => Promise<unknown>;
};

/** A processed observation writes at most a handful of Lead EntityChanges (create, sync, booking). */
const WAKE_CHANGE_LIMIT = 10;

/**
 * Post-commit fast path after a Granot lifecycle apply. For each Lead EntityChange the observation
 * committed, enqueue the Lead's `attachment-lead:` job (the same identity the durable scan raises)
 * and publish one queue wake-up per runnable job. A replayed observation finds its job claimed or
 * completed and wakes nothing. Gated by `SALES_INTELLIGENCE_ATTACHMENT_REFRESH`. Failure is logged,
 * never thrown: a lost wake-up only waits for the durable scan.
 */
export async function wakeLeadAttachmentsAfterChange(
  result: { observation_id: string; target?: { model: string; id: string } },
  deps: LeadAttachmentWakeDependencies = {},
): Promise<{ job_ids: string[] }> {
  const job_ids: string[] = [];
  const target = result.target;
  if (!target || !isLeadModel(target.model)) return { job_ids };
  if (!(deps.enabled ?? (() => csiFlag("ATTACHMENT_REFRESH")))()) return { job_ids };
  try {
    const changes = deps.findLeadChanges
      ? await deps.findLeadChanges({ model: target.model, id: target.id }, result.observation_id)
      : await getEntityChangeModel().find({ "entity.model": target.model, "entity.id": target.id,
        "provenance.observation_id": new mongoose.Types.ObjectId(result.observation_id) })
        .select({ _id: 1, entity: 1, revision_before: 1, changed_paths: 1 }).sort({ applied_at: 1, _id: 1 }).limit(WAKE_CHANGE_LIMIT).lean();
    await enqueueAndWake(changes, deps, job_ids);
  } catch (error) {
    logWakeFailure(error);
  }
  return { job_ids };
}

/** Enqueues each change's `attachment-lead:` job and publishes one wake-up per runnable job. */
async function enqueueAndWake(changes: readonly LeadChange[], deps: LeadAttachmentWakeDependencies, job_ids: string[]): Promise<void> {
  const enqueue = deps.enqueue ?? ((change: LeadChange) => withTransaction(async session => {
    const nomination = await leadChangeNomination(change, session);
    return nomination ? enqueueCsiJob(nomination, session) : null;
  }));
  for (const change of changes) {
    const row = await enqueue(change);
    // A replay finds its job already claimed or completed: nothing to wake.
    if (!row || (row.status !== "pending" && row.status !== "retry") || job_ids.includes(String(row._id))) continue;
    job_ids.push(String(row._id));
    await (deps.publish ?? publishLeadAttachmentWakeup)(String(row._id));
  }
}

function logWakeFailure(error: unknown): void {
  logger.warn({
    msg: "sales_intelligence.attachment.lead_wakeup_failed",
    errorName: error instanceof Error ? error.name : "Error",
    errorCode: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : null,
  });
}

/** The longest a Lead command waits for its post-commit attachment wake-up before it returns. */
export const LEAD_COMMAND_WAKE_TIMEOUT_MS = 2_000;

export type LeadCommandWakeDependencies = Omit<LeadAttachmentWakeDependencies, "findLeadChanges"> & {
  /** Loads the committed EntityChanges by id (default: `entity_changes` by `_id`, scoped to the target). */
  findChangesById?: (target: { model: LeadModel; id: string }, changeIds: readonly string[]) => Promise<LeadChange[]>;
  timeoutMs?: number;
};

/**
 * Post-commit fast path after a Lead domain command (Form Lead create, Form Lead correction such as
 * a phone change). It reads the EntityChanges the command committed, by their preallocated ids, and
 * raises the same `attachment-lead:` job identity the durable Lead-change scan raises, so a duplicate
 * command, a replay or a change that cannot move an attachment enqueues and wakes nothing new.
 * Bounded by `timeoutMs` (the wake keeps running in the background after a timeout), gated by
 * `SALES_INTELLIGENCE_ATTACHMENT_REFRESH`, and never throws: a lost wake-up only waits for the scan.
 */
export async function wakeLeadAttachmentsAfterLeadCommand(
  input: { target: { model: string; id: string }; change_ids: readonly string[] },
  deps: LeadCommandWakeDependencies = {},
): Promise<{ job_ids: string[]; outcome: "done" | "timeout" | "skipped" }> {
  const job_ids: string[] = [];
  const target = input.target;
  if (!isLeadModel(target.model) || input.change_ids.length === 0) return { job_ids, outcome: "skipped" };
  const leadTarget = { model: target.model, id: target.id };
  try {
    if (!(deps.enabled ?? (() => csiFlag("ATTACHMENT_REFRESH")))()) return { job_ids, outcome: "skipped" };
  } catch (error) {
    logWakeFailure(error);
    return { job_ids, outcome: "skipped" };
  }
  const wake = (async () => {
    try {
      const ids = input.change_ids.slice(0, WAKE_CHANGE_LIMIT);
      const changes = deps.findChangesById
        ? await deps.findChangesById(leadTarget, ids)
        : await getEntityChangeModel().find({ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) },
          "entity.model": leadTarget.model, "entity.id": leadTarget.id })
          .select({ _id: 1, entity: 1, revision_before: 1, changed_paths: 1 }).sort({ applied_at: 1, _id: 1 }).lean();
      await enqueueAndWake(changes, deps, job_ids);
    } catch (error) {
      logWakeFailure(error);
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">(resolve => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, deps.timeoutMs ?? LEAD_COMMAND_WAKE_TIMEOUT_MS));
    timer.unref?.();
  });
  const outcome = await Promise.race([wake.then(() => "done" as const), timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === "timeout") {
    logger.warn({ msg: "sales_intelligence.attachment.lead_wakeup_timeout", leadModel: leadTarget.model });
  }
  return { job_ids: [...job_ids], outcome };
}
