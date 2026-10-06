import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import type { SalesOutreachLeadModel } from "../../../config/domain/salesOutreach";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { getCallLeadModel } from "../../../models/CallLead";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getFormLeadModel } from "../../../models/FormLead";
import { getSalesOutreachSubjectModel } from "../../../models/salesOutreach";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore } from "../../durableWork/leases";
import { CsiError } from "../../salesIntelligence/auth";
import { enqueueCsiJob, type JobInput } from "../../salesIntelligence/jobs";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import type { ConfigurationLoader } from "../config/load";
import { salesOutreachConfigurationLoader } from "../config/load";
import { deskLeadKey, type DeskLeadRef } from "./leadFacts";

/**
 * IMPL-05: Lead changes reach the desk through the `entity_changes` feed (the single durable input the
 * canonical Lead commands and `LeadChangeRecorder` write in the same transaction as the Lead), with a
 * periodic revision reconcile as the net for any write path that skipped an EntityChange. The desk
 * never writes EntityChange and adds no hook to Granot/extension/HTTP-automation write paths.
 *
 * Both passes only nominate `outreach_lead_change` jobs (one identity per Lead revision, so the tail,
 * the reconcile and a replay converge on one job); the job reads the Lead's current facts.
 */

/** Durable cursor row of the tail in `sales_intelligence_sync_state` (cursor `(applied_at, _id)`). */
export const OUTREACH_LEAD_CHANGE_SCOPE = "outreach_entity_changes";
/** Cursor row (and lease) of the revision reconcile; cursor = last subject id of the pass. */
export const OUTREACH_REVISION_RECONCILE_SCOPE = "outreach_revision_reconcile";
/** `applied_at` is taken before a transaction commits, so a change can land behind the cursor: re-scan this window. */
export const OUTREACH_LEAD_CHANGE_OVERLAP_MS = 120_000;
export const OUTREACH_FEED_PAGE = 100;
const OVERLAP_LIMIT = 500;
/** Reconcile pages per run (5,000 subjects per 5-minute run; the cursor carries the rest). */
const RECONCILE_MAX_PAGES = 50;

/**
 * Code defaults of the tail loop's tunables (olr B10). The configuration keys
 * `migration.feed_max_passes_per_run` (1–50) and `migration.feed_budget_seconds` (1–40) are optional
 * without a schema default (A0 evolution rule), so absent keys resolve here.
 */
export const OUTREACH_FEED_LOOP_DEFAULTS = { feed_max_passes_per_run: 10, feed_budget_seconds: 15 } as const;

export type FeedLoopTuning = Readonly<{ max_passes: number; budget_ms: number }>;

/** Effective tail-loop tunables for a configuration value (absent keys → `OUTREACH_FEED_LOOP_DEFAULTS`). */
export function feedLoopOf(value: Pick<SalesOutreachConfigurationValue, "migration"> | null | undefined): FeedLoopTuning {
  const migration = value?.migration;
  return Object.freeze({
    max_passes: migration?.feed_max_passes_per_run ?? OUTREACH_FEED_LOOP_DEFAULTS.feed_max_passes_per_run,
    budget_ms: (migration?.feed_budget_seconds ?? OUTREACH_FEED_LOOP_DEFAULTS.feed_budget_seconds) * 1000,
  });
}

export type LeadChangeRow = Readonly<{
  id: string;
  lead: DeskLeadRef;
  revision_before: number;
  revision_after: number;
  applied_at: Date;
}>;

export type FeedCursor = Readonly<{ applied_at: Date; id: string }>;

/** The `outreach_lead_change` job for one Lead revision (same identity from the tail, the reconcile or a wake). */
export function leadChangeJobInput(lead: DeskLeadRef, revision: number): JobInput {
  return {
    stage: "outreach_lead_change",
    subject_key: `outreach-lead:${lead.model}:${lead.id}`,
    dedupe_key: `sod:lead-change:${lead.model}:${lead.id}:r${revision}`,
    input_revision: revision,
    input_refs: [lead.id],
  };
}

/**
 * Which changes of a page nominate a job: every change of a Lead that is a desk subject, and — only
 * while the persisted intake gate is on — a Lead's creation (`revision_before` 0), which the job then
 * runs through the intake admission. Other Leads are not the desk's concern (expansion is explicit).
 */
export function nominateLeadChanges(
  changes: readonly LeadChangeRow[],
  subjectLeadKeys: ReadonlySet<string>,
  intakeOpen: boolean,
): Array<{ lead: DeskLeadRef; revision: number }> {
  const seen = new Set<string>();
  const nominations: Array<{ lead: DeskLeadRef; revision: number }> = [];
  for (const change of changes) {
    const key = deskLeadKey(change.lead);
    if (!subjectLeadKeys.has(key) && !(intakeOpen && change.revision_before === 0)) continue;
    const identity = `${key}:${change.revision_after}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    nominations.push({ lead: change.lead, revision: change.revision_after });
  }
  return nominations;
}

export type OutreachFeedStore = {
  readTailCursor(session: ClientSession): Promise<FeedCursor | null>;
  writeTailCursor(cursor: FeedCursor, session: ClientSession): Promise<void>;
  /** Lead changes strictly after `(applied_at, id)`, oldest first. */
  changesAfter(cursor: FeedCursor, limit: number, session: ClientSession): Promise<LeadChangeRow[]>;
  /** Lead changes in `(cursor.applied_at − overlap, cursor.applied_at]` other than the cursor's own. */
  changesInOverlap(cursor: FeedCursor, overlapMs: number, limit: number, session: ClientSession): Promise<LeadChangeRow[]>;
  subjectLeadKeys(leads: readonly DeskLeadRef[], session: ClientSession): Promise<Set<string>>;
  readReconcileCursor(session: ClientSession): Promise<string | null>;
  writeReconcileCursor(subjectId: string | null, session: ClientSession): Promise<void>;
  /** Open (non-closed) subjects after `afterId` by `_id`. */
  subjectsAfter(afterId: string | null, limit: number, session: ClientSession): Promise<Array<{ id: string; lead: DeskLeadRef; lead_revision_seen: number }>>;
  leadRevisions(leads: readonly DeskLeadRef[], session: ClientSession): Promise<Map<string, number>>;
  enqueue(job: JobInput, session: ClientSession): Promise<"enqueued" | "conflict">;
};

const ZERO_ID = "000000000000000000000000";
const LEAD_MODELS: SalesOutreachLeadModel[] = ["FormLead", "CallLead"];
const oid = (id: string) => new mongoose.Types.ObjectId(id);

type ChangeLean = { _id: unknown; entity: { model: string; id: string }; revision_before: number; revision_after: number; applied_at: Date };
const toChange = (row: ChangeLean): LeadChangeRow => ({
  id: String(row._id),
  lead: { model: row.entity.model as SalesOutreachLeadModel, id: row.entity.id },
  revision_before: row.revision_before,
  revision_after: row.revision_after,
  applied_at: row.applied_at,
});
const CHANGE_PROJECTION = { _id: 1, entity: 1, revision_before: 1, revision_after: 1, applied_at: 1 } as const;

export const mongoOutreachFeedStore: OutreachFeedStore = {
  async readTailCursor(session) {
    const row = await getSalesIntelligenceSyncStateModel().findOne({ scope: OUTREACH_LEAD_CHANGE_SCOPE }).session(session).lean();
    const cursor = row?.cursor as { entity_change_applied_at?: Date | null; entity_change_id?: unknown } | undefined;
    return row && cursor?.entity_change_applied_at ? { applied_at: cursor.entity_change_applied_at, id: String(cursor.entity_change_id ?? ZERO_ID) } : null;
  },
  async writeTailCursor(cursor, session) {
    await getSalesIntelligenceSyncStateModel().updateOne(
      { scope: OUTREACH_LEAD_CHANGE_SCOPE },
      { $set: { "cursor.entity_change_applied_at": cursor.applied_at, "cursor.entity_change_id": oid(cursor.id) } },
      { session, upsert: true },
    );
  },
  async changesAfter(cursor, limit, session) {
    const rows = await getEntityChangeModel()
      .find(
        {
          "entity.model": { $in: LEAD_MODELS },
          $or: [{ applied_at: { $gt: cursor.applied_at } }, { applied_at: cursor.applied_at, _id: { $gt: oid(cursor.id) } }],
        },
        CHANGE_PROJECTION,
      )
      .sort({ applied_at: 1, _id: 1 })
      .limit(limit)
      .session(session)
      .lean();
    return (rows as unknown as ChangeLean[]).map(toChange);
  },
  async changesInOverlap(cursor, overlapMs, limit, session) {
    const rows = await getEntityChangeModel()
      .find(
        {
          "entity.model": { $in: LEAD_MODELS },
          applied_at: { $gt: new Date(+cursor.applied_at - overlapMs), $lte: cursor.applied_at },
          _id: { $ne: oid(cursor.id) },
        },
        CHANGE_PROJECTION,
      )
      .sort({ applied_at: 1, _id: 1 })
      .limit(limit)
      .session(session)
      .lean();
    return (rows as unknown as ChangeLean[]).map(toChange);
  },
  async subjectLeadKeys(leads, session) {
    if (!leads.length) return new Set();
    const rows = await getSalesOutreachSubjectModel()
      .find({ $or: leads.map((lead) => ({ lead_model: lead.model, lead_id: oid(lead.id) })) }, { lead_model: 1, lead_id: 1 })
      .session(session)
      .lean();
    return new Set(rows.map((row) => deskLeadKey({ model: row.lead_model as SalesOutreachLeadModel, id: String(row.lead_id) })));
  },
  async readReconcileCursor(session) {
    const row = await getSalesIntelligenceSyncStateModel().findOne({ scope: OUTREACH_REVISION_RECONCILE_SCOPE }).session(session).lean();
    const id = (row?.cursor as { outreach_subject_id?: unknown } | undefined)?.outreach_subject_id;
    return id ? String(id) : null;
  },
  async writeReconcileCursor(subjectId, session) {
    await getSalesIntelligenceSyncStateModel().updateOne(
      { scope: OUTREACH_REVISION_RECONCILE_SCOPE },
      { $set: { "cursor.outreach_subject_id": subjectId ? oid(subjectId) : null } },
      { session, upsert: true },
    );
  },
  async subjectsAfter(afterId, limit, session) {
    const rows = await getSalesOutreachSubjectModel()
      .find({ status: { $in: ["active", "review"] }, ...(afterId ? { _id: { $gt: oid(afterId) } } : {}) }, { lead_model: 1, lead_id: 1, lead_revision_seen: 1 })
      .sort({ _id: 1 })
      .limit(limit)
      .session(session)
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      lead: { model: row.lead_model as SalesOutreachLeadModel, id: String(row.lead_id) },
      lead_revision_seen: Number(row.lead_revision_seen ?? 0),
    }));
  },
  async leadRevisions(leads, session) {
    const revisions = new Map<string, number>();
    for (const model of LEAD_MODELS) {
      const ids = leads.filter((lead) => lead.model === model).map((lead) => oid(lead.id));
      if (!ids.length) continue;
      const Model = (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()) as unknown as mongoose.Model<{ domain_revision?: number }>;
      const rows = await Model.find({ _id: { $in: ids } }, { domain_revision: 1 }).session(session).lean();
      for (const row of rows) revisions.set(deskLeadKey({ model, id: String(row._id) }), Number(row.domain_revision ?? 0));
    }
    return revisions;
  },
  async enqueue(job, session) {
    try {
      await enqueueCsiJob(job, session);
      return "enqueued";
    } catch (error) {
      // A stored job of the same identity with another payload must not pin the cursor.
      if (error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT") return "conflict";
      throw error;
    }
  },
};

export type OutreachFeedDeps = {
  store?: OutreachFeedStore;
  loader?: ConfigurationLoader;
  transaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  /** Wall clock of the tail loop's time budget (tests inject one); defaults to `Date.now`. */
  clock?: () => number;
};

export type TailPassResult = Readonly<{
  skipped: boolean;
  reason: string | null;
  scanned: number;
  /** Changes taken beyond the cursor (the overlap re-scan excluded); a full page (100) means more may wait. */
  page_size: number;
  nominated: number;
  conflicts: number;
  cursor: { applied_at: string; id: string } | null;
}>;

export type TailPassOptions = Readonly<{
  /** Re-scan the commit-lag overlap behind the stored cursor (default true; the loop scans it on its first pass only). */
  overlap?: boolean;
}>;

/**
 * One bounded pass of the tail: re-scans the commit-lag overlap (unless `overlap: false`), takes ≤ 100
 * changes beyond the cursor, nominates jobs and advances the cursor in the same transaction. A first
 * pass starts at `now − overlap` (older Leads are enrollment's, not the tail's). Fails closed while the
 * configuration is not active: the cursor does not move, so nothing is skipped.
 */
export async function scanOutreachLeadChanges(now = new Date(), deps: OutreachFeedDeps = {}, options: TailPassOptions = {}): Promise<TailPassResult> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const inspection = await loader.inspect();
  if (inspection.state !== "active")
    return { skipped: true, reason: `configuration_${inspection.state}`, scanned: 0, page_size: 0, nominated: 0, conflicts: 0, cursor: null };
  return runTailPass(now, deps, inspection.value.transition.intake_admission_enabled, options.overlap ?? true);
}

async function runTailPass(now: Date, deps: OutreachFeedDeps, intakeOpen: boolean, scanOverlap: boolean): Promise<TailPassResult> {
  const store = deps.store ?? mongoOutreachFeedStore;
  return (deps.transaction ?? withTransaction)(async (session) => {
    const stored = await store.readTailCursor(session);
    const cursor = stored ?? { applied_at: new Date(+now - OUTREACH_LEAD_CHANGE_OVERLAP_MS), id: ZERO_ID };
    const overlap = stored && scanOverlap ? await store.changesInOverlap(cursor, OUTREACH_LEAD_CHANGE_OVERLAP_MS, OVERLAP_LIMIT, session) : [];
    const page = await store.changesAfter(cursor, OUTREACH_FEED_PAGE, session);
    const changes = [...overlap, ...page];
    const subjects = await store.subjectLeadKeys(uniqueLeads(changes.map((c) => c.lead)), session);
    let nominated = 0;
    let conflicts = 0;
    for (const nomination of nominateLeadChanges(changes, subjects, intakeOpen)) {
      if ((await store.enqueue(leadChangeJobInput(nomination.lead, nomination.revision), session)) === "conflict") conflicts++;
      else nominated++;
    }
    const last = page.at(-1);
    const next = last ? { applied_at: last.applied_at, id: last.id } : cursor;
    if (last || !stored) await store.writeTailCursor(next, session);
    if (conflicts) logger.warn({ msg: "sales_outreach.lead_change.conflict_skipped", conflicts });
    return {
      skipped: false,
      reason: null,
      scanned: changes.length,
      page_size: page.length,
      nominated,
      conflicts,
      cursor: { applied_at: next.applied_at.toISOString(), id: next.id },
    };
  });
}

export type TailLoopStop = "caught_up" | "max_passes" | "budget" | "error";

export type TailLoopResult = Readonly<{
  skipped: boolean;
  reason: string | null;
  passes: number;
  scanned: number;
  nominated: number;
  conflicts: number;
  /** The cursor after the last committed pass. */
  cursor: { applied_at: string; id: string } | null;
  /** The last pass took a short page: nothing was waiting beyond the cursor. */
  caught_up: boolean;
  /** Why the loop ended: a short page, the pass cap, the time budget, or a failed later pass. */
  stopped_by: TailLoopStop | null;
  /** The effective tunables of this run (`feedLoopOf`). */
  max_passes: number;
  budget_seconds: number;
}>;

/**
 * The tail loop (cron every minute, olr B10): tail passes back to back while the last page was full
 * (`OUTREACH_FEED_PAGE` changes), at most `migration.feed_max_passes_per_run` passes and while the
 * clock is inside `migration.feed_budget_seconds` (both resolved by `feedLoopOf`). Only the first pass
 * re-scans the overlap. Each pass is its own transaction, so the cursor commits per page and a stop
 * (cap, budget, error) leaves it at the last committed page. A failure of the first pass propagates
 * (the cron logs it and still drains); a later failure ends the loop with what was committed.
 */
export async function scanOutreachLeadChangesUntilCaughtUp(now = new Date(), deps: OutreachFeedDeps = {}): Promise<TailLoopResult> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const inspection = await loader.inspect();
  const tuning = feedLoopOf(inspection.state === "active" ? inspection.value : null);
  const effective = { max_passes: tuning.max_passes, budget_seconds: tuning.budget_ms / 1000 };
  if (inspection.state !== "active")
    return {
      skipped: true,
      reason: `configuration_${inspection.state}`,
      passes: 0,
      scanned: 0,
      nominated: 0,
      conflicts: 0,
      cursor: null,
      caught_up: false,
      stopped_by: null,
      ...effective,
    };
  const intakeOpen = inspection.value.transition.intake_admission_enabled;
  let passes = 0;
  let scanned = 0;
  let nominated = 0;
  let conflicts = 0;
  let cursor: TailPassResult["cursor"] = null;
  let stoppedBy: TailLoopStop;
  for (;;) {
    let pass: TailPassResult;
    try {
      pass = await runTailPass(now, deps, intakeOpen, passes === 0);
    } catch (error) {
      if (passes === 0) throw error;
      logger.warn({ msg: "sales_outreach.lead_change.tail_loop_pass_failed", passes, errorName: error instanceof Error ? error.name : "Error" });
      stoppedBy = "error";
      break;
    }
    passes++;
    scanned += pass.scanned;
    nominated += pass.nominated;
    conflicts += pass.conflicts;
    cursor = pass.cursor;
    if (pass.page_size < OUTREACH_FEED_PAGE) {
      stoppedBy = "caught_up";
      break;
    }
    if (passes >= tuning.max_passes) {
      stoppedBy = "max_passes";
      break;
    }
    if (clock() >= started + tuning.budget_ms) {
      stoppedBy = "budget";
      break;
    }
  }
  return { skipped: false, reason: null, passes, scanned, nominated, conflicts, cursor, caught_up: stoppedBy === "caught_up", stopped_by: stoppedBy, ...effective };
}

function uniqueLeads(leads: readonly DeskLeadRef[]): DeskLeadRef[] {
  const byKey = new Map(leads.map((lead) => [deskLeadKey(lead), lead]));
  return [...byKey.values()];
}

export type ReconcilePassResult = Readonly<{ skipped: boolean; reason: string | null; pages: number; checked: number; nominated: number; wrapped: boolean }>;

/**
 * The revision reconcile (cron every 5 minutes): open subjects whose Lead `domain_revision` differs from
 * `lead_revision_seen` get an `outreach_lead_change` job — the net for a Lead write that skipped its
 * EntityChange. Pages of 100 subjects by `_id`, each page's nominations and cursor in one transaction;
 * a short page wraps the cursor so the next run starts over. Single runner (lease in the cursor row).
 */
export async function reconcileOutreachRevisions(
  now = new Date(),
  deps: OutreachFeedDeps & { lease?: { acquire(): Promise<boolean>; release(): Promise<void> } } = {},
): Promise<ReconcilePassResult> {
  const store = deps.store ?? mongoOutreachFeedStore;
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const inspection = await loader.inspect();
  if (inspection.state !== "active") return { skipped: true, reason: `configuration_${inspection.state}`, pages: 0, checked: 0, nominated: 0, wrapped: false };
  const lease = deps.lease ?? mongoReconcileLease(now);
  if (!(await lease.acquire())) return { skipped: true, reason: "lease_held", pages: 0, checked: 0, nominated: 0, wrapped: false };
  const transaction = deps.transaction ?? withTransaction;
  let pages = 0;
  let checked = 0;
  let nominated = 0;
  let wrapped = false;
  try {
    while (pages < RECONCILE_MAX_PAGES && !wrapped) {
      const page = await transaction(async (session) => {
        const after = await store.readReconcileCursor(session);
        const subjects = await store.subjectsAfter(after, OUTREACH_FEED_PAGE, session);
        const revisions = await store.leadRevisions(subjects.map((s) => s.lead), session);
        let count = 0;
        for (const subject of subjects) {
          const revision = revisions.get(deskLeadKey(subject.lead));
          if (revision === undefined || revision === subject.lead_revision_seen) continue;
          if ((await store.enqueue(leadChangeJobInput(subject.lead, revision), session)) === "enqueued") count++;
        }
        const short = subjects.length < OUTREACH_FEED_PAGE;
        await store.writeReconcileCursor(short ? null : subjects.at(-1)!.id, session);
        return { size: subjects.length, count, short };
      });
      pages++;
      checked += page.size;
      nominated += page.count;
      wrapped = page.short;
    }
  } finally {
    await lease.release();
  }
  return { skipped: false, reason: null, pages, checked, nominated, wrapped };
}

function mongoReconcileLease(now: Date) {
  const leases = new MongoLeaseStore(getSalesIntelligenceSyncStateModel());
  let token: Awaited<ReturnType<MongoLeaseStore["acquire"]>> = null;
  return {
    async acquire() {
      token = await leases.acquire({ scope: OUTREACH_REVISION_RECONCILE_SCOPE, owner: `sod-reconcile:${randomUUID()}`, now, ttl_ms: 240_000 });
      return token !== null;
    },
    async release() {
      if (token) await leases.release({ token, now: new Date() });
    },
  };
}
