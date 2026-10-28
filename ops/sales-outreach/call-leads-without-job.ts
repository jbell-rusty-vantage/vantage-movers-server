/**
 * Owner 2026-10-28 backfill: a Call Lead without a Job Number has no cadence (`subjects/eligibility.ts`,
 * `job_number_pending`). Open subjects enrolled before that rule keep owing calls until their Lead changes,
 * so this nominates one `outreach_lead_change` job per such subject; the job re-syncs it to `review`
 * (owes nothing) and it returns to `active` by itself when Granot writes a job.
 *
 *   pnpm outreach:call-leads-without-job --target=<database>            # dry run (default, read-only)
 *   pnpm outreach:call-leads-without-job --target=<database> --apply
 *
 * - The target is named and must equal the database this process resolves.
 * - Selection: open subjects (`active`/`review`) of Call Leads whose Lead has neither `normalized_job_no`
 *   nor `job_no` now, and whose subject does not already carry `job_number_pending`.
 * - `--apply` passes the production-writer guard and enqueues, per subject, the job
 *   `sod:lead-change:CallLead:<id>:job-number-pending:2026-10-28` (a replay dedupes). The minute drain
 *   processes them; re-run the dry run afterwards (expected `selected: 0`).
 * - Run it only after the deploy that contains the rule: the old code would re-sync the subject unchanged.
 * - Prints one JSON summary.
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo, withTransaction } from "../../src/db";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getSalesOutreachSubjectModel } from "../../src/models/salesOutreach";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

const RUN_KEY = "job-number-pending:2026-10-28";

function parseArgs(argv: readonly string[]) {
  let target: string | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target || !/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  return { target, apply };
}

async function selectSubjects() {
  const subjects = await getSalesOutreachSubjectModel()
    .find({ lead_model: "CallLead", status: { $in: ["active", "review"] }, review_reasons: { $ne: "job_number_pending" } }, { lead_id: 1, status: 1 })
    .lean();
  const leadIds = subjects.map((s) => s.lead_id);
  const withJob = await getCallLeadModel()
    .find({ _id: { $in: leadIds }, $or: [{ normalized_job_no: { $nin: [null, ""] } }, { job_no: { $nin: [null, ""] } }] }, { _id: 1 })
    .lean();
  const hasJob = new Set(withJob.map((lead) => String(lead._id)));
  return subjects.filter((s) => !hasJob.has(String(s.lead_id))).map((s) => ({ subject_id: String(s._id), lead_id: String(s.lead_id), status: s.status }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  const selected = await selectSubjects();
  const byStatus = selected.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
  if (!args.apply) {
    console.log(JSON.stringify({ mode: "dry_run", database, selected: selected.length, by_status: byStatus }, null, 2));
    return;
  }
  await assertProductionWriterMatchesDeployment();
  const outcomes: Record<string, number> = {};
  for (const { lead_id } of selected) {
    const row = await withTransaction((session) =>
      enqueueCsiJob(
        {
          stage: "outreach_lead_change",
          subject_key: `outreach-lead:CallLead:${lead_id}`,
          dedupe_key: `sod:lead-change:CallLead:${lead_id}:${RUN_KEY}`,
          input_revision: 1,
          input_refs: [lead_id],
        },
        session,
      ),
    );
    // A fresh row is `pending`; a replayed run sees the job's current status.
    outcomes[row.status] = (outcomes[row.status] ?? 0) + 1;
  }
  console.log(JSON.stringify({ mode: "apply", database, selected: selected.length, by_status: byStatus, outcomes }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "call-leads-without-job failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
