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
import { deskDecisionFingerprint } from "./policyMapping";

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

/**
 * Code default of the decision reconcile cap (olr B2): decision re-nominations per reconcile run. The
 * configuration key `migration.decision_reconcile_per_run` (1–5,000) is optional without a schema
 * default (A0 evolution rule), so an absent key resolves here.
 */
export const DECISION_RECONCILE_DEFAULT_PER_RUN = 300;

/** Effective decision reconcile cap for a configuration value (absent key → `DECISION_RECONCILE_DEFAULT_PER_RUN`). */
export function decisionReconcilePerRunOf(value: Pick<SalesOutreachConfigurationValue, "migration"> | null | undefined): number {
  return value?.migration?.decision_reconcile_per_run ?? DECISION_RECONCILE_DEFAULT_PER_RUN;
}

export type LeadChangeRow = Readonly<{
  id: string;
  lead: DeskLeadRef;
  revision_before: number;
  revision_after: number;
  applied_at: Date;
  /** The Lead paths the change wrote (`entity_changes.changed_paths`), read by the olr B6 admission nomination. */
  changed_paths: readonly string[];
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
 * The `outreach_lead_change` job that re-decides one subject under the active configuration (olr B2;
 * LANE-B §0.2): one identity per subject per decision fingerprint and configuration revision, so a
 * replay dedupes and an A→B→A flip (a new revision) re-nominates. The job is the ordinary lead-change
 * job: `syncSubject` reads the configuration in its transaction and stamps the fingerprint.
 */
export function decisionJobInput(lead: DeskLeadRef, fingerprint: string, configurationRevision: number): JobInput {
  return {
    stage: "outreach_lead_change",
    subject_key: `outreach-lead:${lead.model}:${lead.id}`,
    dedupe_key: `sod:lead-change:${lead.model}:${lead.id}:decision:${fingerprint.slice(0, 16)}:c${configurationRevision}`,
    input_revision: configurationRevision,
    input_refs: [lead.id],
  };
}

/**
 * The `outreach_lead_change` job that runs only the expansion admission path for a Lead that is not a
 * desk subject (olr B6; LANE-B §0.2): one identity per Lead revision, distinct from the `r<rev>` intake
 * identity, so the job knows its trigger from its own `dedupe_key` (`leadChangeJob.ts` `triggerOfJob`).
 */
export function admissionJobInput(lead: DeskLeadRef, revision: number): JobInput {
  return {
    stage: "outreach_lead_change",
    subject_key: `outreach-lead:${lead.model}:${lead.id}`,
    dedupe_key: `sod:lead-change:${lead.model}:${lead.id}:admission:r${revision}`,
    input_revision: revision,
    input_refs: [lead.id],
  };
}

/**
 * Lead paths whose change can move a non-subject Lead into the expansion scope (olr B6): accepted
 * priority, the P05h exclusions and closures, the received time, identity (Job Number), the upcoming
 * move date and the intake source (the P05e default). A changed path matches exactly or as a parent
 * (`booked` matches `booked.id`). A code constant: a path found later is added here.
 */
export const ADMISSION_DECISION_PATHS = [
  "granot_priority",
  "last_accepted_granot_observation",
  "duplicate",
  "booked",
  "cancelled",
  "bad_lead",
  "created_on_unmatched",
  "timestamp",
  "normalized_job_no",
  "move_date",
  "ingestion_origin",
] as const;

/** The change wrote at least one `ADMISSION_DECISION_PATHS` path (exact, or a sub-path of one). */
export const touchesAdmissionDecision = (paths: readonly string[]) =>
  paths.some((path) => ADMISSION_DECISION_PATHS.some((decision) => path === decision || path.startsWith(`${decision}.`)));

/**
 * olr B6: the tail nominates expansion admission jobs only while the Owner switch
 * `transition.expansion_admission_enabled` is on (absent = off) and the migration is not paused.
 */
export const expansionAdmissionOpenOf = (value: Pick<SalesOutreachConfigurationValue, "transition" | "migration">) =>
  value.transition.expansion_admission_enabled === true && !value.migration.paused;

/** olr B8: the hold re-check bucket length (a held subject is re-checked at most once per bucket). */
export const HOLD_RECHECK_BUCKET_MS = 15 * 60_000;

/** `YYYYMMDDTHHmm` (UTC) of the start of the 15-minute bucket holding `now` (LANE-B §0.2 `hold:<bucket>`). */
export function holdRecheckBucketOf(now: Date): string {
  const start = new Date(Math.floor(+now / HOLD_RECHECK_BUCKET_MS) * HOLD_RECHECK_BUCKET_MS);
  return start.toISOString().slice(0, 16).replace(/[-:]/g, "");
}

/**
 * The `outreach_lead_change` job that re-checks one held subject (olr B8; LANE-B §0.2): one identity per
 * subject per 15-minute bucket, so the 5-minute reconcile wakes a held subject at most 4 times an hour.
 * Ambiguity can clear through another Lead's change (its `duplicate` flag), which nominates nothing for
 * this Lead; the ordinary job re-syncs it and, once the hold has cleared, opens its late first period.
 */
export function holdJobInput(lead: DeskLeadRef, now: Date): JobInput {
  return {
    stage: "outreach_lead_change",
    subject_key: `outreach-lead:${lead.model}:${lead.id}`,
    dedupe_key: `sod:lead-change:${lead.model}:${lead.id}:hold:${holdRecheckBucketOf(now)}`,
    input_revision: 1,
    input_refs: [lead.id],
  };
}

/** A subject held for an ambiguous Job Number (`sync.ts` `admissionHoldOf`): the reconcile re-checks it. */
export const isHeldForIdentity = (subject: Pick<ReconcileSubject, "status" | "review_reasons">) =>
  subject.status === "review" && subject.review_reasons.includes("ambiguous_identity");

export type LeadChangeNomination = Readonly<{ lead: DeskLeadRef; revision: number; kind: "change" | "admission" }>;

/**
 * Which changes of a page nominate a job:
 * - every change of a Lead that is a desk subject (`change`, the `r<rev>` job);
 * - only while the persisted intake gate is on, a Lead's creation (`revision_before` 0; `change`), which
 *   the job runs through the intake admission;
 * - olr B6, only while expansion admission is open (`expansionAdmissionOpenOf`), a later change of a
 *   non-subject Lead that wrote a decision path (`admission`, the `admission:r<rev>` job), which the job
 *   runs through the expansion admission only.
 * Other changes of other Leads are not the desk's concern.
 */
export function nominateLeadChanges(
  changes: readonly LeadChangeRow[],
  subjectLeadKeys: ReadonlySet<string>,
  intakeOpen: boolean,
  admissionOpen = false,
): LeadChangeNomination[] {
  const seen = new Set<string>();
  const nominations: LeadChangeNomination[] = [];
  for (const change of changes) {
    const key = deskLeadKey(change.lead);
    const kind = subjectLeadKeys.has(key) || (intakeOpen && change.revision_before === 0)
      ? "change"
      : admissionOpen && change.revision_before > 0 && touchesAdmissionDecision(change.changed_paths)
        ? "admission"
        : null;
    if (!kind) continue;
    const identity = `${key}:${kind}:${change.revision_after}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    nominations.push({ lead: change.lead, revision: change.revision_after, kind });
  }
  return nominations;
}

export type ReconcileSubject = Readonly<{
  id: string;
  lead: DeskLeadRef;
  lead_revision_seen: number;
  decision_fingerprint: string | null;
  /** olr B8: status and review reasons, so the reconcile can re-check held subjects. */
  status: "active" | "review";
  review_reasons: string[];
}>;

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
  /** Open (non-closed) subjects after `afterId` by `_id`, with the decision fingerprint they were last decided under (olr B2), status and review reasons (olr B8). */
  subjectsAfter(afterId: string | null, limit: number, session: ClientSession): Promise<ReconcileSubject[]>;
  leadRevisions(leads: readonly DeskLeadRef[], session: ClientSession): Promise<Map<string, number>>;
  enqueue(job: JobInput, session: ClientSession): Promise<"enqueued" | "conflict">;
};

const ZERO_ID = "000000000000000000000000";
const LEAD_MODELS: SalesOutreachLeadModel[] = ["FormLead", "CallLead"];
const oid = (id: string) => new mongoose.Types.ObjectId(id);

type ChangeLean = {
  _id: unknown;
  entity: { model: string; id: string };
  revision_before: number;
  revision_after: number;
  applied_at: Date;
  changed_paths?: string[] | null;
};
const toChange = (row: ChangeLean): LeadChangeRow => ({
  id: String(row._id),
  lead: { model: row.entity.model as SalesOutreachLeadModel, id: row.entity.id },
  revision_before: row.revision_before,
  revision_after: row.revision_after,
  applied_at: row.applied_at,
  changed_paths: Array.isArray(row.changed_paths) ? row.changed_paths.map(String) : [],
});
const CHANGE_PROJECTION = { _id: 1, entity: 1, revision_before: 1, revision_after: 1, applied_at: 1, changed_paths: 1 } as const;

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
      .find(
        { status: { $in: ["active", "review"] }, ...(afterId ? { _id: { $gt: oid(afterId) } } : {}) },
        { lead_model: 1, lead_id: 1, lead_revision_seen: 1, decision_fingerprint: 1, status: 1, review_reasons: 1 },
      )
      .sort({ _id: 1 })
      .limit(limit)
      .session(session)
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      lead: { model: row.lead_model as SalesOutreachLeadModel, id: String(row.lead_id) },
      lead_revision_seen: Number(row.lead_revision_seen ?? 0),
      decision_fingerprint: typeof row.decision_fingerprint === "string" ? row.decision_fingerprint : null,
      status: row.status === "review" ? ("review" as const) : ("active" as const),
      review_reasons: Array.isArray(row.review_reasons) ? row.review_reasons.map(String) : [],
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
  return runTailPass(now, deps, tailGatesOf(inspection.value), options.overlap ?? true);
}

/** Which creation/admission nominations the tail makes this run (from the configuration it inspected). */
type TailGates = Readonly<{ intake: boolean; admission: boolean }>;
const tailGatesOf = (value: SalesOutreachConfigurationValue): TailGates => ({
  intake: value.transition.intake_admission_enabled,
  admission: expansionAdmissionOpenOf(value),
});

async function runTailPass(now: Date, deps: OutreachFeedDeps, gates: TailGates, scanOverlap: boolean): Promise<TailPassResult> {
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
    for (const nomination of nominateLeadChanges(changes, subjects, gates.intake, gates.admission)) {
      const job = nomination.kind === "admission" ? admissionJobInput(nomination.lead, nomination.revision) : leadChangeJobInput(nomination.lead, nomination.revision);
      if ((await store.enqueue(job, session)) === "conflict") conflicts++;
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
  const gates = tailGatesOf(inspection.value);
  let passes = 0;
  let scanned = 0;
  let nominated = 0;
  let conflicts = 0;
  let cursor: TailPassResult["cursor"] = null;
  let stoppedBy: TailLoopStop;
  for (;;) {
    let pass: TailPassResult;
    try {
      pass = await runTailPass(now, deps, gates, passes === 0);
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

export type ReconcilePassResult = Readonly<{
  skipped: boolean;
  reason: string | null;
  pages: number;
  checked: number;
  /** Revision (`r<rev>`) nominations newly enqueued (uncapped). */
  nominated: number;
  wrapped: boolean;
  /** olr B2: decision re-nominations attempted this run (new or already queued), at most `decision_cap`. */
  decision_nominated: number;
  /** olr B2: subjects left for a later run because the cap was reached. */
  decision_deferred: number;
  /** olr B2: the effective cap of this run (`decisionReconcilePerRunOf`). */
  decision_cap: number;
  /** olr B8: hold re-check nominations attempted this run (`hold:<15-min bucket>`; a replay in the same bucket dedupes). */
  hold_nominated: number;
}>;

/**
 * The revision reconcile (cron every 5 minutes): open subjects whose Lead `domain_revision` differs from
 * `lead_revision_seen` get an `outreach_lead_change` job — the net for a Lead write that skipped its
 * EntityChange. Pages of 100 subjects by `_id`, each page's nominations and cursor in one transaction;
 * a short page wraps the cursor so the next run starts over. Single runner (lease in the cursor row).
 *
 * olr B2 decision reconcile: an open subject whose Lead revision is current but whose
 * `decision_fingerprint` differs from the active configuration's (null included) gets the decision job
 * (`decisionJobInput`), at most `migration.decision_reconcile_per_run` attempts per run (default 300;
 * an attempt that dedupes onto a still-queued job counts, which throttles the wave to the drain). The
 * rest wait for a later run; the cursor still moves and wraps. A subject whose revision differs gets
 * only the `r<rev>` job, which stamps the fingerprint too. Closed subjects are never re-decided.
 *
 * olr B8 hold re-check: a `review` subject held for `ambiguous_identity` whose revision is current and
 * that got no decision job this run gets `holdJobInput` (one per 15-minute bucket), uncapped: the hold
 * is rare (a handful of subjects) and each job is one cheap re-sync.
 */
export async function reconcileOutreachRevisions(
  now = new Date(),
  deps: OutreachFeedDeps & { lease?: { acquire(): Promise<boolean>; release(): Promise<void> } } = {},
): Promise<ReconcilePassResult> {
  const store = deps.store ?? mongoOutreachFeedStore;
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const inspection = await loader.inspect();
  const decisionCap = decisionReconcilePerRunOf(inspection.state === "active" ? inspection.value : null);
  const idle = { pages: 0, checked: 0, nominated: 0, wrapped: false, decision_nominated: 0, decision_deferred: 0, decision_cap: decisionCap, hold_nominated: 0 };
  if (inspection.state !== "active") return { skipped: true, reason: `configuration_${inspection.state}`, ...idle };
  const lease = deps.lease ?? mongoReconcileLease(now);
  if (!(await lease.acquire())) return { skipped: true, reason: "lease_held", ...idle };
  const activeFingerprint = deskDecisionFingerprint(inspection.value.cadence);
  const transaction = deps.transaction ?? withTransaction;
  let pages = 0;
  let checked = 0;
  let nominated = 0;
  let decisions = 0;
  let deferred = 0;
  let holds = 0;
  let wrapped = false;
  try {
    while (pages < RECONCILE_MAX_PAGES && !wrapped) {
      const page = await transaction(async (session) => {
        const after = await store.readReconcileCursor(session);
        const subjects = await store.subjectsAfter(after, OUTREACH_FEED_PAGE, session);
        const revisions = await store.leadRevisions(subjects.map((s) => s.lead), session);
        let count = 0;
        let decided = 0;
        let waiting = 0;
        let held = 0;
        for (const subject of subjects) {
          const revision = revisions.get(deskLeadKey(subject.lead));
          if (revision === undefined) continue;
          if (revision !== subject.lead_revision_seen) {
            if ((await store.enqueue(leadChangeJobInput(subject.lead, revision), session)) === "enqueued") count++;
            continue;
          }
          if (subject.decision_fingerprint !== activeFingerprint) {
            if (decisions + decided < decisionCap) {
              await store.enqueue(decisionJobInput(subject.lead, activeFingerprint, inspection.revision), session);
              decided++;
              continue;
            }
            waiting++;
          }
          if (isHeldForIdentity(subject)) {
            await store.enqueue(holdJobInput(subject.lead, now), session);
            held++;
          }
        }
        const short = subjects.length < OUTREACH_FEED_PAGE;
        await store.writeReconcileCursor(short ? null : subjects.at(-1)!.id, session);
        return { size: subjects.length, count, decided, waiting, held, short };
      });
      pages++;
      checked += page.size;
      nominated += page.count;
      decisions += page.decided;
      deferred += page.waiting;
      holds += page.held;
      wrapped = page.short;
    }
  } finally {
    await lease.release();
  }
  return {
    skipped: false,
    reason: null,
    pages,
    checked,
    nominated,
    wrapped,
    decision_nominated: decisions,
    decision_deferred: deferred,
    decision_cap: decisionCap,
    hold_nominated: holds,
  };
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
