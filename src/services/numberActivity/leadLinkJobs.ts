import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { withTransaction } from "../../db";
import { logger } from "../../logger";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { CsiError } from "../salesIntelligence/auth";
import { ensureFormLeadContactNumber } from "./formLeadNumber";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob, type JobInput } from "../salesIntelligence/jobs";
import { payloadHash } from "../salesIntelligence/transactions";
import { loadLeadRow, numbersForLead, recomputeLeadLink, type LeadLinkChange, type LeadModel, type LeadRow } from "./leadLink";
import { publishRunnableWakeups } from "./webhookFanout";

/**
 * Durable triggers of the All Numbers lead link (all-numbers CONTRACT §3 "Recompute triggers").
 *
 * A committed Lead EntityChange (create; a phone, contact snapshot, RingCentral identity, Duplicate,
 * Bad Lead, booking or cancellation stamp, name, Job Number or rep change) nominates the Lead's
 * `lead_link` job. The job mints a Form Lead's Contact Number (`FORM_LEAD_NUMBERS`) and recomputes the
 * link of every number the Lead can enter or leave (`numbersForLead`). Three paths raise the same job
 * identity (stage `lead_link`, key = Lead fingerprint), so a replayed observation, a duplicate event or
 * a change that moves nothing creates no redundant work:
 *
 * - fast: `wakeLeadLinksAfterChange` after a Granot lifecycle apply commits, and
 *   `wakeLeadLinksAfterLeadCommand` after a Form Lead create or correction commits;
 * - durable: `scanLeadChangesForLeadLinks`, a bounded `(applied_at, _id)` cursor scan of
 *   `entity_changes` that job recovery runs every minute (`runLeadLinkRecovery`).
 *
 * Capture recomputes a number inline (`persistInteraction.ts`); the Owner's commands and the v2
 * migration call `recomputeLeadLink` directly. Everything here is gated by `SALES_INTELLIGENCE_ENABLED`
 * (the Numbers switch); no other flag exists. This module never writes an EntityChange.
 */
export const LEAD_LINK_STAGE = "lead_link" as const;
export const LEAD_LINK_POLICY_VERSION = "lead-link-v1";

type LeadChange = { _id: unknown; entity: { model: string; id: string }; revision_before: number; changed_paths: readonly string[] };
const isLeadModel = (model: string): model is LeadModel => model === "FormLead" || model === "CallLead";

/** Lead paths whose change can move a number's link or its snapshot. */
const LEAD_LINK_PATHS = new Set(["phone_number", "normalized_phone_number", "ingested_contact_snapshot", "granot_contact_snapshot", "ringcentral",
  "current_contact_provenance", "duplicate", "bad_lead", "booked", "cancelled", "timestamp", "name", "job_no", "normalized_job_no",
  "receiver_agent", "receiver_agent_name_snapshot"]);
export function changeTriggersLeadLink(change: Pick<LeadChange, "revision_before" | "changed_paths">): boolean {
  return change.revision_before === 0 || change.changed_paths.some((path) => LEAD_LINK_PATHS.has(path) || LEAD_LINK_PATHS.has(path.split(".")[0]!));
}

/** Every Lead input the lead-link job can turn into a write; `updatedAt` is deliberately absent. */
export function leadLinkFingerprint(row: LeadRow): string {
  return payloadHash(JSON.parse(JSON.stringify({
    timestamp: row.timestamp ?? null, name: row.name ?? null, job_no: row.job_no ?? null,
    receiver_agent: row.receiver_agent ? String(row.receiver_agent) : null, receiver_agent_name: row.receiver_agent_name_snapshot ?? null,
    booked: Boolean(row.booked), cancelled: Boolean(row.cancelled), duplicate: row.duplicate === true, bad_lead: Boolean(row.bad_lead),
    live: row.normalized_phone_number ?? null, ingested: row.ingested_contact_snapshot?.normalized_phone_number ?? null,
    granot: row.granot_contact_snapshot?.normalized_phone_number ?? null,
    original_caller: row.ringcentral?.original_caller?.normalized_phone_number ?? null,
    telephony_session_id: row.ringcentral?.telephony_session_id ?? null,
  })));
}

export function leadLinkLeadJobInput(model: LeadModel, id: string, row: LeadRow): JobInput {
  const fingerprint = leadLinkFingerprint(row);
  return { stage: LEAD_LINK_STAGE, subject_key: `lead-link:lead:${model}:${id}`,
    dedupe_key: `csi:lead-link:${LEAD_LINK_POLICY_VERSION}:lead:${model}:${id}:${fingerprint}`,
    input_revision: parseInt(fingerprint.slice(0, 12), 16) + 1, input_refs: [id] };
}

/** A number job (the `reason` distinguishes the cause, so each cause runs once). */
export function leadLinkNumberJobInput(numberId: string, reason: string): JobInput {
  return { stage: LEAD_LINK_STAGE, subject_key: `lead-link:number:${numberId}`,
    dedupe_key: `csi:lead-link:${LEAD_LINK_POLICY_VERSION}:number:${numberId}:${reason}`, input_revision: 1, input_refs: [numberId] };
}

/** The Lead's `lead_link` job for one change, or null when the change cannot move a link. */
export async function leadLinkNomination(change: LeadChange, session: ClientSession): Promise<JobInput | null> {
  if (!isLeadModel(change.entity.model) || !changeTriggersLeadLink(change)) return null;
  const row = await loadLeadRow({ model: change.entity.model, id: change.entity.id }, session);
  return row ? leadLinkLeadJobInput(change.entity.model, change.entity.id, row) : null;
}

/** Cursor row of the durable scan in `sales_intelligence_sync_state`. */
export const LEAD_LINK_CHANGE_SCOPE = "lead_link_entity_changes";
/** `applied_at` is taken before the transaction runs, so a change can commit after the cursor passed it. */
export const LEAD_LINK_RESCAN_MS = 120_000;
export const LEAD_LINK_CHANGE_PAGE = 100;

/**
 * One bounded pass of the durable trigger: re-scans the trailing commit-lag window (a re-enqueue is a
 * no-op) and advances the strict `(applied_at, _id)` cursor from the page beyond it. A first pass starts
 * at `now − LEAD_LINK_RESCAN_MS`; older Leads are the migration's.
 */
export async function scanLeadChangesForLeadLinks(now = new Date()): Promise<{ scanned: number; nominated: number; job_ids: string[] }> {
  return withTransaction(async (session) => {
    const State = getSalesIntelligenceSyncStateModel();
    const Change = getEntityChangeModel();
    const state = await State.findOne({ scope: LEAD_LINK_CHANGE_SCOPE }).session(session).lean();
    const zero = new mongoose.Types.ObjectId("000000000000000000000000");
    const at = state?.cursor?.entity_change_applied_at ?? new Date(+now - LEAD_LINK_RESCAN_MS);
    const id = state?.cursor?.entity_change_id ?? zero;
    const models = { $in: ["FormLead", "CallLead"] as LeadModel[] };
    const overlap = state
      ? await Change.find({ "entity.model": models, applied_at: { $gt: new Date(+at - LEAD_LINK_RESCAN_MS), $lte: at }, _id: { $ne: id } })
        .sort({ applied_at: 1, _id: 1 }).limit(500).session(session).lean()
      : [];
    const changes = await Change.find({ "entity.model": models, $or: [{ applied_at: { $gt: at } }, { applied_at: at, _id: { $gt: id } }] })
      .sort({ applied_at: 1, _id: 1 }).limit(LEAD_LINK_CHANGE_PAGE).session(session).lean();
    const job_ids: string[] = [];
    const conflicts: string[] = [];
    for (const change of [...overlap, ...changes]) {
      const nomination = await leadLinkNomination(change, session);
      if (!nomination) continue;
      try {
        const row = await enqueueCsiJob(nomination, session, now);
        if ((row.status === "pending" || row.status === "retry") && !job_ids.includes(String(row._id))) job_ids.push(String(row._id));
      } catch (error) {
        if (!(error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT")) throw error;
        conflicts.push(nomination.dedupe_key);
      }
    }
    const last = changes.at(-1);
    if (last || !state) {
      await State.updateOne({ scope: LEAD_LINK_CHANGE_SCOPE }, { $set: { "cursor.entity_change_applied_at": last?.applied_at ?? at,
        "cursor.entity_change_id": last?._id ?? id } }, { session, upsert: true });
    }
    if (conflicts.length) logger.warn({ msg: "sales_intelligence.lead_link.lead_change_conflict_skipped", dedupe_keys: conflicts });
    return { scanned: overlap.length + changes.length, nominated: job_ids.length, job_ids };
  });
}

export type LeadLinkWakeDependencies = {
  enabled?: () => boolean;
  findLeadChanges?: (target: { model: LeadModel; id: string }, observationId: string) => Promise<LeadChange[]>;
  findChangesById?: (target: { model: LeadModel; id: string }, changeIds: readonly string[]) => Promise<LeadChange[]>;
  enqueue?: (change: LeadChange) => Promise<{ _id: unknown; status: string } | null>;
  publish?: (jobIds: readonly string[]) => Promise<unknown>;
};
/** A processed observation or a Lead command writes at most a handful of Lead EntityChanges. */
const WAKE_CHANGE_LIMIT = 10;

async function enqueueAndWake(changes: readonly LeadChange[], deps: LeadLinkWakeDependencies): Promise<string[]> {
  const enqueue = deps.enqueue ?? ((change: LeadChange) => withTransaction(async (session) => {
    const nomination = await leadLinkNomination(change, session);
    return nomination ? enqueueCsiJob(nomination, session) : null;
  }));
  const jobIds: string[] = [];
  for (const change of changes) {
    const row = await enqueue(change);
    // A replay finds its job already claimed or completed: nothing to wake.
    if (!row || (row.status !== "pending" && row.status !== "retry") || jobIds.includes(String(row._id))) continue;
    jobIds.push(String(row._id));
  }
  if (jobIds.length) await (deps.publish ?? publishRunnableWakeups)(jobIds);
  return jobIds;
}

function logWakeFailure(error: unknown): void {
  logger.warn({
    msg: "sales_intelligence.lead_link.wakeup_failed",
    errorName: error instanceof Error ? error.name : "Error",
    errorCode: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : null,
  });
}
const wakeEnabled = (deps: LeadLinkWakeDependencies) => {
  try {
    return (deps.enabled ?? (() => csiFlag("ENABLED")))();
  } catch (error) {
    logWakeFailure(error);
    return false;
  }
};

/**
 * Post-commit fast path after a Granot lifecycle apply: the observation's Lead EntityChanges nominate
 * the Lead's `lead_link` job (the identity the durable scan raises) and wake it. Never throws: a lost
 * wake-up only waits for the scan.
 */
export async function wakeLeadLinksAfterChange(
  result: { observation_id: string; target?: { model: string; id: string } },
  deps: LeadLinkWakeDependencies = {},
): Promise<{ job_ids: string[] }> {
  const target = result.target;
  if (!target || !isLeadModel(target.model) || !wakeEnabled(deps)) return { job_ids: [] };
  try {
    const leadTarget = { model: target.model, id: target.id };
    const changes = deps.findLeadChanges
      ? await deps.findLeadChanges(leadTarget, result.observation_id)
      : await getEntityChangeModel().find({ "entity.model": target.model, "entity.id": target.id,
        "provenance.observation_id": new mongoose.Types.ObjectId(result.observation_id) })
        .select({ _id: 1, entity: 1, revision_before: 1, changed_paths: 1 }).sort({ applied_at: 1, _id: 1 }).limit(WAKE_CHANGE_LIMIT).lean();
    return { job_ids: await enqueueAndWake(changes, deps) };
  } catch (error) {
    logWakeFailure(error);
    return { job_ids: [] };
  }
}

/** The longest a Lead command waits for its post-commit lead-link wake-up before it returns. */
export const LEAD_LINK_COMMAND_WAKE_TIMEOUT_MS = 2_000;

/**
 * Post-commit fast path after a Lead domain command (Form Lead create, a Lead correction): the
 * committed EntityChanges, by their preallocated ids, nominate the Lead's `lead_link` job. Bounded by
 * `timeoutMs` (the wake keeps running in the background after a timeout) and never throws.
 */
export async function wakeLeadLinksAfterLeadCommand(
  input: { target: { model: string; id: string }; change_ids: readonly string[] },
  deps: LeadLinkWakeDependencies & { timeoutMs?: number } = {},
): Promise<{ job_ids: string[]; outcome: "done" | "timeout" | "skipped" }> {
  const target = input.target;
  if (!isLeadModel(target.model) || input.change_ids.length === 0 || !wakeEnabled(deps)) return { job_ids: [], outcome: "skipped" };
  const leadTarget = { model: target.model, id: target.id };
  const jobIds: string[] = [];
  const wake = (async () => {
    try {
      const ids = input.change_ids.slice(0, WAKE_CHANGE_LIMIT);
      const changes = deps.findChangesById
        ? await deps.findChangesById(leadTarget, ids)
        : await getEntityChangeModel().find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
          "entity.model": leadTarget.model, "entity.id": leadTarget.id })
          .select({ _id: 1, entity: 1, revision_before: 1, changed_paths: 1 }).sort({ applied_at: 1, _id: 1 }).lean();
      jobIds.push(...await enqueueAndWake(changes, deps));
    } catch (error) {
      logWakeFailure(error);
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, deps.timeoutMs ?? LEAD_LINK_COMMAND_WAKE_TIMEOUT_MS));
    timer.unref?.();
  });
  const outcome = await Promise.race([wake.then(() => "done" as const), timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === "timeout") logger.warn({ msg: "sales_intelligence.lead_link.wakeup_timeout", leadModel: leadTarget.model });
  return { job_ids: [...jobIds], outcome };
}

export type LeadLinkJobOutcome = { status: "disabled" | "not_claimable" | "lease_lost" | "retry" } | { status: "completed"; changes: LeadLinkChange[] };

/**
 * One `lead_link` job, in one transaction: a Lead job mints the Form Lead's number and recomputes
 * every number the Lead touches; a number job recomputes that number.
 */
export async function leadLinkJobWork(subjectKey: string, ref: string, session: ClientSession, jobId: string, now = new Date()): Promise<LeadLinkChange[]> {
  const parts = subjectKey.split(":");
  const out: LeadLinkChange[] = [];
  if (parts[1] === "lead") {
    const model = parts[2];
    if (model !== "FormLead" && model !== "CallLead") throw new CsiError("INVALID_INPUT");
    const row = await loadLeadRow({ model, id: ref }, session);
    if (row && model === "FormLead") {
      // The quote form never waits on this: the Lead's own job turns its phone into a Contact Number.
      await ensureFormLeadContactNumber({ _id: String(row._id), timestamp: row.timestamp ?? now, duplicate: row.duplicate === true,
        bad_lead: row.bad_lead ? String(row.bad_lead) : null, normalized_phone_number: row.normalized_phone_number ?? null }, session, jobId, now);
    }
    for (const numberId of await numbersForLead({ model, id: ref }, row, session)) {
      const change = await recomputeLeadLink(numberId, session, { now });
      if (change) out.push(change);
    }
    return out;
  }
  if (parts[1] === "number") {
    if (!mongoose.isValidObjectId(ref)) throw new CsiError("INVALID_INPUT");
    const change = await recomputeLeadLink(ref, session, { now });
    return change ? [change] : [];
  }
  throw new CsiError("INVALID_INPUT");
}

/** Queue payload remains `{ job_id }`; the job row's subject and refs are the only inputs. */
export async function runLeadLinkJob(jobId?: string): Promise<LeadLinkJobOutcome> {
  if (!csiFlag("ENABLED")) return { status: "disabled" };
  const row = await claimCsiJob(`lead-link:${randomUUID()}`, jobId, 120_000, LEAD_LINK_STAGE);
  if (!row) return { status: "not_claimable" };
  const lease = { job_id: String(row._id), owner: row.lease_owner!, epoch: row.lease_epoch };
  try {
    const changes = await completeCsiJob(lease, async (session) => {
      const ref = row.input_refs.map(String)[0];
      if (!ref) throw new CsiError("INVALID_INPUT");
      return leadLinkJobWork(row.subject_key, ref, session, lease.job_id);
    }, { resultFrom: (changes) => ({ changed: changes.filter((change) => change.changed).length }) });
    return { status: "completed", changes };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await failCsiJob(lease, error instanceof CsiError && error.code === "INVALID_INPUT" ? "schema_invalid" : "transient");
    return { status: "retry" };
  }
}

export async function drainLeadLinkJobs(max = 100, deadlineMs = 40_000): Promise<{ outcomes: Record<string, number> }> {
  const outcomes: Record<string, number> = {};
  const deadline = Date.now() + deadlineMs;
  for (let i = 0; i < Math.min(100, max) && Date.now() < deadline; i++) {
    const { status } = await runLeadLinkJob();
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    if (status === "disabled" || status === "not_claimable" || status === "lease_lost") break;
  }
  return { outcomes };
}

/**
 * Job recovery's step (every minute, under `SALES_INTELLIGENCE_ENABLED`): one pass of the durable
 * Lead-change scan, then a bounded drain. A failed scan never blocks the drain; the next run re-scans
 * from the same cursor.
 */
export async function runLeadLinkRecovery(deps: { scan?: typeof scanLeadChangesForLeadLinks; drain?: typeof drainLeadLinkJobs } = {}) {
  let scan: Awaited<ReturnType<typeof scanLeadChangesForLeadLinks>> | null = null;
  try {
    scan = await (deps.scan ?? scanLeadChangesForLeadLinks)();
  } catch (error) {
    logger.warn({ msg: "sales_intelligence.lead_link.lead_change_scan_failed", errorName: error instanceof Error ? error.name : "Error" });
  }
  const drain = await (deps.drain ?? drainLeadLinkJobs)();
  return { scanned: scan?.scanned ?? null, nominated: scan?.nominated ?? null, ...drain };
}
