/**
 * S10 step 6 core (reconciliation addendum §5, C24/C25): the full Outreach re-ensure lap.
 * Entry point: `scripts/dev_ops/reensure-outreach.ts`. Replica proof: `scripts/dev_ops/test-si-reensure.replica.test.ts`.
 *
 * Candidates: every Outreach Record that is not closed, plus every record closed in the last 90 days
 * (`closed_at >= as_of − 90 d`), walked by `_id` with a resumable cursor.
 *
 * Apply, per record, in bounded transactions (the minute worker's own code paths, nothing forked):
 *   1. the `outreach-clock` job's pass: `ensureLead` (Lead subjects) or `backfillContactFacts` (Number
 *      Review subjects), then `refreshRecord(…, "clock_boundary")` (a no-op when nothing moved);
 *   2. the replay of the record's primary Number's calls: `replayNumberInteractions` (`outreach/worker.ts`)
 *      paged HERE, `OUTREACH_NUMBER_REPLAY_PAGE` calls per transaction, with no continuation job. A Number
 *      shared by several records is replayed once per run.
 * Re-running is a no-op: `closeRecord`, `applyLeadProgress` (fingerprint), the commitment keys and the
 * `outreach_call_applied` audit fence (projection revision + rep identity) make every repeat write nothing.
 *
 * Paid work (zero model calls):
 *   - `--no-progress-plan` (default; required in production) installs the process-level suppressor
 *     (`setProgressPlanSuppressor`, `outreach/types.ts`): an AC6-PLAN re-plan that would be nominated is
 *     counted per record instead;
 *   - any paid-stage job created inside a lap transaction (`number_refresh` from an official closure,
 *     `analysis`, `application`, `transcription`, `move_assessment`) is put on `operator_hold` (status
 *     `paused`, which no cron or consumer claims) in that same transaction and recorded in the checkpoint;
 *   - the run fails when a paid job it created is left unheld (it cannot be: the hold is in the same
 *     transaction), and reports the claimable paid-stage counters before and after.
 *
 * Dry run (default) is READ-ONLY: no transaction and no write. Running the lap in a transaction and
 * aborting it is NOT write-free (the aborted writes still reach the server's write counters; the replica
 * proof shows it), so the dry run predicts each record's change with the same inputs `ensureLead` and
 * `ensureInteraction` read: contact facts, official closure (and its held `number_refresh`), the Lead
 * progress projection (`projectLeadProgress`, P4 default, re-plan), the clock refresh, and every call on
 * the Number whose `outreach_call_applied` fence is missing for its attributed record. Exact after-bands
 * exist only for apply.
 *
 * Bands: `deriveOutreachFacts` (what the Attention publish runs) at the run's fixed `as_of`, over every
 * candidate before the lap (the pre-pass) and, on apply, after it (the post-pass).
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../../src/db";
import { csiDataset, csiFlag } from "../../../src/config/domain/salesIntelligence";
import { getOutreachRecordModel } from "../../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../src/models/OutreachFollowup";
import { getCallInteractionModel } from "../../../src/models/CallInteraction";
import { getContactNumberModel } from "../../../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../src/models/NumberLeadAttachment";
import { getLeadConversationModel } from "../../../src/models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../src/models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceAuditEventModel } from "../../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceReviewItemModel } from "../../../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceJobModel } from "../../../src/models/SalesIntelligenceJob";
import { loadLead } from "../../../src/services/salesIntelligence/attachment/sources";
import { historicalAttachmentsReady, historicalCaptureReady } from "../../../src/services/salesIntelligence/backfill/readiness";
import { backfillContactFacts, contactFactsMissing, ensureInteraction, ensureLead, interactionAttribution, interactionRepIdentity, latestProgressEvidence,
  progressDefaultKey, PROGRESS_REPLAN_WINDOW_MS, workerContext } from "../../../src/services/salesIntelligence/outreach/ensure";
import { closureBasisFor, isTerminal, projectLeadProgress, type LeadProgressRow } from "../../../src/services/salesIntelligence/outreach/leadProgress";
import { authoritativeClosure, stateWithActions } from "../../../src/services/salesIntelligence/outreach/transitions";
import { refreshRecord } from "../../../src/services/salesIntelligence/outreach/store";
import { attentionDue } from "../../../src/services/salesIntelligence/outreach/derive";
import { attentionEvolutionEnabled, progressPlanEnabled, setProgressPlanSuppressor, subjectKey, type FollowupRow, type RecordRow } from "../../../src/services/salesIntelligence/outreach/types";
import { OUTREACH_NUMBER_REPLAY_PAGE } from "../../../src/services/salesIntelligence/outreach/worker";
import { deriveOutreachFacts, loadOutreachInputsBatch } from "../../../src/services/salesIntelligence/outreach/reads";
import { resolvePolicy } from "../../../src/services/salesIntelligence/policy";
import { readCaptureCoverage } from "../../../src/services/numberActivity/coverage";
import { OPERATOR_HOLD_REASON } from "./call-log-repair";
import { P5_PAID_STAGES, paidJobCounts } from "./priority5-reconcile";

export const REENSURE_VERSION = "reensure-outreach-v1" as const;
export const REENSURE_PAID_STAGES = P5_PAID_STAGES;
export const REENSURE_CLOSED_LOOKBACK_MS = 90 * 86_400_000;
const BAND_PAGE = 500;
const PREDICT_CALL_PAGE = 200;

type Tally = Record<string, number>;
export type ReensureHold = { job_id: string; stage: string; dedupe_key: string; record_id: string; held_at: string };
export type ReensureTotals = {
  records: number; records_changed: number; records_unchanged: number; records_missing: number;
  /** Apply: record revisions written (outreach audit rows), records created, calls applied, reviews by kind, actions created/closed by kind/origin. */
  record_revisions: number; records_created: number; calls_replayed: number; calls_applied: number;
  actions_created: Tally; actions_closed: Tally; actions_updated: Tally; reviews: Tally;
  replans_suppressed: number; replans_by_record: Tally;
  holds_by_stage: Tally; nonpaid_jobs_by_stage: Tally; paid_created_unheld: number;
  /** Dry run: the predicted change classes. */
  would_change: number; reasons: Tally; predicted_holds: number; predicted_replans: number; predicted_defaults: number; predicted_calls_unapplied: number;
};
export type ReensureCheckpoint = {
  version: typeof REENSURE_VERSION; run_id: string; database: string; mode: "dry_run" | "apply"; no_progress_plan: boolean;
  as_of: string; closed_cutoff: string; created_at: string; updated_at: string; finished_at: string | null;
  cursor_after: string | null; processed: number;
  /** The record in flight: it is redone from its start on resume (idempotent); its tallies already counted stay counted. */
  current: { record_id: string; touched: string[] } | null;
  replayed_numbers: string[]; touched_keys: string[];
  totals: ReensureTotals; holds: ReensureHold[];
  jobs_before: Record<string, number> | null; jobs_after: Record<string, number> | null;
  bands_before: Tally | null; bands_after: Tally | null; transitions: Tally | null; band_changes: Array<{ record_id: string; before: string; after: string }>;
};
export type ReensureSeams = {
  now?: () => Date;
  save: (checkpoint: ReensureCheckpoint) => Promise<unknown>;
  log: (event: string, fields?: Record<string, unknown>) => Promise<unknown>;
  /** Before-band store (one file per run: it is large and written once). */
  saveBefore: (bands: Record<string, string>) => Promise<unknown>;
  loadBefore: () => Promise<Record<string, string> | null>;
  /** Test seam: called after each committed stage of a record (`ensure`, `replay`, `done`); a throw simulates a crash. */
  stage?: (recordId: string, stage: string, processed: number) => void | Promise<void>;
};
export type ReensureOptions = { apply: boolean; limit?: number | null; batch?: number; noProgressPlan?: boolean };

const emptyTotals = (): ReensureTotals => ({ records: 0, records_changed: 0, records_unchanged: 0, records_missing: 0, record_revisions: 0, records_created: 0,
  calls_replayed: 0, calls_applied: 0, actions_created: {}, actions_closed: {}, actions_updated: {}, reviews: {}, replans_suppressed: 0, replans_by_record: {},
  holds_by_stage: {}, nonpaid_jobs_by_stage: {}, paid_created_unheld: 0, would_change: 0, reasons: {}, predicted_holds: 0, predicted_replans: 0, predicted_defaults: 0,
  predicted_calls_unapplied: 0 });
export function newReensureCheckpoint(database: string, apply: boolean, noProgressPlan: boolean, asOf = new Date()): ReensureCheckpoint {
  return { version: REENSURE_VERSION, run_id: new mongoose.Types.ObjectId().toString(), database, mode: apply ? "apply" : "dry_run", no_progress_plan: noProgressPlan,
    as_of: asOf.toISOString(), closed_cutoff: new Date(+asOf - REENSURE_CLOSED_LOOKBACK_MS).toISOString(), created_at: asOf.toISOString(), updated_at: asOf.toISOString(),
    finished_at: null, cursor_after: null, processed: 0, current: null, replayed_numbers: [], touched_keys: [], totals: emptyTotals(), holds: [],
    jobs_before: null, jobs_after: null, bands_before: null, bands_after: null, transitions: null, band_changes: [] };
}
const bump = (tally: Tally, key: string, by = 1) => { if (by) tally[key] = (tally[key] ?? 0) + by; };
const bandKey = (band: number | null | undefined) => (band == null ? "none" : String(band));
/** Candidate filter: not closed, or closed on/after the cutoff. */
export const reensureCandidateFilter = (cutoff: Date): Record<string, unknown> => ({ purged_at: null, $or: [{ state: { $ne: "closed" } }, { closed_at: { $gte: cutoff } }] });

/** The follow-up label the report counts by: `<kind>/<origin>[/<default_kind | missed_call | promise_retry>]`. */
export function followupLabel(row: { kind?: unknown; origin?: unknown; default_kind?: unknown; missed_episode_key?: unknown; promise_chain?: unknown }): string {
  const variant = row.default_kind ? `/${row.default_kind}` : row.missed_episode_key ? "/missed_call" : row.promise_chain ? "/promise_retry" : "";
  return `${row.kind ?? "?"}/${row.origin ?? "?"}${variant}`;
}

// ── Bands (the publish's derive) ────────────────────────────────────────────────────────────────────
async function bandsFor(ids: mongoose.Types.ObjectId[] | null, filter: Record<string, unknown>, asOf: Date): Promise<Map<string, string>> {
  const [policy, coverage] = await Promise.all([resolvePolicy(), readCaptureCoverage()]);
  const out = new Map<string, string>();
  const derivePage = async (page: RecordRow[]) => {
    const inputs = await loadOutreachInputsBatch(page, asOf);
    for (const record of page) {
      const bundle = inputs.get(String(record._id));
      out.set(String(record._id), bundle ? bandKey(deriveOutreachFacts(record, bundle, { now: asOf, policy, coverage }).attention_band) : "none");
    }
  };
  if (ids) {
    for (let i = 0; i < ids.length; i += BAND_PAGE) {
      const chunk = ids.slice(i, i + BAND_PAGE);
      await derivePage(await getOutreachRecordModel().find({ _id: { $in: chunk } }).sort({ _id: 1 }).lean() as unknown as RecordRow[]);
      for (const id of chunk) if (!out.has(String(id))) out.set(String(id), "missing");
    }
    return out;
  }
  let after: mongoose.Types.ObjectId | null = null;
  for (;;) {
    const page = await getOutreachRecordModel().find({ ...filter, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(BAND_PAGE).lean() as unknown as RecordRow[];
    await derivePage(page);
    if (page.length < BAND_PAGE) break;
    after = page.at(-1)!._id;
  }
  return out;
}

// ── Apply ───────────────────────────────────────────────────────────────────────────────────────────
type TxResult<T> = { value: T; holds: ReensureHold[]; nonpaid: Tally; audits: AuditTally; replans: string[] };
type AuditTally = { touched: string[]; revisions: number; created: number; calls_applied: number; actions_created: Tally; actions_closed: Tally; actions_updated: Tally; reviews: Tally };
let replanSink: string[] | null = null;

function tallyAudits(rows: Array<{ subject_key: string; event_kind: string; prior?: unknown; current?: unknown; invalidation?: { kind?: string } }>): AuditTally {
  const out: AuditTally = { touched: [], revisions: 0, created: 0, calls_applied: 0, actions_created: {}, actions_closed: {}, actions_updated: {}, reviews: {} };
  const touched = new Set<string>();
  for (const row of rows) {
    const kind = row.invalidation?.kind, current = (row.current ?? {}) as Record<string, unknown>, prior = (row.prior ?? {}) as Record<string, unknown>;
    if (kind === "outreach") {
      touched.add(row.subject_key); out.revisions++;
      if (row.event_kind === "outreach_created" || row.event_kind === "number_review_opened") out.created++;
    } else if (kind === "followup") {
      const label = followupLabel(current);
      if (!prior.status) bump(out.actions_created, label);
      else if (prior.status === "open" && current.status !== "open") bump(out.actions_closed, `${current.status}:${label}`);
      else bump(out.actions_updated, `${row.event_kind}:${label}`);
    } else if (kind === "review") bump(out.reviews, `${row.event_kind}:${String(current.cause_kind ?? current.state ?? "?")}`);
    else if (kind === "interaction" && row.event_kind === "outreach_call_applied") out.calls_applied++;
  }
  out.touched = [...touched].sort();
  return out;
}

/**
 * One lap transaction: the work, then (same transaction) every job it created is found, a paid one is
 * put on `operator_hold`, and the audit rows it wrote are tallied. A transient retry re-runs everything.
 */
async function lapTransaction<T>(requestId: string, now: Date, recordId: string, work: (session: ClientSession, context: ReturnType<typeof workerContext>) => Promise<T>): Promise<TxResult<T>> {
  const Jobs = getSalesIntelligenceJobModel(), Audit = getSalesIntelligenceAuditEventModel();
  return withTransaction(async session => {
    const sink: string[] = [];
    replanSink = sink;
    try {
      // The window read first fixes the snapshot: another writer's later job is invisible here, so what is new afterwards is ours.
      // Real time, not the (possibly fixed) clock: job ids carry the wall-clock creation second.
      const window = { _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 300) } };
      const existing = new Set((await Jobs.find(window).select({ _id: 1 }).session(session).lean()).map(j => String(j._id)));
      const context = workerContext(session, requestId, now);
      const value = await work(session, context);
      const created = (await Jobs.find(window).select({ _id: 1, stage: 1, dedupe_key: 1, status: 1 }).session(session).lean()).filter(j => !existing.has(String(j._id)));
      const holds: ReensureHold[] = [], nonpaid: Tally = {};
      for (const job of created) {
        if (!(REENSURE_PAID_STAGES as readonly string[]).includes(job.stage)) { bump(nonpaid, job.stage); continue; }
        const held = await Jobs.updateOne({ _id: job._id, status: { $in: ["pending", "retry"] } }, { $set: { status: "paused", reason: OPERATOR_HOLD_REASON } }, { session });
        if (held.modifiedCount !== 1) throw new Error(`could not hold ${job.stage} ${job.dedupe_key} (status ${job.status}); transaction aborted`);
        holds.push({ job_id: String(job._id), stage: job.stage, dedupe_key: String(job.dedupe_key), record_id: recordId, held_at: now.toISOString() });
      }
      const audits = await Audit.find({ semantic_key: { $regex: `^${context.command_id}:` } }).select({ subject_key: 1, event_kind: 1, prior: 1, current: 1, invalidation: 1 }).session(session).lean();
      return { value, holds, nonpaid, audits: tallyAudits(audits as never), replans: [...sink] };
    } finally { replanSink = null; }
  });
}

function absorb(cp: ReensureCheckpoint, result: TxResult<unknown>, touched: Set<string>) {
  const t = cp.totals, a = result.audits;
  t.record_revisions += a.revisions; t.records_created += a.created; t.calls_applied += a.calls_applied;
  for (const [k, v] of Object.entries(a.actions_created)) bump(t.actions_created, k, v);
  for (const [k, v] of Object.entries(a.actions_closed)) bump(t.actions_closed, k, v);
  for (const [k, v] of Object.entries(a.actions_updated)) bump(t.actions_updated, k, v);
  for (const [k, v] of Object.entries(a.reviews)) bump(t.reviews, k, v);
  for (const [k, v] of Object.entries(result.nonpaid)) bump(t.nonpaid_jobs_by_stage, k, v);
  for (const hold of result.holds) { cp.holds.push(hold); bump(t.holds_by_stage, hold.stage); }
  for (const id of result.replans) { t.replans_suppressed++; bump(t.replans_by_record, id); }
  for (const key of a.touched) touched.add(key);
}
const primaryNumberOf = (record: { subject: RecordRow["subject"]; primary_contact_number_id?: unknown }) =>
  record.primary_contact_number_id ? String(record.primary_contact_number_id) : record.subject.kind === "number_review" && record.subject.contact_number_id ? String(record.subject.contact_number_id) : null;

async function applyRecord(cp: ReensureCheckpoint, recordId: string, bandBefore: string, seams: ReensureSeams, now: Date) {
  const Records = getOutreachRecordModel();
  const before = await Records.findById(recordId).select({ revision: 1, state: 1, subject: 1 }).lean();
  if (!before) { cp.totals.records_missing++; return { missing: true }; }
  const resumed = cp.current?.record_id === recordId;
  const touched = new Set<string>(resumed ? cp.current!.touched : []);
  cp.current = { record_id: recordId, touched: [...touched] };
  const saveCurrent = async () => { cp.current = { record_id: recordId, touched: [...touched].sort() }; cp.updated_at = now.toISOString(); await seams.save(cp); };
  const per = { replans: 0, holds: [] as string[], actions_created: {} as Tally, actions_closed: {} as Tally, calls_replayed: 0, calls_applied: 0, reviews: {} as Tally };
  const note = (r: TxResult<unknown>) => {
    per.replans += r.replans.length; per.holds.push(...r.holds.map(h => `${h.stage}:${h.job_id}`)); per.calls_applied += r.audits.calls_applied;
    for (const [k, v] of Object.entries(r.audits.actions_created)) bump(per.actions_created, k, v);
    for (const [k, v] of Object.entries(r.audits.actions_closed)) bump(per.actions_closed, k, v);
    for (const [k, v] of Object.entries(r.audits.reviews)) bump(per.reviews, k, v);
  };
  // 1. The clock job's pass.
  const ensured = await lapTransaction(`reensure:${cp.run_id}:${recordId}:ensure`, now, recordId, async (session, context) => {
    const row = await Records.findById(recordId).session(session);
    if (!row) return null;
    if (row.subject.kind === "lead") await ensureLead({ model: row.subject.model as "FormLead" | "CallLead", id: String(row.subject.id) }, context);
    const current = await Records.findById(recordId).session(session);
    if (!current) return null;
    if (current.subject.kind !== "lead") await backfillContactFacts(current, context);
    await refreshRecord(current, context, "clock_boundary", current.toObject());
    return primaryNumberOf(current);
  });
  absorb(cp, ensured, touched); note(ensured);
  await saveCurrent();
  await seams.stage?.(recordId, "ensure", cp.processed);
  // 2. The paged replay of the primary Number's calls (no continuation job).
  const numberId = ensured.value;
  if (numberId && !cp.replayed_numbers.includes(numberId)) {
    let after: string | null = null;
    for (;;) {
      const page: TxResult<string[]> = await lapTransaction(`reensure:${cp.run_id}:${recordId}:replay:${after ?? "start"}`, now, recordId, async (session, context) => {
        const rows = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null, ...(after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {}) })
          .sort({ _id: 1 }).limit(OUTREACH_NUMBER_REPLAY_PAGE).session(session).lean();
        for (const row of rows) await ensureInteraction(row as never, context);
        return rows.map(row => String(row._id));
      });
      absorb(cp, page, touched); note(page);
      per.calls_replayed += page.value.length; cp.totals.calls_replayed += page.value.length;
      await saveCurrent();
      await seams.stage?.(recordId, "replay", cp.processed);
      if (page.value.length < OUTREACH_NUMBER_REPLAY_PAGE) break;
      after = page.value.at(-1)!;
    }
    cp.replayed_numbers.push(numberId);
  }
  const afterRow = await Records.findById(recordId).select({ revision: 1, state: 1 }).lean();
  const changed = touched.has(subjectKey(before.subject));
  for (const key of touched) if (!cp.touched_keys.includes(key)) cp.touched_keys.push(key);
  await seams.log("record", { record_id: recordId, subject_key: subjectKey(before.subject), resumed, band_before: bandBefore, state_before: before.state, state_after: afterRow?.state ?? null,
    revision_before: before.revision, revision_after: afterRow?.revision ?? null, changed, other_records_touched: [...touched].filter(k => k !== subjectKey(before.subject)),
    actions_created: per.actions_created, actions_closed: per.actions_closed, reviews: per.reviews, replans_suppressed: per.replans, holds: per.holds,
    calls_replayed: per.calls_replayed, calls_applied: per.calls_applied });
  return { missing: false, changed };
}

// ── Dry run: read-only prediction ───────────────────────────────────────────────────────────────────
type Prediction = { reasons: string[]; touched: Set<string>; holds: number; replans: number; defaults: number; calls_unapplied: number };
type LeanRecord = RecordRow & { _id: mongoose.Types.ObjectId };

/** `ensure.ts` `recentSummarizedConversation` (§8.1), read-only here so the dry run can predict a re-plan without touching `ensure.ts`. */
async function recentSummarizedConversation(numberId: unknown, now: Date, session: ClientSession): Promise<boolean> {
  const recent = await getLeadConversationModel().find({ contact_number_id: numberId as mongoose.Types.ObjectId, started_at: { $gte: new Date(+now - PROGRESS_REPLAN_WINDOW_MS) } })
    .select({ _id: 1, summary: 1 }).sort({ started_at: -1, _id: -1 }).limit(50).session(session).lean();
  if (recent.some(row => row.summary)) return true;
  if (!recent.length) return false;
  return Boolean(await getIntelligenceEvidenceSnapshotModel().exists({ ...csiDataset(), source_type: "summary", artifact_key: { $type: "string" },
    conversation_id: { $in: recent.map(row => row._id) }, purged_at: null, purge_started_at: null }).session(session));
}

/** What `applyLeadProgress` would do (the §3.3/§4 branches), from the pure projection. */
async function predictLeadProgress(record: LeadRecord, lead: object, ref: { model: "FormLead" | "CallLead"; id: string }, official: string | null, openActions: FollowupRow[], now: Date, session: ClientSession, p: Prediction) {
  const canonical = lead as { granot_priority?: unknown; quoted?: unknown };
  const before = (record.lead_progress as LeadProgressRow | null) ?? null;
  const next = projectLeadProgress({ lead: canonical, prior: before, evidence: await latestProgressEvidence(ref, session, canonical), now });
  const state = official ? "closed" : record.state, origin = official ? "official" : record.closure_origin;
  const eligible = official === null && state !== "identity_review" && origin !== "owner";
  const dispositionChanged = before?.disposition_revision !== next.disposition_revision;
  let event = !(before?.fingerprint === next.fingerprint && String(before?.override?.instruction_id ?? "") === String(next.override?.instruction_id ?? ""));
  const terminal = isTerminal(next.disposition);
  const key = subjectKey(record.subject), Reviews = getSalesIntelligenceReviewItemModel();
  let becameOpen = false;
  if (official || origin === "owner") { /* stronger closures keep their reason */ }
  else if (terminal && next.provenance === "accepted" && !next.override) {
    const basis = closureBasisFor(next.disposition);
    if (state !== "closed") { event = true; p.reasons.push("crm_disposition_closure"); }
    else if (origin === "crm_disposition" && record.closed_reason !== basis) event = true;
    if (next.reopen_review_id) event = true;
  } else if (terminal && next.provenance === "accepted" && next.override) { /* override keeps work */ }
  else if (terminal && next.provenance === "uncertain") {
    if (!await Reviews.exists({ subject_key: key, cause_kind: "disposition_review", cause_key: `lead_progress:${next.disposition_revision}` }).session(session)) p.reasons.push("disposition_review");
  } else {
    if (await Reviews.exists({ subject_key: key, cause_kind: "disposition_review", state: "open" }).session(session)) p.reasons.push("disposition_review_resolved");
    if (state === "closed" && origin === "crm_disposition") { if (!next.reopen_review_id) { event = true; p.reasons.push("disposition_reopen_review"); } }
    else if (state === "unworked" && eligible && next.work_observed) { event = true; becameOpen = true; }
  }
  if (!event) return;
  p.reasons.push("lead_progress"); p.touched.add(key);
  const quotedProgress = next.provenance === "accepted" && next.disposition === "quoted" && eligible && (becameOpen || (state === "open" && dispositionChanged));
  if (!quotedProgress) return;
  if (attentionEvolutionEnabled() && !openActions.length && !await getOutreachFollowupModel().exists({ commitment_key: progressDefaultKey(record._id, next.disposition_revision) }).session(session)) {
    p.defaults++; p.reasons.push("progress_default");
  }
  // `nominateProgressReplan`'s gates, in order (the default created just above is not a specific action).
  if (!progressPlanEnabled() || !csiFlag("ENABLED") || !csiFlag("MOVE_ASSESSMENT") || !record.primary_contact_number_id) return;
  if (openActions.some(a => typeof a.default_kind !== "string")) return;
  if (!await recentSummarizedConversation(record.primary_contact_number_id, now, session)) return;
  p.replans++; p.reasons.push("progress_replan");
}
type LeadRecord = LeanRecord;

/** `refreshRecord(…, "clock_boundary")`'s drift: an expired wait to stamp, or a state / next action / wait that moved. */
function clockDrift(record: LeanRecord, openActions: FollowupRow[], now: Date): boolean {
  if (openActions.some(a => a.kind === "wait" && a.due_at && a.due_at <= now && !a.wait_expired_at)) return true;
  if (stateWithActions(record, openActions, now) !== record.state) return true;
  const next = [...openActions].sort((a, b) => +(attentionDue(a) ?? new Date(8640000000000000)) - +(attentionDue(b) ?? new Date(8640000000000000)) || String(a._id).localeCompare(String(b._id)))[0];
  if (String(next?._id ?? null) !== String(record.next_action?.followup_id ?? null) || +(next?.due_at ?? 0) !== +(record.next_action?.due_at ?? 0)) return true;
  const wait = record.state === "waiting_on_customer" ? openActions.find(a => a.kind === "wait") : null;
  return String(wait?._id ?? null) !== String(record.wait_followup_id ?? null) || +(wait?.due_at ?? 0) !== +(record.wait_until ?? 0);
}

/** `ensureInteraction`'s routing and fences for every call on the Number, read-only. */
async function predictCalls(numberId: string, now: Date, session: ClientSession, p: Prediction) {
  const number = await getContactNumberModel().findById(numberId).session(session).lean();
  if (!number || number.kind !== "external" || ["company", "non_customer"].includes(number.classification)) return;
  const Records = getOutreachRecordModel(), Reviews = getSalesIntelligenceReviewItemModel(), Audit = getSalesIntelligenceAuditEventModel();
  const reviewHas = async (subject_key: string, cause_kind: string, cause_key: string, evidence: string) =>
    Boolean(await Reviews.exists({ subject_key, cause_kind, cause_key, evidence_ids: new mongoose.Types.ObjectId(evidence) } as never).session(session));
  let after: mongoose.Types.ObjectId | null = null;
  for (;;) {
    const calls = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(PREDICT_CALL_PAGE).session(session).lean();
    for (const call of calls as unknown as Array<Parameters<typeof interactionAttribution>[0] & { purged_at?: Date | null }>) {
      if (call.purged_at) continue;
      if (call.sources.includes("backfill") && (!await historicalCaptureReady(call.started_at, session) || !await historicalAttachmentsReady(numberId, session))) continue;
      if (call.direction === "Internal" || call.monitoring) continue;
      const attribution = await interactionAttribution(call, session);
      const callId = String(call._id), missed = call.direction === "Inbound" && call.terminal && !call.provider_connected && call.contact_type !== "human_conversation";
      let target: LeanRecord | null = null, key: string;
      if (attribution.lead_ref) {
        key = `lead:${attribution.lead_ref.model}:${attribution.lead_ref.id}`;
        target = await Records.findOne({ "subject.kind": "lead", "subject.model": attribution.lead_ref.model, "subject.id": attribution.lead_ref.id }).session(session).lean() as LeanRecord | null;
        if (!target) { if (await loadLead(attribution.lead_ref, session)) { p.touched.add(key); p.reasons.push("record_created"); p.calls_unapplied++; } continue; }
        if (!target.primary_contact_number_id) { p.touched.add(key); p.reasons.push("number_linked"); }
      }
      if (!attribution.lead_effects_allowed && attribution.blocked_reason !== "unlinked") {
        if (!await reviewHas(`number:${numberId}`, "identity", numberId, callId)) p.reasons.push("identity_review");
        for (const ref of attribution.applicable_leads) {
          const blocked = await Records.findOne({ "subject.kind": "lead", "subject.model": ref.model, "subject.id": ref.id }).session(session).lean() as LeanRecord | null;
          if (!blocked || !["closed", "identity_review"].includes(blocked.state)) { p.touched.add(`lead:${ref.model}:${ref.id}`); p.reasons.push("identity_blocked"); }
        }
        continue;
      }
      if (!attribution.lead_ref) {
        key = `number:${numberId}`;
        const related = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId, state: { $ne: "rejected" } }).session(session).lean();
        let closedRelated = false;
        for (const edge of related) {
          const ref = { model: edge.lead_ref.model as "FormLead" | "CallLead", id: String(edge.lead_ref.id) };
          const closed = await Records.findOne({ "subject.model": ref.model, "subject.id": edge.lead_ref.id, state: "closed" }).session(session).lean() as LeanRecord | null;
          const lead = closed ? null : await loadLead(ref, session);
          if (closed || (lead && await authoritativeClosure(lead, ref, session))) {
            if (missed && (!closed?.closed_at || call.started_at > closed.closed_at) && !await reviewHas(closed ? subjectKey(closed.subject) : key, "closed_work_request", callId, callId)) p.reasons.push("closed_work_request");
            closedRelated = true; break;
          }
        }
        if (closedRelated) continue;
        target = await Records.findOne({ "subject.kind": "number_review", "subject.contact_number_id": numberId }).session(session).lean() as LeanRecord | null;
        if (!target) {
          if (missed && call.inbound_route_id && number.contact_eligibility?.state !== "suppressed") { p.touched.add(key); p.reasons.push("record_created"); p.calls_unapplied++; }
          continue;
        }
      }
      key = subjectKey(target!.subject);
      if (target!.state === "closed") {
        if (missed && (!target!.closed_at || call.started_at > target!.closed_at) && !await reviewHas(key, "closed_work_request", callId, callId)) p.reasons.push("closed_work_request");
        continue;
      }
      if (target!.state === "identity_review" && attribution.lead_effects_allowed) { p.touched.add(key); p.reasons.push("identity_resolved"); }
      const rep = await interactionRepIdentity(call as never, session);
      const seen = await Audit.exists({ subject_key: key, event_kind: "outreach_call_applied", "current.interaction_id": callId, "current.projection_revision": call.projection_revision,
        "current.rep_identity_fingerprint": rep.fingerprint }).session(session);
      if (!seen) { p.touched.add(key); p.calls_unapplied++; p.reasons.push("call_unapplied"); }
    }
    if (calls.length < PREDICT_CALL_PAGE) break;
    after = calls.at(-1)!._id as mongoose.Types.ObjectId;
  }
}

async function predictRecord(cp: ReensureCheckpoint, recordId: string, session: ClientSession, now: Date): Promise<Prediction | null> {
  const record = await getOutreachRecordModel().findById(recordId).session(session).lean() as LeanRecord | null;
  if (!record) return null;
  const p: Prediction = { reasons: [], touched: new Set(), holds: 0, replans: 0, defaults: 0, calls_unapplied: 0 };
  const key = subjectKey(record.subject);
  const openActions = await getOutreachFollowupModel().find({ outreach_record_id: record._id, status: "open" }).session(session).lean() as unknown as FollowupRow[];
  if (attentionEvolutionEnabled() && contactFactsMissing(record)) { p.reasons.push("contact_facts"); p.touched.add(key); }
  let official: string | null = null;
  if (record.subject.kind === "lead") {
    const ref = { model: record.subject.model as "FormLead" | "CallLead", id: String(record.subject.id) };
    const lead = await loadLead(ref, session);
    if (lead) {
      // `ensureLead`: official/authoritative closure first (`closeRecord` is a no-op when already closed that way), then Lead progress.
      official = await authoritativeClosure(lead, ref, session);
      if (official && !(record.state === "closed" && record.closed_reason === official && record.closure_origin === "official")) {
        p.reasons.push(`official_closure:${official}`); p.touched.add(key); p.holds++;
      }
      if (csiFlag("LEAD_PROGRESS")) await predictLeadProgress(record, lead, ref, official, openActions, now, session, p);
    } else p.reasons.push("lead_missing");
  }
  if (!p.touched.has(key) && clockDrift(record, openActions, now)) { p.reasons.push("clock_boundary"); p.touched.add(key); }
  const numberId = primaryNumberOf(record);
  if (numberId && !cp.replayed_numbers.includes(numberId)) { await predictCalls(numberId, now, session, p); cp.replayed_numbers.push(numberId); }
  return p;
}

// ── The walk ────────────────────────────────────────────────────────────────────────────────────────
export async function runReensureOutreach(options: ReensureOptions, cp: ReensureCheckpoint, seams: ReensureSeams) {
  const now = seams.now ?? (() => new Date());
  const asOf = new Date(cp.as_of), cutoff = new Date(cp.closed_cutoff), filter = reensureCandidateFilter(cutoff);
  const batch = Math.max(1, options.batch ?? 25), limit = options.limit ?? null;
  const noProgressPlan = options.noProgressPlan ?? cp.no_progress_plan;
  cp.jobs_before ??= await paidJobCounts();
  // Pre-pass: every candidate's band before the lap (read-only, the publish's derive at `as_of`).
  let before = await seams.loadBefore();
  if (!before) {
    before = Object.fromEntries(await bandsFor(null, filter, asOf));
    await seams.saveBefore(before);
    cp.bands_before = {};
    for (const band of Object.values(before)) bump(cp.bands_before, band);
  }
  await seams.log("started", { mode: cp.mode, as_of: cp.as_of, closed_cutoff: cp.closed_cutoff, cursor_after: cp.cursor_after, processed: cp.processed, candidates: Object.keys(before).length,
    bands_before: cp.bands_before, jobs_before: cp.jobs_before, no_progress_plan: noProgressPlan });
  if (cp.mode === "apply" && noProgressPlan) setProgressPlanSuppressor(recordId => { replanSink?.push(recordId); });
  const session = await mongoose.connection.startSession();
  let exhausted = false;
  try {
    while (limit === null || cp.processed < limit) {
      const page = await getOutreachRecordModel().find({ ...filter, ...(cp.cursor_after ? { _id: { $gt: new mongoose.Types.ObjectId(cp.cursor_after) } } : {}) })
        .select({ _id: 1 }).sort({ _id: 1 }).limit(limit === null ? batch : Math.max(1, Math.min(batch, limit - cp.processed))).lean();
      if (!page.length) { exhausted = true; break; }
      for (const { _id } of page) {
        const id = String(_id), bandBefore = before[id] ?? "absent";
        const at = now();
        if (cp.mode === "apply") {
          const result = await applyRecord(cp, id, bandBefore, seams, at);
          if (!result.missing) { cp.totals.records++; if (result.changed) cp.totals.records_changed++; else cp.totals.records_unchanged++; }
        } else {
          const p = await predictRecord(cp, id, session, at);
          if (!p) cp.totals.records_missing++;
          else {
            cp.totals.records++;
            const reasons = [...new Set(p.reasons)];
            for (const reason of p.reasons) bump(cp.totals.reasons, reason);
            cp.totals.predicted_holds += p.holds; cp.totals.predicted_replans += p.replans; cp.totals.predicted_defaults += p.defaults; cp.totals.predicted_calls_unapplied += p.calls_unapplied;
            if (p.replans) bump(cp.totals.replans_by_record, id, p.replans);
            const record = await getOutreachRecordModel().findById(id).select({ subject: 1, state: 1 }).session(session).lean();
            const self = record ? subjectKey(record.subject) : "";
            if (p.touched.has(self)) cp.totals.would_change++; else cp.totals.records_unchanged++;
            for (const key of p.touched) if (!cp.touched_keys.includes(key)) cp.touched_keys.push(key);
            await seams.log("record", { record_id: id, subject_key: self, band_before: bandBefore, state: record?.state ?? null, would_change: p.touched.has(self), reasons,
              touched: [...p.touched].sort(), predicted_holds: p.holds, predicted_replans: p.replans, predicted_defaults: p.defaults, calls_unapplied: p.calls_unapplied });
          }
        }
        cp.cursor_after = id; cp.processed++; cp.current = null; cp.updated_at = now().toISOString();
        await seams.save(cp);
        await seams.stage?.(id, "done", cp.processed);
        if (limit !== null && cp.processed >= limit) break;
      }
    }
  } finally {
    await session.endSession();
    if (cp.mode === "apply" && noProgressPlan) setProgressPlanSuppressor(null);
  }
  cp.jobs_after = await paidJobCounts();
  if (cp.mode === "apply") {
    // Scoped to what the lap created: every paid job it created must be held (the hold is in the creating transaction).
    const held = cp.holds.length ? await getSalesIntelligenceJobModel().countDocuments({ _id: { $in: cp.holds.map(h => new mongoose.Types.ObjectId(h.job_id)) }, status: "paused", reason: OPERATOR_HOLD_REASON }) : 0;
    cp.totals.paid_created_unheld = cp.holds.length - held;
  }
  if (exhausted) {
    cp.finished_at = now().toISOString();
    if (cp.mode === "apply") {
      // Post-pass: the same derive at the same `as_of`, over the candidates plus every record the lap created.
      const created = await getOutreachRecordModel().find({ ...filter, _id: { $nin: Object.keys(before).map(id => new mongoose.Types.ObjectId(id)) } }).select({ _id: 1 }).lean();
      const ids = [...Object.keys(before).map(id => new mongoose.Types.ObjectId(id)), ...created.map(row => row._id as mongoose.Types.ObjectId)];
      const after = await bandsFor(ids, filter, asOf);
      cp.bands_after = {}; cp.transitions = {}; cp.band_changes = [];
      for (const [id, band] of after) {
        bump(cp.bands_after, band);
        const was = before[id] ?? "absent";
        bump(cp.transitions, `${was}->${band}`);
        if (was !== band) { cp.band_changes.push({ record_id: id, before: was, after: band }); await seams.log("band", { record_id: id, before: was, after: band }); }
      }
    }
  }
  cp.updated_at = now().toISOString();
  await seams.save(cp);
  await seams.log("finished", { mode: cp.mode, processed: cp.processed, finished: cp.finished_at !== null, totals: cp.totals, holds: cp.holds.length,
    jobs_before: cp.jobs_before, jobs_after: cp.jobs_after, bands_before: cp.bands_before, bands_after: cp.bands_after });
  if (cp.mode === "apply" && cp.totals.paid_created_unheld !== 0) throw new Error(`${cp.totals.paid_created_unheld} paid job(s) created by the lap are not on operator_hold`);
  return cp;
}

/** Operator decision: hand the held jobs back to production consumers (they are paid). */
export async function releaseReensureHolds(cp: ReensureCheckpoint, seams: Pick<ReensureSeams, "save" | "log" | "now">) {
  const Jobs = getSalesIntelligenceJobModel();
  let released = 0;
  for (const hold of cp.holds) {
    const result = await Jobs.updateOne({ _id: hold.job_id, status: "paused", reason: OPERATOR_HOLD_REASON }, { $set: { status: "pending", reason: null, next_attempt_at: (seams.now ?? (() => new Date()))() } });
    released += result.modifiedCount;
    await seams.log("released_to_production", { job_id: hold.job_id, stage: hold.stage, record_id: hold.record_id, released: result.modifiedCount === 1 });
  }
  cp.holds = [];
  await seams.save(cp);
  return released;
}

// ── Files, report and summary ───────────────────────────────────────────────────────────────────────
export function fileSeams(base: string, runId: string, echo: (line: string) => void = () => undefined): Omit<ReensureSeams, "now" | "stage"> {
  const jsonl = `${base}.jsonl`, beforePath = `${base}.before.json`, checkpointPath = `${base}.checkpoint.json`;
  const atomic = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(`${path}.tmp`, text); await rename(`${path}.tmp`, path); };
  let pending = Promise.resolve();
  return {
    save: cp => atomic(checkpointPath, JSON.stringify(cp, null, 1)),
    saveBefore: bands => atomic(beforePath, JSON.stringify({ run_id: runId, bands })),
    loadBefore: async () => {
      if (!existsSync(beforePath)) return null;
      const parsed = JSON.parse(await readFile(beforePath, "utf8")) as { run_id: string; bands: Record<string, string> };
      return parsed.run_id === runId ? parsed.bands : null;
    },
    log: (event, fields = {}) => {
      const line = JSON.stringify({ at: new Date().toISOString(), run_id: runId, event, ...fields });
      if (event !== "record" && event !== "band") echo(line);
      pending = pending.then(async () => { await mkdir(dirname(jsonl), { recursive: true }); await appendFile(jsonl, line + "\n"); });
      return pending;
    },
  };
}

/** The machine-readable summary (step 9 reads `bands_before` from it). */
export function reensureSummary(cp: ReensureCheckpoint, flags: Record<string, boolean>) {
  return { version: cp.version, run_id: cp.run_id, mode: cp.mode, database: cp.database, as_of: cp.as_of, closed_cutoff: cp.closed_cutoff, finished_at: cp.finished_at,
    no_progress_plan: cp.no_progress_plan, flags, processed: cp.processed, bands_before: cp.bands_before, bands_after: cp.bands_after, transitions: cp.transitions,
    totals: cp.totals, holds: cp.holds.length, touched_records: cp.touched_keys.length, jobs_before: cp.jobs_before, jobs_after: cp.jobs_after };
}

export function reensureReport(cp: ReensureCheckpoint, env: string, flags: Record<string, boolean>, files: { checkpoint: string; jsonl: string; summary: string }): string {
  const t = cp.totals, apply = cp.mode === "apply";
  const table = (tally: Tally | null) => {
    const rows = Object.entries(tally ?? {}).sort(([a], [b]) => a.localeCompare(b));
    return rows.length ? ["| Key | Count |", "|---|---|", ...rows.map(([k, v]) => `| \`${k}\` | ${v} |`)] : ["(none)"];
  };
  const bands = ["1", "2", "3", "4", "5", "6", "7", "none", "absent", "missing"];
  const paid = cp.jobs_before && cp.jobs_after ? REENSURE_PAID_STAGES.map(s => `${s} ${cp.jobs_before![s]} → ${cp.jobs_after![s]}`).join("; ") : "not measured";
  return [
    `# S10 step 6: Outreach re-ensure lap (${env}${apply ? "" : ", dry run"})`, "",
    `- Mode: **${apply ? "apply" : "dry run (read only; predictions)"}**; database \`${cp.database}\`; run \`${cp.run_id}\`; ${cp.created_at} → ${cp.finished_at ?? "(not finished; resume)"}`,
    `- Script: \`scripts/dev_ops/reensure-outreach.ts\` (${cp.version}); \`--no-progress-plan\` ${cp.no_progress_plan ? "on" : "OFF"}; flags ${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `- Candidates: not closed, or closed on/after ${cp.closed_cutoff} (as_of ${cp.as_of}); processed ${cp.processed}${cp.cursor_after ? `, cursor after \`${cp.cursor_after}\`` : ""}`,
    `- Files: checkpoint \`${files.checkpoint}\`, JSONL \`${files.jsonl}\`, summary \`${files.summary}\``, "",
    "| Headline | Count |", "|---|---|",
    `| Records processed | ${t.records} (missing ${t.records_missing}) |`,
    apply ? `| Records changed (own revision written) | ${t.records_changed} |` : `| Records that would change | ${t.would_change} |`,
    `| Records unchanged | ${t.records_unchanged} |`,
    `| Records touched in total (incl. other records a replayed call belongs to) | ${cp.touched_keys.length} |`,
    ...(apply ? [
      `| Record revisions written | ${t.record_revisions} |`, `| Records created | ${t.records_created} |`,
      `| Calls replayed / newly applied | ${t.calls_replayed} / ${t.calls_applied} |`,
      `| Paid jobs put on \`operator_hold\` | ${cp.holds.length} (${Object.entries(t.holds_by_stage).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}) |`,
      `| Paid jobs created unheld | **${t.paid_created_unheld}** |`,
    ] : [
      `| Calls not yet applied | ${t.predicted_calls_unapplied} |`,
      `| \`number_refresh\` that apply would hold | ${t.predicted_holds} |`,
      `| P4 quote defaults that apply would create | ${t.predicted_defaults} |`,
    ]),
    `| Re-plans ${apply ? "suppressed by `--no-progress-plan`" : "that would be nominated (suppressed on apply)"} | **${apply ? t.replans_suppressed : t.predicted_replans}** (${Object.keys(t.replans_by_record).length} records) |`,
    "", `Paid-stage jobs claimable before → after: ${paid}. Held (operator_hold): ${cp.jobs_before?.operator_hold ?? "?"} → ${cp.jobs_after?.operator_hold ?? "?"}.`, "",
    "## Bands (the publish's `derive()` at `as_of`)", "",
    `| Band | Before | ${apply ? "After" : "After (apply only)"} |`, "|---|---|---|",
    ...bands.filter(b => (cp.bands_before?.[b] ?? 0) || (cp.bands_after?.[b] ?? 0)).map(b => `| ${b} | ${cp.bands_before?.[b] ?? 0} | ${apply ? cp.bands_after?.[b] ?? (cp.finished_at ? 0 : "—") : "—"} |`), "",
    ...(apply ? ["### Transitions (before->after)", "", ...table(Object.fromEntries(Object.entries(cp.transitions ?? {}).filter(([k]) => k.split("->")[0] !== k.split("->")[1]))), ""] : []),
    ...(apply ? [
      "## Actions created (kind/origin[/variant])", "", ...table(t.actions_created), "",
      "## Actions closed (status:kind/origin[/variant])", "", ...table(t.actions_closed), "",
      "## Reviews", "", ...table(t.reviews), "",
      "## Non-paid jobs created", "", ...table(t.nonpaid_jobs_by_stage), "",
    ] : ["## Predicted change classes (per occurrence)", "", ...table(t.reasons), ""]),
    `## ${apply ? "Suppressed" : "Predicted"} re-plans by record`, "", ...table(t.replans_by_record), "",
  ].join("\n");
}
