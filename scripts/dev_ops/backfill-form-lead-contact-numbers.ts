/**
 * Backfill Contact Numbers for historical Form Leads with the live rule
 * (`ensureFormLeadContactNumber`, the step the `attachment-lead:` job runs
 * behind FORM_LEAD_NUMBERS). Plan: FORM-LEAD-CONTACT-NUMBER-PLAN.md.
 *
 * Every non-duplicate, non-Bad Form Lead whose live phone normalizes and whose
 * E.164 is not a Contact Number yet. No move-date gate. Leads sharing a phone
 * make one number. Per new number, one transaction: create it (from the
 * earliest Lead), then run every Lead on that phone through
 * `persistLeadAttachments` (`attachLeadsOnNumber`, the `attachment-scan:` job
 * work), so sole-match, ambiguity and the Outreach reaction are today's code.
 *
 * Dry run (default) executes that same transaction and ROLLS IT BACK, so the
 * counts are exact: numbers created, edge states, Outreach records that gain a
 * primary number, enter identity review, or would be created.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/backfill-form-lead-contact-numbers.ts [--limit=N]
 *   node --env-file=.env --import tsx scripts/dev_ops/backfill-form-lead-contact-numbers.ts --apply --allow-production [--resume]
 *
 * Reports carry ids, job numbers and outcomes, never phone numbers.
 *
 * G7: a Number this creates carries `created_via: "form_lead"` (set by `ensureFormLeadContactNumber`).
 * Numbers created before G7 are stamped by `stamp-form-created-numbers.ts` (S10 step 1, after this).
 * Resume (S10 step 1): `--resume` continues after the checkpoint's `after` creator Lead id, so a
 * group that errored at or before it is skipped. A plain re-run (no `--resume`) re-inventories and
 * skips every phone that already has a Number, so it is idempotent and also retries errors and picks
 * up Form Leads that arrived since. Run from the repository root (the paths are relative).
 * `--apply` against production runs the drift guard (`lib/production-writer-guard.ts`); the job
 * table is counted before and after and reported.
 *
 * V-T3 M6: against production (`vantagemovers`) the script runs ONLY as `--apply --allow-production`; a dry run
 * (it executes and aborts real transactions) or a bare `--apply` is refused before connecting.
 * V-T3 M5a (zero paid work): every paid-stage job (`number_refresh` from an official closure, `move_assessment`,
 * `analysis`, `application`, `transcription`) created inside a group's transaction is put on `operator_hold`
 * (status `paused`) in that same transaction, recorded in the output file and the checkpoint, and counted; AC6-PLAN
 * re-plans are suppressed (`setProgressPlanSuppressor`) and counted. The run exits non-zero if a recorded hold is not
 * on hold at the end. `--apply --release-holds=<output json>` (operator decision, after S10 step 9) hands them back.
 * The Attention publish at the end is opt-in (`--publish`): the minute cron publishes with the deployed flags.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { csiFlag } from "../../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../src/models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { configuredRingCentralAccountId } from "../../src/services/numberActivity/accountIdentity";
import { loadDirectoryLookup, EMPTY_DIRECTORY_LOOKUP, type DirectoryLookup } from "../../src/services/numberActivity/directory";
import { loadLead } from "../../src/services/salesIntelligence/attachment/sources";
import { ensureFormLeadContactNumber, formLeadNumberE164 } from "../../src/services/salesIntelligence/attachment/formLeadNumber";
import { attachLeadsOnNumber } from "../../src/services/salesIntelligence/attachment/refresh";
import { publishAttentionSnapshot } from "../../src/services/salesIntelligence/outreach/attention";
import { setProgressPlanSuppressor } from "../../src/services/salesIntelligence/outreach/types";
import { getSalesIntelligenceJobModel } from "../../src/models/salesIntelligence/infrastructure";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";
import { formLeadBackfillProductionRefusal, releaseFormLeadHolds, unheldCount, withHeldPaidJobs, type FormLeadHold } from "./lib/form-lead-numbers-backfill";
import { paidJobCounts } from "./lib/priority5-reconcile";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const CONCURRENCY = Number(arg("concurrency") ?? 4);
const OUT_DIR = "scripts/dev_ops/output";
const CHECKPOINT = `${OUT_DIR}/form-lead-contact-numbers.checkpoint.json`;

class Rollback extends Error { constructor(readonly outcome: Outcome) { super("dry-run rollback"); } }
type Outcome = {
  creator_lead_id: string; creator_job_no: string | null; move: MoveBucket; number_id: string | null; action: string;
  edges: Record<string, number>; attached_lead: { model: string; id: string; job_no: string | null } | null;
  records: { lead_id: string; model: string; created: boolean; before_state: string | null; state: string | null;
    gained_primary: boolean; mirror: string | null }[];
  /** M5a: paid-stage jobs this group's transaction created, on `operator_hold` (a dry run's are rolled back with it). */
  holds?: FormLeadHold[]; nonpaid_jobs?: Record<string, number>;
};
type MoveBucket = "future" | "past" | "none";
type LeadRow = { _id: mongoose.Types.ObjectId; job_no?: string | null; timestamp: Date; duplicate?: boolean; bad_lead?: string | null;
  normalized_phone_number?: string | null; move_date?: Date | null; ingested_move_snapshot?: { move_date?: Date | null } | null };

const bump = (c: Record<string, number>, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n; };
const todayNy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
/** Reporting only (there is no gate): original or current move date is today or later in New York. */
function moveBucket(lead: LeadRow): MoveBucket {
  const dates = [day(lead.move_date), day(lead.ingested_move_snapshot?.move_date)].filter((d): d is string => d !== null);
  if (!dates.length) return "none";
  return dates.some((d) => d >= todayNy) ? "future" : "past";
}

async function processGroup(creatorId: string, apply: boolean, directory: DirectoryLookup): Promise<Outcome> {
  const requestId = new mongoose.Types.ObjectId().toString();
  try {
    return await withTransaction(async (session) => {
      const held = await withHeldPaidJobs(session, creatorId, () => groupWork(session));
      const outcome: Outcome = { ...held.value, holds: held.holds, nonpaid_jobs: held.nonpaid };
      if (!apply) throw new Rollback(outcome);
      return outcome;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.outcome;
    return { creator_lead_id: creatorId, creator_job_no: null, move: "none", number_id: null, action: `error_${(error as Error).name}`,
      edges: {}, attached_lead: null, records: [], ...({ error: (error as Error).message.slice(0, 300) } as object) };
  }

  async function groupWork(session: mongoose.ClientSession): Promise<Outcome> {
      const lead = await loadLead({ model: "FormLead", id: creatorId }, session);
      const base = { creator_lead_id: creatorId, creator_job_no: lead?.job_no ?? null, move: moveBucket(lead as unknown as LeadRow),
        number_id: null, edges: {}, attached_lead: null, records: [] } as Omit<Outcome, "action">;
      if (!lead) return { ...base, action: "lead_missing" };
      const result = await ensureFormLeadContactNumber(lead, session, requestId, new Date(), { force: true, directory });
      if (result.action !== "created") return { ...base, action: result.action === "skipped" ? `skipped_${result.reason}` : "reused_on_recheck" };
      const Records = getOutreachRecordModel();
      const leadRefs = async () => (await getNumberLeadAttachmentModel().find({ contact_number_id: result.number_id }, { lead_ref: 1 }).session(session).lean())
        .map((e) => e.lead_ref);
      await attachLeadsOnNumber(result.number_id, session, requestId);
      const refs = await leadRefs();
      const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: result.number_id }).session(session).lean();
      const counts: Record<string, number> = {};
      for (const e of edges) bump(counts, e.state);
      const attached = edges.find((e) => e.state === "attached");
      const records: Outcome["records"] = [];
      for (const ref of refs) {
        const row = await Records.findOne({ "subject.kind": "lead", "subject.model": ref.model, "subject.id": ref.id }).session(session).lean();
        // No session: the committed, pre-backfill record (this transaction has not committed).
        const before = await Records.findOne({ "subject.kind": "lead", "subject.model": ref.model, "subject.id": ref.id },
          { state: 1, primary_contact_number_id: 1 }).lean();
        records.push({ lead_id: String(ref.id), model: ref.model, created: Boolean(row) && !before, before_state: before?.state ?? null,
          state: row?.state ?? null, gained_primary: Boolean(row?.primary_contact_number_id) && !before?.primary_contact_number_id,
          mirror: row?.lead_attachment?.state ?? null });
      }
      return { ...base, number_id: result.number_id, action: "created", edges: counts,
        attached_lead: attached ? { model: attached.lead_ref.model, id: String(attached.lead_ref.id),
          job_no: attached.lead_snapshot?.job_no ?? null } : null, records };
  }
}

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  const apply = flag("apply");
  const database = getMongoDatabaseName();
  // V-T3 M6: production only as `--apply --allow-production`, decided before connecting (the dry run sends writes).
  const refusal = formLeadBackfillProductionRefusal(database, process.argv);
  if (refusal) throw new Error(refusal);
  // The dry run executes the same transaction and rolls it back, so it needs the same flags.
  process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "true";
  process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "true";
  process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = "true";
  await connectMongo();
  // CC-00 §5.2 / reconciliation §5: only the deployed build writes production.
  if (apply) await assertProductionWriterMatchesDeployment();
  const releaseFrom = arg("release-holds");
  if (releaseFrom !== undefined || flag("release-holds")) {
    if (!apply || !releaseFrom) throw new Error("--release-holds=<output json> needs --apply (it hands paid work back to production consumers)");
    const holds = (JSON.parse(await readFile(releaseFrom, "utf8")) as { holds?: FormLeadHold[] }).holds ?? [];
    console.log(JSON.stringify({ phase: "released", file: releaseFrom, holds: holds.length, released: await releaseFormLeadHolds(holds) }));
    return;
  }
  const account = configuredRingCentralAccountId();
  const directory = account ? await loadDirectoryLookup(account) : EMPTY_DIRECTORY_LOOKUP;
  const started = new Date();
  const jobsBefore = await getSalesIntelligenceJobModel().countDocuments({});
  const paidBefore = await paidJobCounts();
  console.log(JSON.stringify({ phase: "started", database, apply, today_ny: todayNy, directory_loaded: !directory.isEmpty,
    flags: { AUTO_ATTACH: csiFlag("AUTO_ATTACH"), OUTREACH_ENSURE: csiFlag("OUTREACH_ENSURE"), LEAD_PROGRESS: csiFlag("LEAD_PROGRESS") } }));

  // 1. Read-only inventory: group eligible Form Leads by E.164, earliest Lead first.
  const counts: Record<string, number> = {};
  const groups = new Map<string, LeadRow[]>();
  const cursor = getFormLeadModel().find({}, { job_no: 1, timestamp: 1, duplicate: 1, bad_lead: 1, normalized_phone_number: 1,
    move_date: 1, "ingested_move_snapshot.move_date": 1 }).sort({ _id: 1 }).lean().cursor();
  for await (const lead of cursor as AsyncIterable<LeadRow>) {
    bump(counts, "form_leads_total");
    const plan = formLeadNumberE164(lead);
    if ("skip" in plan) { bump(counts, `lead_skip_${plan.skip}`); continue; }
    groups.set(plan.e164, [...(groups.get(plan.e164) ?? []), lead]);
  }
  const phones = [...groups.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < phones.length; i += 500) {
    for (const row of await getContactNumberModel().find({ e164: { $in: phones.slice(i, i + 500) } }, { e164: 1 }).lean()) existing.add(row.e164);
  }
  const todo: { creator: LeadRow; leads: number }[] = [];
  for (const [e164, leads] of groups) {
    const creator = leads.reduce((a, b) => (+a.timestamp <= +b.timestamp ? a : b));
    if (existing.has(e164)) { bump(counts, "phones_number_exists"); bump(counts, "leads_number_exists", leads.length); continue; }
    if (directory.companyNumberByE164(e164)) { bump(counts, "phones_company_number"); continue; }
    bump(counts, "phones_to_create"); bump(counts, "leads_on_new_phones", leads.length);
    if (leads.length > 1) bump(counts, "phones_shared_by_several_form_leads");
    bump(counts, `phones_to_create_move_${moveBucket(creator)}`);
    todo.push({ creator, leads: leads.length });
  }
  todo.sort((a, b) => String(a.creator._id).localeCompare(String(b.creator._id)));
  console.log(JSON.stringify({ phase: "inventory", counts }));

  // 2. One transaction per new number (rolled back unless --apply).
  let after: string | null = null;
  // M5a: holds recorded by an interrupted run stay in the checkpoint across `--resume`.
  let priorHolds: FormLeadHold[] = [];
  if (apply && flag("resume")) {
    try { const cp = JSON.parse(await readFile(CHECKPOINT, "utf8")); if (cp.database === database) { after = cp.after; priorHolds = cp.holds ?? []; } } catch { /* fresh */ }
  }
  const replans = new Set<string>();
  const queue = todo.filter((t) => !after || String(t.creator._id) > after).slice(0, LIMIT);
  const outcomes: Outcome[] = [];
  const holdsSoFar = () => [...priorHolds, ...(apply ? outcomes.flatMap((o) => o.holds ?? []) : [])];
  let next = 0, done = 0;
  await mkdir(OUT_DIR, { recursive: true });
  const worker = async () => {
    for (let i = next++; i < queue.length; i = next++) {
      const outcome = await processGroup(String(queue[i]!.creator._id), apply, directory);
      outcomes.push(outcome);
      bump(counts, `result_${outcome.action}`);
      if (outcome.action === "created") {
        bump(counts, `result_created_move_${outcome.move}`);
        for (const [state, n] of Object.entries(outcome.edges)) bump(counts, `edges_${state}`, n);
        if (outcome.attached_lead) bump(counts, `numbers_attached_move_${outcome.move}`);
        for (const r of outcome.records) {
          if (r.created) bump(counts, "outreach_records_created");
          if (r.gained_primary) bump(counts, "outreach_gained_primary_number");
          if (r.state === "identity_review" && r.before_state !== "identity_review") bump(counts, "outreach_entered_identity_review");
          if (r.state === "identity_review" && r.before_state !== "identity_review" && r.before_state !== "closed") bump(counts, "outreach_open_entered_identity_review");
          if (r.mirror) bump(counts, `outreach_mirror_${r.mirror}`);
        }
      }
      if (++done % 100 === 0) {
        console.log(JSON.stringify({ phase: "progress", done, of: queue.length, created: counts.result_created ?? 0, errors: Object.keys(counts).filter((k) => k.startsWith("result_error")).length }));
        if (apply) await writeFile(CHECKPOINT, JSON.stringify({ database, after: String(queue[Math.max(0, i - CONCURRENCY * 2)]!.creator._id), holds: holdsSoFar() }));
      }
    }
  };
  // M5a: AC6-PLAN re-plans are counted, never nominated (the dry run counts what the apply would suppress).
  setProgressPlanSuppressor((recordId) => { replans.add(recordId); });
  try {
    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  } finally { setProgressPlanSuppressor(null); }
  const holds = holdsSoFar();
  for (const o of outcomes) {
    for (const h of o.holds ?? []) bump(counts, `${apply ? "held" : "would_hold"}_${h.stage}`);
    for (const [stage, n] of Object.entries(o.nonpaid_jobs ?? {})) bump(counts, `${apply ? "" : "would_create_"}nonpaid_${stage}`, n);
  }
  counts.progress_replans_suppressed = replans.size;
  if (apply && queue.length) await writeFile(CHECKPOINT, JSON.stringify({ database, after: String(queue.at(-1)!.creator._id), done: true, holds }));
  const unheld = apply ? await unheldCount(holds) : 0;
  // Opt-in: a publish from this process would use this process's flags (V-T3 M4, second path).
  const publish = apply && flag("publish") && outcomes.some((o) => o.action === "created") ? await publishAttentionSnapshot({ deadlineMs: 300_000 }) : null;
  // On production the live crons also create jobs while this runs; the delta is reported, not asserted.
  const jobs = { before: jobsBefore, after: await getSalesIntelligenceJobModel().countDocuments({}),
    created_during_run: await getSalesIntelligenceJobModel().countDocuments({ _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(+started / 1000)) } }) };
  const file = `${OUT_DIR}/form-lead-contact-numbers-${apply ? "apply" : "dry"}-${started.toISOString().replace(/[:.]/g, "-")}.json`;
  const paid = { before: paidBefore, after: await paidJobCounts() };
  await writeFile(file, JSON.stringify({ database, apply, today_ny: todayNy, started_at: started.toISOString(), finished_at: new Date().toISOString(),
    counts, jobs, paid_jobs: paid, holds, paid_created_unheld: unheld, progress_replans_suppressed: [...replans], publish, outcomes }, null, 2));
  console.log(JSON.stringify({ phase: "finished", file, counts, jobs, paid_jobs: paid, holds: holds.length, paid_created_unheld: unheld, publish }, null, 2));
  if (unheld !== 0) throw new Error(`${unheld} paid job(s) created by the run are not on operator_hold`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
