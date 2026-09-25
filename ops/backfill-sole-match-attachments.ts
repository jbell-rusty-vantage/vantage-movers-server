/**
 * Backfill Number↔Lead attachments with the live sole-match rule
 * (`sole-match-v1` / `sole_non_duplicate_match`). S10-REPAIR step 2 (reconciliation addendum §5).
 *
 * Dry run unless `--apply` is passed. A write calls `persistLeadAttachments`,
 * the same function the attachment worker uses: lock the Contact Number,
 * refresh the pair from current phone evidence, fan-in, then `autoAttachNumber`.
 * That decision reads the complete normalized match set inside the transaction.
 * A duplicate Lead is neither a target nor a competitor. Bad Lead and No-Sync
 * are competitors and never the target. An Owner decision or a rejected pair
 * is left alone. An attached edge whose Outreach mirror is stale is repaired with
 * `reactToAttachmentChanged` (the attachment hook's Outreach half).
 *
 * Booked, Cancelled, Quoted and Granot Priority are not identity filters.
 * After a real attach, `onAttachmentChanged` → `ensureLead` applies them:
 * an exact Booking or Cancellation closes Outreach, and Lead progress projects
 * the stored Quoted flag and Priority (7/8 closes; it does not block the
 * attach). This script does not create a Booking and does not change the
 * official Lead.
 *
 * S10 rules (added for S10-REPAIR, 2026-09-24):
 * - dry run by default, and READ-ONLY (a session without a transaction; no write command; replica-proven
 *   with the server's `top` write counters and dbHash, `test-si-sole-match-backfill.replica.test.ts`);
 * - `--allow-production` is required for any database that is not a loopback `testvantagemovers_*` one,
 *   in either mode; `--apply` runs the production-writer drift guard (run from the deployed commit);
 * - resumable: apply saves `ops/output/sole-match-attachment-backfill.checkpoint.json`
 *   (cursor, counts, holds) after every write and every page; `--resume` continues it; a new apply
 *   archives an older checkpoint instead of overwriting it. Every Number's outcome goes to a JSONL log;
 * - zero model calls: on apply, every paid-stage job (`number_refresh` from an official closure, `analysis`,
 *   `application`, `transcription`, `move_assessment`) created inside an attach or mirror transaction is put
 *   on `operator_hold` (status `paused`) in that same transaction and recorded in the checkpoint; AC6-PLAN
 *   re-plans are suppressed (`setProgressPlanSuppressor`) and counted; the paid-stage job counters are read
 *   before and after. `--release-holds` (operator decision, later) hands the held jobs back;
 * - report into `sales-intelligence-ui-ux-workspace/evidence/S10-2-<env>[-dry-run].md` (or `--report-dir`).
 * - The Attention publish at the end is opt-in (`--publish`): the minute cron publishes with the deployed
 *   flags; a publish from this process would use this process's flags.
 *
 *   node --env-file=.env --import tsx ops/backfill-sole-match-attachments.ts --allow-production                  # dry run
 *   node --env-file=.env --import tsx ops/backfill-sole-match-attachments.ts --job=5564884 --allow-production     # one job's Numbers
 *   node --env-file=.env --import tsx ops/backfill-sole-match-attachments.ts --apply --allow-production [--resume] [--limit=N]
 *   node --env-file=.env --import tsx ops/backfill-sole-match-attachments.ts --apply --allow-production --release-holds
 *
 * Reports contain ids, job numbers and operational outcomes. They do not
 * contain phone numbers.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { csiFlag } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { phoneEvidence, loadLead, type LeadSource } from "../src/services/salesIntelligence/attachment/sources";
import { lockNumber, persistLeadAttachments, planEdge } from "../src/services/salesIntelligence/attachment/store";
import { completeNormalizedMatchSet, planSoleMatch, SOLE_MATCH_POLICY_VERSION, type MatchSetResult } from "../src/services/salesIntelligence/attachment/matchSet";
import { latestProgressEvidence, reactToAttachmentChanged } from "../src/services/salesIntelligence/outreach/ensure";
import { authoritativeClosure } from "../src/services/salesIntelligence/outreach/transitions";
import { projectLeadProgress, type LeadProgressRow } from "../src/services/salesIntelligence/outreach/leadProgress";
import { setProgressPlanSuppressor } from "../src/services/salesIntelligence/outreach/types";
import { publishAttentionSnapshot } from "../src/services/salesIntelligence/outreach/attention";
import type { LeadRef } from "../src/services/salesIntelligence/attachment/suggest";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";
import { jsonlLogger, OPERATOR_HOLD_REASON } from "./lib/call-log-repair";
import { P5_PAID_STAGES, paidJobCounts } from "./lib/priority5-reconcile";

const arg = (name: string) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const PAGE = Number(arg("page") ?? 40);
const OUT_DIR = arg("out") ?? "ops/output";
const CHECKPOINT = `${OUT_DIR}/sole-match-attachment-backfill.checkpoint.json`;
const WORKSPACE_EVIDENCE = resolve(process.cwd(), "../sales-intelligence-ui-ux-workspace/evidence");
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

type Model = LeadRef["model"];
type LeadRow = LeadSource & { granot_priority?: unknown; quoted?: unknown };
type Outcome = {
  number_id: string;
  lead_model: Model;
  lead_id: string;
  job_no: string | null;
  quoted: boolean | null;
  granot_priority: string | null;
  disposition: string;
  work_observed: boolean;
  basis: string | null;
  provenance: string;
  official_closure: string | null;
  edge: string;
  action: string;
  attachment_state?: string | null;
  decision_reason?: string | null;
  outreach_state?: string | null;
  closure_origin?: string | null;
  mirror_state?: string | null;
  held_jobs?: number;
  nonpaid_jobs?: Record<string, number>;
  replans_suppressed?: number;
};
type Hold = { job_id: string; stage: string; dedupe_key: string; number_id: string; held_at: string };

const bump = (counts: Record<string, number>, key: string, by = 1) => {
  if (by) counts[key] = (counts[key] ?? 0) + by;
};

function quotedOf(lead: { quoted?: unknown }): boolean | null {
  return typeof lead.quoted === "boolean" ? lead.quoted : null;
}

async function progressOf(lead: LeadRow, ref: LeadRef, session: mongoose.ClientSession) {
  const closure = await authoritativeClosure(lead, ref, session);
  const evidence = await latestProgressEvidence(ref, session, lead);
  const existing = await getOutreachRecordModel().findOne({
    "subject.kind": "lead", "subject.model": ref.model, "subject.id": ref.id,
  }).select({ lead_progress: 1 }).session(session).lean();
  const projected = projectLeadProgress({
    lead,
    prior: (existing?.lead_progress as LeadProgressRow | null) ?? null,
    evidence,
    now: new Date(),
  });
  return {
    official_closure: closure,
    quoted: quotedOf(lead),
    granot_priority: projected.granot_priority,
    disposition: projected.disposition,
    work_observed: projected.work_observed,
    basis: projected.basis,
    provenance: projected.provenance,
  };
}

function classify(set: MatchSetResult, edges: ReturnType<typeof planEdge>[]) {
  const plan = planSoleMatch(set, edges);
  if (set.status !== "complete") return { bucket: `lookup_unknown_${set.reason ?? "unknown"}`, plan };
  if (!set.candidates.length) return { bucket: "no_candidate", plan };
  if (set.candidates.length > 1) return { bucket: "competing", plan };
  if (!set.target) return { bucket: "ineligible_bad_or_no_sync", plan };
  if (plan.blocked === "owner_decision") return { bucket: "owner_protected", plan };
  if (plan.blocked === "already_attached") return { bucket: "already_attached", plan };
  if (plan.blocked === "competing_attached") return { bucket: "competing_attached", plan };
  if (plan.blocked === "no_phone_evidence") return { bucket: "no_phone_evidence", plan };
  if (plan.attach || plan.blocked === "target_edge_missing") return { bucket: "would_attach", plan };
  return { bucket: plan.blocked ?? "not_attached", plan };
}

async function evaluateNumber(number: { _id: unknown; e164?: string | null; national_ten?: string | null }, session: mongoose.ClientSession) {
  const set = await completeNormalizedMatchSet(number, session);
  const rows = await getNumberLeadAttachmentModel().find({ contact_number_id: number._id as mongoose.Types.ObjectId }).session(session).lean();
  const decision = classify(set, rows.map((row) => planEdge(row)));
  const forms = set.candidates.filter((candidate) => candidate.lead_ref.model === "FormLead").length;
  const calls = set.candidates.filter((candidate) => candidate.lead_ref.model === "CallLead").length;
  const oneFormOneCall = forms === 1 && calls === 1;
  const target = set.target;
  if (!target || (decision.bucket !== "would_attach" && decision.bucket !== "already_attached")) {
    return { decision, outcome: null as Outcome | null, oneFormOneCall };
  }
  const lead = await loadLead(target, session) as LeadRow | null;
  if (!lead) return { decision, outcome: null, oneFormOneCall };
  const progress = await progressOf(lead, target, session);
  const edge = rows.find((row) => row.lead_ref.model === target.model && String(row.lead_ref.id) === target.id);
  const phoneHits = number.e164 ? phoneEvidence(lead, target.model).some((item) => item.e164 === number.e164) : false;
  const action = decision.bucket === "already_attached"
    ? "already_attached"
    : phoneHits || edge?.evidence?.length
      ? "attach"
      : "skip_no_current_phone_evidence";
  const outcome: Outcome = {
    number_id: String(number._id),
    lead_model: target.model,
    lead_id: target.id,
    job_no: lead.job_no ?? null,
    ...progress,
    edge: edge ? edge.state : "missing",
    action,
  };
  return { decision, outcome, oneFormOneCall };
}

/**
 * S10: the mirror state of an attached pair. `reactToAttachmentChanged` writes the mirror only on an open
 * record whose primary Number is this one, so a closed record or a record on another primary is reported
 * (`mirror_record_closed`, `mirror_other_primary`) and never "repaired": that write would only lock the
 * Number (revision +1) on every run and change nothing. A missing record is repairable (the hook creates it).
 */
async function mirrorIsCurrent(ref: LeadRef, numberId: string) {
  const record = await getOutreachRecordModel().findOne({
    "subject.kind": "lead",
    "subject.model": ref.model,
    "subject.id": ref.id,
  }).select({ lead_attachment: 1, state: 1, closure_origin: 1, lead_progress: 1, primary_contact_number_id: 1 }).lean();
  const mirror = record?.lead_attachment;
  const current = Boolean(record && String(record.primary_contact_number_id ?? "") === numberId &&
    mirror && mirror.state === "attached" && mirror.lead_ref.model === ref.model && String(mirror.lead_ref.id) === ref.id);
  const skip = current || !record ? null
    : record.primary_contact_number_id && String(record.primary_contact_number_id) !== numberId ? "mirror_other_primary"
      : record.state === "closed" ? "mirror_record_closed"
        : null;
  return { record, current, skip, missing_record: !record };
}

async function readOutcome(seed: Outcome): Promise<Outcome> {
  const [edge, record] = await Promise.all([
    getNumberLeadAttachmentModel().findOne({
      contact_number_id: seed.number_id,
      "lead_ref.model": seed.lead_model,
      "lead_ref.id": seed.lead_id,
    }).select({ state: 1, decision_reason: 1, auto_decision: 1 }).lean(),
    getOutreachRecordModel().findOne({
      "subject.kind": "lead",
      "subject.model": seed.lead_model,
      "subject.id": seed.lead_id,
    }).select({ state: 1, closure_origin: 1, lead_attachment: 1, lead_progress: 1, primary_contact_number_id: 1 }).lean(),
  ]);
  const progress = record?.lead_progress as LeadProgressRow | null | undefined;
  return {
    ...seed,
    quoted: progress?.quoted ?? seed.quoted,
    granot_priority: progress?.granot_priority ?? seed.granot_priority,
    disposition: progress?.disposition ?? seed.disposition,
    work_observed: progress?.work_observed ?? seed.work_observed,
    basis: progress?.basis ?? seed.basis,
    provenance: progress?.provenance ?? seed.provenance,
    attachment_state: edge?.state ?? null,
    decision_reason: edge?.decision_reason ?? edge?.auto_decision?.reason ?? null,
    outreach_state: record?.state ?? null,
    closure_origin: record?.closure_origin ?? null,
    mirror_state: record?.primary_contact_number_id && String(record.primary_contact_number_id) === seed.number_id
      ? record.lead_attachment?.state ?? null
      : record?.lead_attachment?.state ?? null,
  };
}

// ── S10: the write transaction holds the paid work it creates ─────────────────────────────────────────
let replanSink: string[] | null = null;
type Held<T> = { value: T; holds: Hold[]; nonpaid: Record<string, number>; replans: string[] };
/**
 * One attach or mirror transaction. The job-window read first fixes the snapshot, so a job that is new
 * afterwards is this transaction's. A paid-stage job is put on `operator_hold` in the same transaction
 * (a transient retry re-runs everything); a non-paid job (`attachment_refresh`, `outreach_ensure`) is counted.
 */
async function heldTransaction<T>(numberId: string, work: (session: mongoose.ClientSession) => Promise<T>): Promise<Held<T>> {
  const Jobs = getSalesIntelligenceJobModel();
  return withTransaction(async (session) => {
    const sink: string[] = [];
    replanSink = sink;
    try {
      // Real time: job ids carry the wall-clock creation second.
      const window = { _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 300) } };
      const existing = new Set((await Jobs.find(window).select({ _id: 1 }).session(session).lean()).map((j) => String(j._id)));
      const value = await work(session);
      const created = (await Jobs.find(window).select({ _id: 1, stage: 1, dedupe_key: 1, status: 1 }).session(session).lean()).filter((j) => !existing.has(String(j._id)));
      const holds: Hold[] = [], nonpaid: Record<string, number> = {};
      for (const job of created) {
        if (!(P5_PAID_STAGES as readonly string[]).includes(job.stage)) { bump(nonpaid, job.stage); continue; }
        const held = await Jobs.updateOne({ _id: job._id, status: { $in: ["pending", "retry"] } }, { $set: { status: "paused", reason: OPERATOR_HOLD_REASON } }, { session });
        if (held.modifiedCount !== 1) throw new Error(`could not hold ${job.stage} ${job.dedupe_key} (status ${job.status}); transaction aborted`);
        holds.push({ job_id: String(job._id), stage: job.stage, dedupe_key: String(job.dedupe_key), number_id: numberId, held_at: new Date().toISOString() });
      }
      return { value, holds, nonpaid, replans: [...sink] };
    } finally { replanSink = null; }
  });
}

async function attachOne(numberId: string, ref: LeadRef) {
  return heldTransaction(numberId, async (session): Promise<"attached" | "skipped" | "unchanged"> => {
    const number = await getContactNumberModel().findById(numberId, { national_ten: 1, e164: 1 }).session(session).lean();
    if (!number) return "skipped";
    const set = await completeNormalizedMatchSet(number, session);
    if (!set.target || set.target.model !== ref.model || set.target.id !== ref.id) return "skipped";
    const existing = await getNumberLeadAttachmentModel().findOne({
      contact_number_id: numberId,
      "lead_ref.model": ref.model,
      "lead_ref.id": ref.id,
    }).session(session).lean();
    if (existing?.decided_at || existing?.state === "rejected") return "skipped";
    if (existing?.state === "attached") return "unchanged";
    const lead = await loadLead(ref, session);
    if (!lead || lead.duplicate === true) return "skipped";
    const changed = await persistLeadAttachments(lead, ref.model, session, new mongoose.Types.ObjectId().toString(), new Date(), numberId);
    return changed > 0 ? "attached" : "unchanged";
  });
}

async function repairMirror(numberId: string, ref: LeadRef) {
  return heldTransaction(numberId, async (session): Promise<"repaired" | "skipped"> => {
    const number = await getContactNumberModel().findById(numberId, { national_ten: 1, e164: 1 }).session(session).lean();
    if (!number) return "skipped";
    const set = await completeNormalizedMatchSet(number, session);
    if (!set.target || set.target.model !== ref.model || set.target.id !== ref.id) return "skipped";
    const edge = await getNumberLeadAttachmentModel().findOne({
      contact_number_id: numberId,
      "lead_ref.model": ref.model,
      "lead_ref.id": ref.id,
      state: "attached",
    }).session(session).lean();
    if (!edge) return "skipped";
    const lock = await lockNumber(numberId, session);
    await reactToAttachmentChanged({ number_id: numberId, revision: lock.revision }, session);
    return "repaired";
  });
}

async function numbersForJob(job: string) {
  const found: Array<{ model: Model; lead: LeadRow }> = [];
  for (const model of ["FormLead", "CallLead"] as const) {
    const rows = model === "FormLead"
      ? await getFormLeadModel().find({ job_no: job }).lean()
      : await getCallLeadModel().find({ job_no: job }).lean();
    for (const lead of rows) found.push({ model, lead: lead as LeadRow });
  }
  const ids = new Set<string>();
  for (const { model, lead } of found) {
    const e164s = [...new Set(phoneEvidence(lead, model).map((item) => item.e164))];
    if (!e164s.length) continue;
    const numbers = await getContactNumberModel().find({
      e164: { $in: e164s },
      kind: "external",
      purged_at: null,
      classification: { $nin: ["company", "non_customer"] },
    }).select({ _id: 1 }).lean();
    for (const number of numbers) ids.add(String(number._id));
  }
  return { leads: found.map(({ model, lead }) => ({
    model,
    id: String(lead._id),
    job_no: lead.job_no ?? null,
    duplicate: Boolean(lead.duplicate),
    bad_lead: Boolean(lead.bad_lead),
    no_sync: lead.no_sync === true,
    quoted: quotedOf(lead),
    granot_priority: lead.granot_priority ?? null,
    booked: Boolean(lead.booked),
    cancelled: Boolean(lead.cancelled),
    contact_numbers: ids.size,
  })), numberIds: [...ids] };
}

type Checkpoint = {
  policy_version: string;
  database: string;
  run_id?: string;
  started_at: string;
  after: string | null;
  done: boolean;
  counts: Record<string, number>;
  holds?: Hold[];
  jobs_before?: Record<string, number> | null;
};

async function saveCheckpoint(checkpoint: Checkpoint) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${CHECKPOINT}.tmp`, JSON.stringify(checkpoint, null, 2));
  await rename(`${CHECKPOINT}.tmp`, CHECKPOINT);
}

type Log = (event: string, fields?: Record<string, unknown>) => Promise<unknown>;

async function scan(applying: boolean, onlyIds: string[] | null, resume: boolean, limit: number | null, log: Log, runId: string) {
  const counts: Record<string, number> = {};
  const outcomes: Outcome[] = [];
  const database = getMongoDatabaseName();
  let checkpoint: Checkpoint | null = null;
  if (applying && !onlyIds && existsSync(CHECKPOINT)) {
    const prior = JSON.parse(await readFile(CHECKPOINT, "utf8")) as Checkpoint;
    if (resume && prior.policy_version === SOLE_MATCH_POLICY_VERSION && prior.database === database) checkpoint = prior;
    else if (!resume) await rename(CHECKPOINT, CHECKPOINT.replace(/\.json$/, `.${prior.run_id ?? prior.started_at.replace(/[:.]/g, "-")}.json`));
  }
  if (applying && resume && !onlyIds && !checkpoint) throw new Error(`no ${SOLE_MATCH_POLICY_VERSION} checkpoint for ${database} at ${CHECKPOINT} to resume`);
  checkpoint ??= {
    policy_version: SOLE_MATCH_POLICY_VERSION,
    database,
    run_id: runId,
    started_at: new Date().toISOString(),
    after: null,
    done: false,
    counts: {},
    holds: [],
    jobs_before: null,
  };
  checkpoint.holds ??= [];
  checkpoint.jobs_before ??= await paidJobCounts();
  Object.assign(counts, checkpoint.counts);
  let processedHere = 0;
  const session = await mongoose.connection.startSession();
  const absorb = (outcome: Outcome, held: Held<unknown>) => {
    checkpoint!.holds!.push(...held.holds);
    outcome.held_jobs = held.holds.length;
    outcome.nonpaid_jobs = held.nonpaid;
    outcome.replans_suppressed = held.replans.length;
    for (const hold of held.holds) bump(counts, `held_${hold.stage}`);
    for (const [stage, n] of Object.entries(held.nonpaid)) bump(counts, `nonpaid_job_${stage}`, n);
    bump(counts, "replans_suppressed", held.replans.length);
  };
  try {
    let after = checkpoint.after;
    for (;;) {
      if (limit !== null && processedHere >= limit) break;
      const filter = {
        kind: "external" as const,
        purged_at: null,
        classification: { $nin: ["company", "non_customer"] },
        ...(onlyIds ? { _id: { $in: onlyIds } } : after ? { _id: { $gt: after } } : {}),
      };
      const size = onlyIds ? Math.max(onlyIds.length, 1) : limit === null ? PAGE : Math.max(1, Math.min(PAGE, limit - processedHere));
      const page = await getContactNumberModel().find(filter as Record<string, unknown>).sort({ _id: 1 }).limit(size)
        .select({ national_ten: 1, e164: 1, classification: 1 }).lean();
      if (!page.length) { checkpoint.done = true; break; }
      for (const number of page) {
        bump(counts, "numbers_scanned");
        const { decision, outcome, oneFormOneCall } = await evaluateNumber(number, session);
        bump(counts, decision.bucket);
        if (oneFormOneCall) bump(counts, "competing_one_form_one_call");
        let wrote = false;
        let logged: Outcome | null = null;
        if (!outcome || outcome.action === "already_attached") {
          if (outcome?.action === "already_attached") {
            const mirror = await mirrorIsCurrent({ model: outcome.lead_model, id: outcome.lead_id }, outcome.number_id);
            if (mirror.current) bump(counts, "already_attached_mirror_ok");
            else if (mirror.skip) {
              logged = { ...outcome, action: mirror.skip, outreach_state: mirror.record?.state ?? null };
              outcomes.push(logged);
              bump(counts, mirror.skip);
            } else if (!applying) {
              logged = { ...outcome, action: "would_repair_mirror" };
              outcomes.push(logged);
              bump(counts, "would_repair_mirror");
              if (mirror.missing_record) bump(counts, "would_repair_mirror_creates_record");
              if (outcome.official_closure) bump(counts, `would_repair_mirror_official_${outcome.official_closure}`);
            } else {
              const held = await repairMirror(outcome.number_id, { model: outcome.lead_model, id: outcome.lead_id });
              const written = await readOutcome({ ...outcome, action: held.value === "repaired" ? "mirror_repaired" : "mirror_skipped" });
              // An official closure the repair applied closes the record; the hook then writes no mirror on it.
              if (written.action === "mirror_repaired" && written.mirror_state !== "attached")
                written.action = written.outreach_state === "closed" ? "mirror_repair_closed_record" : "mirror_not_primary";
              absorb(written, held);
              outcomes.push(written);
              logged = written;
              wrote = held.value === "repaired";
              bump(counts, written.action);
              bump(counts, `closure_${written.official_closure ?? "none"}`);
            }
          }
        } else if (outcome.action !== "attach") {
          outcomes.push(outcome);
          logged = outcome;
          bump(counts, outcome.action);
        } else if (!applying) {
          outcomes.push(outcome);
          logged = { ...outcome, action: "would_attach" };
          bump(counts, `would_attach_closure_${outcome.official_closure ?? "none"}`);
          bump(counts, `would_attach_disposition_${outcome.disposition}`);
          if (outcome.quoted === true) bump(counts, "would_attach_quoted");
          if (outcome.work_observed) bump(counts, "would_attach_work_observed");
        } else {
          const held = await attachOne(outcome.number_id, { model: outcome.lead_model, id: outcome.lead_id });
          const written = await readOutcome({ ...outcome, action: held.value === "attached" ? "attached" : held.value === "unchanged" ? "unchanged" : "skipped_on_recheck" });
          absorb(written, held);
          outcomes.push(written);
          logged = written;
          wrote = held.value === "attached";
          bump(counts, written.action);
          if (written.attachment_state === "attached") bump(counts, "attachment_state_attached");
          if (written.official_closure) bump(counts, `attached_official_${written.official_closure}`);
          if (written.quoted === true) bump(counts, "attached_quoted");
          bump(counts, `attached_disposition_${written.disposition}`);
          if (written.official_closure && written.outreach_state !== "closed") bump(counts, "official_closure_not_closed");
        }
        await log("number", { number_id: String(number._id), bucket: decision.bucket, ...(logged ? { outcome: logged } : {}) });
        after = String(number._id);
        checkpoint.after = after;
        checkpoint.counts = counts;
        processedHere++;
        // A committed write (and its holds) is checkpointed at once, so a crash never loses a hold.
        if (wrote && applying && !onlyIds) await saveCheckpoint(checkpoint);
      }
      if (applying && !onlyIds) await saveCheckpoint(checkpoint);
      console.log(JSON.stringify({ phase: "page", scanned: counts.numbers_scanned, would_attach: counts.would_attach ?? 0, attached: counts.attached ?? 0, competing: counts.competing ?? 0 }));
      if (onlyIds) { checkpoint.done = true; break; }
    }
  } finally { await session.endSession(); }
  if (applying && !onlyIds) await saveCheckpoint(checkpoint);
  return { counts, outcomes, done: checkpoint.done, checkpoint };
}

async function releaseHolds(log: Log) {
  if (!existsSync(CHECKPOINT)) throw new Error(`no checkpoint at ${CHECKPOINT}`);
  const checkpoint = JSON.parse(await readFile(CHECKPOINT, "utf8")) as Checkpoint;
  const Jobs = getSalesIntelligenceJobModel();
  let released = 0;
  for (const hold of checkpoint.holds ?? []) {
    const result = await Jobs.updateOne({ _id: hold.job_id, status: "paused", reason: OPERATOR_HOLD_REASON }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
    released += result.modifiedCount;
    await log("released_to_production", { job_id: hold.job_id, stage: hold.stage, number_id: hold.number_id, released: result.modifiedCount === 1 });
  }
  checkpoint.holds = [];
  await saveCheckpoint(checkpoint);
  return released;
}

function renderReport(input: {
  env: string; database: string; applying: boolean; runId: string; started: Date; job: string | null; counts: Record<string, number>; done: boolean;
  holds: Hold[]; jobsBefore: Record<string, number> | null; jobsAfter: Record<string, number>; unheld: number; flags: Record<string, boolean>; files: Record<string, string>; argv: string;
}) {
  const c = input.counts, n = (key: string) => c[key] ?? 0;
  const paid = input.jobsBefore ? P5_PAID_STAGES.map((s) => `${s} ${input.jobsBefore![s]} → ${input.jobsAfter[s]}`).join("; ") : "not measured";
  const headline = input.applying
    ? [
      `| Attached (sole match) | ${n("attached")} |`,
      `| Mirrors repaired | ${n("mirror_repaired")} (closed by the official closure the repair applied ${n("mirror_repair_closed_record")}, not primary ${n("mirror_not_primary")}, skipped ${n("mirror_skipped")}) |`,
      `| Paid jobs put on \`operator_hold\` | ${input.holds.length} |`,
      `| Paid jobs created unheld | **${input.unheld}** |`,
      `| Re-plans suppressed | **${n("replans_suppressed")}** |`,
    ]
    : [
      `| Would attach (sole match) | ${n("would_attach")} |`,
      `| Would repair the Outreach mirror | ${n("would_repair_mirror")} (of them with an official closure: booked ${n("would_repair_mirror_official_booked")}, cancelled ${n("would_repair_mirror_official_cancelled")}; creates the record ${n("would_repair_mirror_creates_record")}) |`,
      `| \`number_refresh\` apply could hold (upper bound: targets with an official closure) | ${n("would_repair_mirror_official_booked") + n("would_repair_mirror_official_cancelled") + n("would_attach_closure_booked") + n("would_attach_closure_cancelled")} |`,
    ];
  return [
    `# S10 step 2: sole-match attachment backfill (${input.env}${input.applying ? "" : ", dry run"})`, "",
    `- Mode: **${input.applying ? "apply" : "dry run (read only)"}**; database \`${input.database}\`; run \`${input.runId}\`; ${input.started.toISOString()} → ${new Date().toISOString()}${input.done ? "" : " (not finished; `--resume`)"}`,
    `- Script: \`ops/backfill-sole-match-attachments.ts\` (${SOLE_MATCH_POLICY_VERSION}); \`${input.argv}\`${input.job ? `; job ${input.job}` : ""}`,
    `- Flags in this process: ${Object.entries(input.flags).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `- Files: ${Object.entries(input.files).map(([k, v]) => `${k} \`${v}\``).join(", ")}`, "",
    "| Headline | Count |", "|---|---|",
    `| Numbers scanned | ${n("numbers_scanned")} |`,
    `| Already attached, mirror current | ${n("already_attached_mirror_ok")} |`,
    `| Attached, mirror stale but not repairable by the hook (record closed / on another primary Number) | ${n("mirror_record_closed")} / ${n("mirror_other_primary")} |`,
    `| Competing (of them one Form + one Call) | ${n("competing")} (${n("competing_one_form_one_call")}) |`,
    `| No candidate | ${n("no_candidate")} |`,
    ...headline,
    "", `Paid-stage jobs claimable before → after: ${paid}. Held (operator_hold): ${input.jobsBefore?.operator_hold ?? "?"} → ${input.jobsAfter.operator_hold}. Zero model calls: the script never calls a model; ${input.applying ? "every paid job it created is on `operator_hold`" : "the dry run writes nothing"}.`, "",
    "## Every bucket", "", "| Bucket | Count |", "|---|---|",
    ...Object.entries(c).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `| \`${k}\` | ${v} |`), "",
  ].join("\n");
}

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  const applying = flag("apply");
  if (applying) {
    process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "true";
    process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "true";
    process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = "true";
  }
  await connectMongo();
  const database = getMongoDatabaseName();
  const production = database === "vantagemovers";
  const local = localDatabase(database, process.env.MONGO_URI);
  if (!local && !flag("allow-production")) throw new Error(`${database} is not a loopback testvantagemovers_* database; pass --allow-production`);
  if (applying) {
    // With PRIORITY5_CLOSURE off here, ensureLead would read 5 as unmapped and open a disposition_reopen review on every granot_booked record.
    if (!csiFlag("PRIORITY5_CLOSURE") && await getOutreachRecordModel().exists({ state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_booked" }))
      throw new Error("--apply requires SALES_INTELLIGENCE_PRIORITY5_CLOSURE=true: records are closed granot_booked");
    await assertProductionWriterMatchesDeployment();
  }
  const env = production ? "production" : local ? "replica" : database;
  const job = arg("job");
  const started = new Date();
  const runId = new mongoose.Types.ObjectId().toString();
  const jsonl = `${OUT_DIR}/sole-match-attachment-backfill-${applying ? "apply" : "dry"}-${started.toISOString().replace(/[:.]/g, "-")}.jsonl`;
  const log = jsonlLogger(jsonl, runId, (line) => { if (!line.includes('"event":"number"')) console.log(line); });
  if (flag("release-holds")) {
    if (!applying) throw new Error("--release-holds needs --apply (it hands paid work back to production consumers)");
    console.log(JSON.stringify({ released: await releaseHolds(log) }));
    return;
  }
  const flags = Object.fromEntries((["AUTO_ATTACH", "OUTREACH_ENSURE", "LEAD_PROGRESS", "PRIORITY5_CLOSURE", "PROGRESS_PLAN", "ATTENTION_EVOLUTION", "CASE_FILE", "RECEIVER_ASSIGNMENT"] as const)
    .map((name) => [name, csiFlag(name as never)]));
  await log("started", { database, apply: applying, job: job ?? null, policy_version: SOLE_MATCH_POLICY_VERSION, flags });
  const jobScope = job ? await numbersForJob(job) : null;
  if (jobScope && !jobScope.numberIds.length) {
    console.log(JSON.stringify({ phase: "job_has_no_external_number", leads: jobScope.leads }, null, 2));
  }
  const limit = arg("limit") ? Number(arg("limit")) : null;
  // Apply: AC6-PLAN re-plans are counted, never nominated (zero model calls).
  if (applying) setProgressPlanSuppressor((recordId) => { replanSink?.push(recordId); });
  let result: Awaited<ReturnType<typeof scan>>;
  try {
    result = await scan(applying, jobScope?.numberIds ?? null, flag("resume"), limit, log, runId);
  } finally {
    if (applying) setProgressPlanSuppressor(null);
  }
  const { counts, outcomes, done, checkpoint } = result;
  const jobsAfter = await paidJobCounts();
  const holds = checkpoint.holds ?? [];
  const heldNow = holds.length
    ? await getSalesIntelligenceJobModel().countDocuments({ _id: { $in: holds.map((h) => new mongoose.Types.ObjectId(h.job_id)) }, status: "paused", reason: OPERATOR_HOLD_REASON })
    : 0;
  const unheld = holds.length - heldNow;
  let publish: unknown = null;
  if (applying && !job && flag("publish")) publish = await publishAttentionSnapshot({ deadlineMs: 300_000 });
  const output = {
    database,
    policy_version: SOLE_MATCH_POLICY_VERSION,
    run_id: runId,
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    apply: applying,
    job: job ?? null,
    job_leads: jobScope?.leads ?? null,
    done,
    counts,
    jobs_before: checkpoint.jobs_before ?? null,
    jobs_after: jobsAfter,
    holds: holds.length,
    paid_created_unheld: unheld,
    publish,
    outcomes,
  };
  await mkdir(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/sole-match-attachment-backfill-${started.toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(file, JSON.stringify(output, null, 2));
  const reportDir = arg("report-dir") ?? (existsSync(WORKSPACE_EVIDENCE) ? WORKSPACE_EVIDENCE : OUT_DIR);
  await mkdir(reportDir, { recursive: true });
  const report = join(reportDir, `S10-2-${env}${applying ? "" : "-dry-run"}${job ? `-job-${job}` : ""}.md`);
  await writeFile(report, renderReport({ env, database, applying, runId, started, job: job ?? null, counts, done, holds, jobsBefore: checkpoint.jobs_before ?? null, jobsAfter, unheld, flags,
    files: { output: file, jsonl, ...(applying ? { checkpoint: CHECKPOINT } : {}) }, argv: process.argv.slice(2).join(" ") }));
  await log("finished", { file, report, counts, holds: holds.length, paid_created_unheld: unheld, jobs_before: checkpoint.jobs_before, jobs_after: jobsAfter, done });
  if (unheld !== 0) throw new Error(`${unheld} paid job(s) created by the run are not on operator_hold`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
