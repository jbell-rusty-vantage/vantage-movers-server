/**
 * S6-P5 / S10 step 4 core: the Priority 5 reconcile (assignment addendum §2.3, E1/E2; reconciliation §5).
 * Used by `scripts/dev_ops/reconcile-priority5.ts` and its replica proof `test-si-priority5.replica.test.ts`.
 *
 * Candidates, walked by `_id` with a resumable cursor:
 *   1. every FormLead / CallLead whose canonical `granot_priority` is `5`;
 *   2. every Outreach record closed `crm_disposition` / `granot_booked` whose Lead is no longer `5`
 *      (it may upgrade to `booked`, or now carry a reopen review).
 *
 * Dry run (default) is READ-ONLY: it projects each candidate with the pure `projectLeadProgress` (the
 * PRIORITY5_CLOSURE mapping on) and `authoritativeClosure`, and classifies what `ensureLead` would do.
 * Apply runs the live `ensureLead` (the minute worker's code path) per candidate in bounded page
 * transactions. A Lead with no Outreach record is counted and skipped (this is a reconcile, not a creator).
 *
 * Paid work: a Priority 5 closure enqueues nothing (§12, `closeRecord` skips `crm_disposition`). The E2
 * upgrade (and any official closure the walk meets) enqueues the usual `number_refresh`; apply puts that
 * job on `operator_hold` (status `paused`, which no cron or consumer claims) in the same transaction, as
 * the CC-07 repair does, and records it in the manifest. Any other job created in a transaction aborts it.
 * `--release-holds` (operator decision) hands the held jobs back to production consumers.
 */
import mongoose from "mongoose";
import { withTransaction } from "../../../src/db";
import { getFormLeadModel } from "../../../src/models/FormLead";
import { getCallLeadModel } from "../../../src/models/CallLead";
import { getOutreachRecordModel } from "../../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../src/models/OutreachFollowup";
import { getSalesIntelligenceJobModel } from "../../../src/models/SalesIntelligenceJob";
import { ensureLead, latestProgressEvidence, workerContext } from "../../../src/services/salesIntelligence/outreach/ensure";
import { authoritativeClosure } from "../../../src/services/salesIntelligence/outreach/transitions";
import { normalizePriority, PRIORITY5_CODE, projectLeadProgress, type LeadProgressRow } from "../../../src/services/salesIntelligence/outreach/leadProgress";
import { OPERATOR_HOLD_REASON } from "./call-log-repair";

export const P5_RECONCILE_VERSION = "priority5-reconcile-v1" as const;
export const P5_PAID_STAGES = ["transcription", "analysis", "application", "number_refresh", "move_assessment"] as const;
const CLAIMABLE = ["pending", "retry", "leased"] as const;
type Model = "FormLead" | "CallLead";
type Phase = Model | "closed" | "done";

export type P5Hold = { job_id: string; record_id: string; dedupe_key: string; held_at: string };
export type P5Manifest = {
  version: typeof P5_RECONCILE_VERSION; run_id: string; database: string; mode: "dry_run" | "apply";
  created_at: string; updated_at: string; finished_at: string | null;
  cursor: { phase: Phase; after: string | null }; processed: number;
  counts: Record<string, number>; holds: P5Hold[];
  jobs_before: Record<string, number> | null; jobs_after: Record<string, number> | null;
};
export type P5Seams = {
  now?: () => Date;
  save: (manifest: P5Manifest) => Promise<unknown>;
  log: (event: string, fields?: Record<string, unknown>) => Promise<unknown>;
};
export function newP5Manifest(database: string, apply: boolean, now = new Date()): P5Manifest {
  return { version: P5_RECONCILE_VERSION, run_id: new mongoose.Types.ObjectId().toString(), database, mode: apply ? "apply" : "dry_run",
    created_at: now.toISOString(), updated_at: now.toISOString(), finished_at: null, cursor: { phase: "FormLead", after: null }, processed: 0,
    counts: {}, holds: [], jobs_before: null, jobs_after: null };
}
const bump = (counts: Record<string, number>, key: string, by = 1) => { counts[key] = (counts[key] ?? 0) + by; };
/** The Lead collections through Mongoose's collection wrapper (typed once, still seen by `mongoose.set("debug")`). */
const leadModel = (model: Model) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection;

/** Paid-stage jobs a consumer could claim, by stage, plus this runner's holds (the job-table counter). */
export async function paidJobCounts(): Promise<Record<string, number>> {
  const Jobs = getSalesIntelligenceJobModel(), out: Record<string, number> = {};
  for (const stage of P5_PAID_STAGES) out[stage] = await Jobs.countDocuments({ stage, status: { $in: CLAIMABLE } });
  out.operator_hold = await Jobs.countDocuments({ status: "paused", reason: OPERATOR_HOLD_REASON });
  out.total = await Jobs.countDocuments({});
  return out;
}

type RecordLean = { _id: mongoose.Types.ObjectId; state: string; revision: number; closure_origin?: string | null; closed_reason?: string | null; closed_at?: Date | null; lead_progress?: unknown };
type LeadLean = { _id: mongoose.Types.ObjectId; granot_priority?: unknown; quoted?: unknown; duplicate?: boolean; bad_lead?: unknown; booked?: unknown; cancelled?: unknown; no_sync?: boolean };

/**
 * What `ensureLead` would do to one record (pure; the dry-run bucket). The order is `ensureLead`'s:
 * official closure (and the E2 upgrade) → Owner closure → CRM disposition by provenance.
 */
export function classifyPriority5(record: RecordLean, official: string | null, next: LeadProgressRow): string {
  const crmBooked = record.state === "closed" && record.closure_origin === "crm_disposition" && record.closed_reason === "granot_booked";
  if (official) {
    if (crmBooked && official === "booked") return "would_upgrade_to_booked";
    if (record.state === "closed" && record.closure_origin === "official" && record.closed_reason === official) return `already_official_${official}`;
    return `would_close_official_${official}`;
  }
  if (record.state === "closed" && record.closure_origin === "owner") return "owner_closed_unchanged";
  if (next.disposition !== "crm_booked") return crmBooked ? `granot_booked_now_${next.disposition}${next.reopen_review_id ? "_reopen_review_open" : "_would_open_reopen_review"}` : `not_priority5_${next.disposition}`;
  if (next.provenance !== "accepted") return record.state === "closed" ? `uncertain_closed_${record.closure_origin ?? "unknown"}_unchanged` : "uncertain_would_open_review_stays_active";
  if (next.override) return "accepted_override_keeps_open";
  if (crmBooked) return "already_granot_booked";
  if (record.state === "closed" && record.closure_origin === "crm_disposition") return "would_refresh_closed_reason_to_granot_booked";
  return "would_close_granot_booked";
}

/** The candidate refs of one page for the current phase, advancing the cursor. */
async function nextPage(manifest: P5Manifest, page: number): Promise<Array<{ ref: { model: Model; id: string }; key: string }>> {
  for (;;) {
    const { phase, after } = manifest.cursor;
    if (phase === "done") return [];
    const afterFilter = after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {};
    if (phase === "FormLead" || phase === "CallLead") {
      const rows = await leadModel(phase).find({ granot_priority: PRIORITY5_CODE, ...afterFilter }, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(page).toArray();
      if (!rows.length) { manifest.cursor = { phase: phase === "FormLead" ? "CallLead" : "closed", after: null }; continue; }
      return rows.map(row => ({ ref: { model: phase, id: String(row._id) }, key: String(row._id) }));
    }
    const rows = await getOutreachRecordModel().find({ "subject.kind": "lead", state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_booked", ...afterFilter })
      .sort({ _id: 1 }).limit(page).select({ _id: 1, subject: 1 }).lean();
    if (!rows.length) { manifest.cursor = { phase: "done", after: null }; return []; }
    const out: Array<{ ref: { model: Model; id: string }; key: string }> = [];
    for (const row of rows) {
      const ref = { model: row.subject.model as Model, id: String(row.subject.id) };
      const lead = await leadModel(ref.model).findOne({ _id: new mongoose.Types.ObjectId(ref.id) }, { projection: { granot_priority: 1 } }) as LeadLean | null;
      // A Lead still on 5 was handled in phases 1–2; count it only once.
      if (lead && normalizePriority(lead.granot_priority) === PRIORITY5_CODE) { out.push({ ref, key: `skip:${row._id}` }); continue; }
      out.push({ ref, key: String(row._id) });
    }
    return out;
  }
}
const advance = (manifest: P5Manifest, key: string) => { manifest.cursor.after = key.startsWith("skip:") ? key.slice(5) : key; };

/** Dry run of one candidate: reads only (no transaction, no write). */
async function dryRunOne(ref: { model: Model; id: string }, session: mongoose.ClientSession, now: Date) {
  const lead = await leadModel(ref.model).findOne({ _id: new mongoose.Types.ObjectId(ref.id) }) as LeadLean | null;
  if (!lead) return { bucket: "lead_missing" };
  const record = await getOutreachRecordModel().findOne({ "subject.kind": "lead", "subject.model": ref.model, "subject.id": lead._id }).lean() as RecordLean | null;
  if (!record) return { bucket: "no_outreach_record" };
  const official = await authoritativeClosure(lead, ref, session);
  const next = projectLeadProgress({ lead, prior: (record.lead_progress as LeadProgressRow | null) ?? null, evidence: await latestProgressEvidence(ref, session, lead), now });
  const bucket = classifyPriority5(record, official, next);
  const openActions = bucket === "would_close_granot_booked" ? await getOutreachFollowupModel().countDocuments({ outreach_record_id: record._id, status: "open" }) : 0;
  const openDefaults = bucket === "would_close_granot_booked" ? await getOutreachFollowupModel().countDocuments({ outreach_record_id: record._id, status: "open", default_kind: { $type: "string" } }) : 0;
  return { bucket, record_id: String(record._id), open_actions_cancelled: openActions, open_defaults_cancelled: openDefaults };
}

/** Apply of one candidate inside the page transaction: the live `ensureLead`, then hold its closure job. */
async function applyOne(ref: { model: Model; id: string }, session: mongoose.ClientSession, now: Date, requestId: string) {
  const Records = getOutreachRecordModel(), Jobs = getSalesIntelligenceJobModel();
  const before = await Records.findOne({ "subject.kind": "lead", "subject.model": ref.model, "subject.id": new mongoose.Types.ObjectId(ref.id) }).session(session).lean() as RecordLean | null;
  if (!before) return { bucket: (await leadModel(ref.model).findOne({ _id: new mongoose.Types.ObjectId(ref.id) }, { projection: { _id: 1 }, session })) ? "no_outreach_record" : "lead_missing" };
  // Jobs visible in this transaction's snapshot before the write; anything new afterwards is ours.
  // Real time, not the (possibly fixed) clock: job ids carry the wall-clock creation second.
  const recent = { _id: { $gt: mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 3_600_000) / 1000)) } } as Record<string, unknown>;
  const existing = new Set((await Jobs.find(recent).select({ _id: 1 }).session(session).lean()).map(j => String(j._id)));
  const context = workerContext(session, requestId, now);
  await ensureLead(ref, context);
  const after = await Records.findById(before._id).session(session).lean() as RecordLean;
  const created = (await Jobs.find(recent).select({ _id: 1, stage: 1, dedupe_key: 1, status: 1 }).session(session).lean()).filter(j => !existing.has(String(j._id)));
  const holds: P5Hold[] = [];
  for (const job of created) {
    if (job.stage !== "number_refresh" || !String(job.dedupe_key).startsWith(`csi:outreach-closure:${before._id}:`))
      throw new Error(`unexpected job ${job.stage} (${job.dedupe_key}) created for ${ref.model}:${ref.id}; transaction aborted`);
    const result = await Jobs.updateOne({ _id: job._id, status: { $in: ["pending", "retry"] } }, { $set: { status: "paused", reason: OPERATOR_HOLD_REASON } }, { session });
    if (result.modifiedCount !== 1) throw new Error(`could not hold ${job.dedupe_key}`);
    holds.push({ job_id: String(job._id), record_id: String(before._id), dedupe_key: String(job.dedupe_key), held_at: now.toISOString() });
  }
  const wasGranot = before.state === "closed" && before.closure_origin === "crm_disposition" && before.closed_reason === "granot_booked";
  const isGranot = after.state === "closed" && after.closure_origin === "crm_disposition" && after.closed_reason === "granot_booked";
  const progress = after.lead_progress as LeadProgressRow | null;
  const uncertain = progress?.disposition === "crm_booked" && progress.provenance !== "accepted" && after.state !== "closed";
  let bucket: string;
  if (after.revision === before.revision) bucket = "unchanged";
  else if (uncertain) bucket = "uncertain_review_opened";
  else if (wasGranot && after.closure_origin === "official" && after.closed_reason === "booked") {
    bucket = "upgraded_to_booked";
    if (+(after.closed_at ?? 0) !== +(before.closed_at ?? 0)) throw new Error(`upgrade changed closed_at for ${before._id}`);
  } else if (isGranot && !wasGranot) bucket = before.state === "closed" && before.closure_origin === "crm_disposition" ? "refreshed_closed_reason_to_granot_booked" : "closed_granot_booked";
  else if (after.closure_origin === "official" && (before.closure_origin !== "official" || before.state !== "closed")) bucket = `closed_official_${after.closed_reason}`;
  else bucket = `changed_${before.state}_to_${after.state}`;
  return { bucket, record_id: String(before._id), held_number_refresh: holds.length, uncertain_priority5_review: uncertain, holds };
}

/**
 * The walk. Resumable: the manifest carries the cursor and every count, and is saved after each page.
 * Dry run: no transaction and no write. Apply: one transaction per page (`page` candidates).
 */
export async function runPriority5Reconcile(options: { apply: boolean; limit?: number | null; page?: number }, manifest: P5Manifest, seams: P5Seams) {
  const now = seams.now ?? (() => new Date());
  const page = options.page ?? 25, limit = options.limit ?? null;
  manifest.jobs_before ??= await paidJobCounts();
  await seams.log("started", { mode: manifest.mode, cursor: manifest.cursor, processed: manifest.processed, jobs_before: manifest.jobs_before });
  const session = await mongoose.connection.startSession();
  try {
    while (manifest.cursor.phase !== "done" && (limit === null || manifest.processed < limit)) {
      const candidates = await nextPage(manifest, limit === null ? page : Math.max(1, Math.min(page, limit - manifest.processed)));
      if (!candidates.length) break;
      const phase = manifest.cursor.phase;
      const results: Array<{ key: string; ref: { model: Model; id: string }; result: Record<string, unknown> & { bucket: string } }> = [];
      const at = now();
      if (options.apply) {
        // A transient-error retry re-runs the callback from scratch; results (and holds) are taken only after commit.
        await withTransaction(async tx => {
          results.length = 0;
          for (const { ref, key } of candidates) {
            if (key.startsWith("skip:")) { results.push({ key, ref, result: { bucket: "counted_in_priority5_phase" } }); continue; }
            results.push({ key, ref, result: await applyOne(ref, tx, at, `p5-reconcile:${manifest.run_id}:${phase}:${candidates[0]!.key}`) });
          }
        });
        for (const { result } of results) if (Array.isArray(result.holds)) manifest.holds.push(...(result.holds as P5Hold[]));
      } else {
        for (const { ref, key } of candidates) {
          if (key.startsWith("skip:")) { results.push({ key, ref, result: { bucket: "counted_in_priority5_phase" } }); continue; }
          results.push({ key, ref, result: await dryRunOne(ref, session, at) });
        }
      }
      for (const { key, ref, result } of results) {
        bump(manifest.counts, `${phase}:${result.bucket}`); bump(manifest.counts, result.bucket);
        if (typeof result.open_actions_cancelled === "number") bump(manifest.counts, "open_actions_would_cancel", result.open_actions_cancelled);
        if (typeof result.open_defaults_cancelled === "number") bump(manifest.counts, "open_quote_defaults_would_cancel", result.open_defaults_cancelled);
        if (typeof result.held_number_refresh === "number") bump(manifest.counts, "held_number_refresh", result.held_number_refresh);
        if (result.uncertain_priority5_review === true) bump(manifest.counts, "apply_uncertain_priority5_review");
        const { holds: _holds, ...fields } = result;
        await seams.log("candidate", { phase, model: ref.model, lead_id: ref.id, ...fields });
        advance(manifest, key);
        if (!key.startsWith("skip:")) manifest.processed++;
      }
      manifest.updated_at = now().toISOString();
      await seams.save(manifest);
    }
  } finally { await session.endSession(); }
  manifest.jobs_after = await paidJobCounts();
  if (manifest.cursor.phase === "done") manifest.finished_at = now().toISOString();
  manifest.updated_at = now().toISOString();
  await seams.save(manifest);
  await seams.log("finished", { mode: manifest.mode, processed: manifest.processed, counts: manifest.counts, jobs_before: manifest.jobs_before, jobs_after: manifest.jobs_after, holds: manifest.holds.length });
  return manifest;
}

/** Operator decision: hand the held `number_refresh` jobs back to production consumers (they are paid). */
export async function releasePriority5Holds(manifest: P5Manifest, seams: P5Seams) {
  const Jobs = getSalesIntelligenceJobModel();
  let released = 0;
  for (const hold of [...manifest.holds]) {
    const result = await Jobs.updateOne({ _id: hold.job_id, status: "paused", reason: OPERATOR_HOLD_REASON }, { $set: { status: "pending", reason: null, next_attempt_at: (seams.now ?? (() => new Date()))() } });
    released += result.modifiedCount;
    await seams.log("released_to_production", { job_id: hold.job_id, record_id: hold.record_id, released: result.modifiedCount === 1 });
  }
  manifest.holds = [];
  await seams.save(manifest);
  return released;
}

/** The S10-4 report body (identifiers and counts only). */
export function priority5Report(manifest: P5Manifest, env: string, flags: Record<string, boolean>): string {
  const c = manifest.counts, n = (key: string) => c[key] ?? 0;
  const closeCount = manifest.mode === "apply" ? n("closed_granot_booked") + n("refreshed_closed_reason_to_granot_booked") : n("would_close_granot_booked") + n("would_refresh_closed_reason_to_granot_booked");
  const uncertain = manifest.mode === "apply" ? n("apply_uncertain_priority5_review") : n("uncertain_would_open_review_stays_active");
  const upgrade = manifest.mode === "apply" ? n("upgraded_to_booked") : n("would_upgrade_to_booked");
  const paidDelta = manifest.jobs_before && manifest.jobs_after ? P5_PAID_STAGES.map(stage => `${stage} ${manifest.jobs_before![stage]} → ${manifest.jobs_after![stage]}`).join("; ") : "not measured";
  return [
    `# S10 step 4: Priority 5 reconcile (${env})`, "",
    `- Mode: **${manifest.mode}**; database \`${manifest.database}\`; run \`${manifest.run_id}\`; ${manifest.created_at} → ${manifest.finished_at ?? "(not finished; resume)"}`,
    `- Script: \`scripts/dev_ops/reconcile-priority5.ts\` (${P5_RECONCILE_VERSION}); flags ${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `- Candidates processed: ${manifest.processed}; cursor ${manifest.cursor.phase}${manifest.cursor.after ? ` after ${manifest.cursor.after}` : ""}`, "",
    "| Headline | Count |", "|---|---|",
    `| ${manifest.mode === "apply" ? "Closed" : "Would close"} as \`granot_booked\` (accepted Priority 5) | ${closeCount} |`,
    `| Uncertain provenance (disposition review, stays active) | ${uncertain} |`,
    `| ${manifest.mode === "apply" ? "Upgraded" : "Would upgrade"} to official \`booked\` (exact Booking, E2) | ${upgrade} |`,
    `| Open actions ${manifest.mode === "apply" ? "cancelled" : "that would be cancelled"} by the closures (of them quote defaults) | ${n("open_actions_would_cancel")} (${n("open_quote_defaults_would_cancel")}) |`,
    `| \`number_refresh\` put on \`operator_hold\` | ${manifest.mode === "apply" ? n("held_number_refresh") : `0 (dry run; ${upgrade + Object.entries(c).filter(([k]) => /^would_close_official_/.test(k)).reduce((s, [, v]) => s + v, 0)} would be held)`} |`,
    "", `Paid-stage jobs claimable before → after: ${paidDelta}. Held (operator_hold): ${manifest.jobs_before?.operator_hold ?? "?"} → ${manifest.jobs_after?.operator_hold ?? "?"}.`, "",
    "## Every bucket", "", "| Bucket | Count |", "|---|---|",
    ...Object.entries(c).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `| \`${k}\` | ${v} |`), "",
  ].join("\n");
}
