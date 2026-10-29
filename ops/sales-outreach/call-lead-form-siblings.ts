/**
 * Owner 2026-10-28 backfill for the Granot Form sibling update (`src/services/granotLifecycle/callLeadFormSibling.ts`):
 * bring every existing Form/Call pair up to date — the Call Lead gets the Form Lead's job, priority and
 * receiver and the pair marker, and its Calls row updates in place (only when it already has one).
 *
 *   pnpm granot:call-lead-form-siblings --target=<database>                    # dry run (default, read-only)
 *   pnpm granot:call-lead-form-siblings --target=<database> --apply [--limit=N]
 *
 * - The target is named and must equal the database this process resolves.
 * - Candidates: non-duplicate, non-bad Form Leads holding a job whose phone (current/ingested/Granot) and
 *   Lead Source Company match a non-duplicate Call Lead that is not a booking anchor, or whose job a Call
 *   Lead already holds. Each candidate is planned with the same pure rule the processor uses.
 * - The dry run prints counts by outcome, basis and written path, how many Calls rows would update, and
 *   at most 50 planned pairs (ids only).
 * - `--apply` passes the production-writer guard and runs `mirrorFormLeadToCallSibling` per Form Lead
 *   (its own audited, idempotent transaction; re-planned inside it). Re-running writes nothing new.
 * - Run it only after the deploy that contains the update (the schema needs `granot_form_sibling`).
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getFormLeadModel } from "../../src/models/FormLead";
import { jobNumberDigitCore } from "../../src/services/bookings/bookingIdentity";
import {
  formSiblingPhones,
  hasSyncedCallsRow,
  loadFormSiblingCandidates,
  mirrorFormLeadToCallSibling,
  planFormSiblingUpdate,
  SIBLING_FORM_PROJECTION,
  type SiblingFormLead,
} from "../../src/services/granotLifecycle/callLeadFormSibling";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

function parseArgs(argv: readonly string[]) {
  let target: string | null = null;
  let apply = false;
  let limit = Number.POSITIVE_INFINITY;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target || !/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!(limit > 0)) throw new Error("--limit must be a positive number");
  return { target, apply, limit };
}

const tally = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };

/** Form Lead ids that may have a Call sibling: an in-memory join on (Source Company, phone) and on the job's digit core. */
async function candidateFormIds(): Promise<string[]> {
  const calls = await getCallLeadModel().find({ duplicate: { $ne: true }, created_on_unmatched: { $ne: true } },
    { lead_source_company: 1, normalized_phone_number: 1, "ingested_contact_snapshot.normalized_phone_number": 1, normalized_job_no: 1 }).lean();
  const byPhone = new Set<string>();
  const byJob = new Set<string>();
  for (const call of calls) {
    const company = String(call.lead_source_company ?? "");
    for (const phone of [call.normalized_phone_number, call.ingested_contact_snapshot?.normalized_phone_number]) if (phone) byPhone.add(`${company}:${phone}`);
    const core = jobNumberDigitCore(call.normalized_job_no);
    if (core) byJob.add(core);
  }
  const forms = await getFormLeadModel().find({ duplicate: { $ne: true }, bad_lead: null, normalized_job_no: { $nin: [null, ""] } },
    SIBLING_FORM_PROJECTION).lean<SiblingFormLead[]>();
  return forms.filter((form) => {
    const company = String(form.lead_source_company ?? "");
    const core = jobNumberDigitCore(form.normalized_job_no);
    return (core && byJob.has(core)) || formSiblingPhones(form).some((phone) => byPhone.has(`${company}:${phone}`));
  }).map((form) => String(form._id));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  const ids = await candidateFormIds();
  const outcomes: Record<string, number> = {};
  const bases: Record<string, number> = {};
  const paths: Record<string, number> = {};
  const pairs: Array<{ form_lead_id: string; call_lead_id: string; basis: string; paths: string[] }> = [];
  let callsRowUpdates = 0;
  const planned: string[] = [];
  for (const id of ids) {
    const { form, jobMatches, phoneMatches } = await loadFormSiblingCandidates(id);
    const plan = form ? planFormSiblingUpdate(form, jobMatches, phoneMatches, new Date()) : { kind: "skip" as const, reason: "form_ineligible" as const };
    if (plan.kind === "skip") { tally(outcomes, plan.reason); continue; }
    tally(outcomes, "update");
    tally(bases, plan.basis);
    const written = Object.keys(plan.set).sort();
    for (const path of written) tally(paths, path);
    const call = [...jobMatches, ...phoneMatches].find((lead) => String(lead._id) === plan.call_id);
    if (call && hasSyncedCallsRow(call)
      && (plan.set.job_no !== undefined || plan.set.receiver_agent_name_snapshot !== undefined)) callsRowUpdates += 1;
    if (pairs.length < 50) pairs.push({ form_lead_id: id, call_lead_id: plan.call_id, basis: plan.basis, paths: written });
    planned.push(id);
  }
  const summary = { database, candidates: ids.length, outcomes, by_basis: bases, by_path: paths, calls_row_updates: callsRowUpdates };
  if (!args.apply) {
    console.log(JSON.stringify({ mode: "dry_run", ...summary, pairs }, null, 2));
    return;
  }
  await assertProductionWriterMatchesDeployment();
  const applied: Record<string, number> = {};
  let sheets = 0;
  for (const id of planned.slice(0, args.limit)) {
    try {
      const result = await mirrorFormLeadToCallSibling(id, { run_id: `call-lead-form-siblings-${new Date().toISOString().slice(0, 10)}` });
      tally(applied, result.outcome);
      if (result.sheet) sheets += 1;
    } catch (error) {
      tally(applied, `error:${error instanceof Error ? error.name : "unknown"}`);
    }
  }
  console.log(JSON.stringify({ mode: "apply", ...summary, applied, calls_row_jobs_enqueued: sheets }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "call-lead-form-siblings failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
