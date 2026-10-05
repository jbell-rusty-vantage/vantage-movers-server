/**
 * Sales Outreach Desk enrollment (FAST-TRACK step 6, MANUAL-START, IMPLEMENTATION-PLAN SRV-3).
 *
 *   pnpm outreach:enrollment --target=<database>                                   # report (default, read-only)
 *   pnpm outreach:enrollment --target=<database> --out=report.json                 # report + full selection to a file
 *   pnpm outreach:enrollment --target=<database> --leads=pilot.json --kind=pilot   # report an explicit selection
 *   pnpm outreach:enrollment apply --target=<database> --run-key=backfill-2026-10-05
 *   pnpm outreach:enrollment verify --target=<database> --run-key=backfill-2026-10-05
 *
 * - The target is named and must equal the database this process resolves; unnamed runs are refused.
 * - report writes nothing. apply re-runs the report, freezes its selection under the run key and
 *   enrolls in bounded batches (the server-side service: single-writer lease, checkpoints, fixed
 *   activation boundary). Re-running apply with the same key resumes the stored run (its stored
 *   selection and manifest), so a crash or a timeout never re-prices the boundary or grows the scope.
 * - apply refuses while `migration.paused` is true (set it false through the configuration PATCH).
 * - apply/verify pass the production-writer guard.
 */
import { readFileSync, writeFileSync } from "node:fs";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { applyEnrollment, reportEnrollment, verifyEnrollment } from "../../src/services/salesOutreach/enrollment/service";
import { mongoEnrollmentStore } from "../../src/services/salesOutreach/enrollment/store";
import { salesOutreachLeadRefSchema } from "../../src/validation/v1/salesOutreachEnrollment";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { parseEnrollmentArgs } from "../lib/sales-outreach-enrollment";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

const MAX_APPLY_CALLS = 500;

async function main() {
  const args = parseEnrollmentArgs(process.argv.slice(2));
  assertTargetMatchesDatabase(args.target, getMongoDatabaseName());
  await connectMongo();
  const actor = csiOperatorActor(`sod-enrollment-${args.run_key ?? "report"}`);

  if (args.mode === "verify") {
    await assertProductionWriterMatchesDeployment();
    console.log(JSON.stringify(await verifyEnrollment({ actor, run_key: args.run_key! }), null, 2));
    return;
  }

  const existing = args.mode === "apply" ? await mongoEnrollmentStore.findRun(args.run_key!) : null;
  let body: { kind: "expansion" | "pilot"; cohort_id: string; lead_refs: Array<{ model: "FormLead" | "CallLead"; id: string }>; manifest_hash: string };
  if (existing) {
    if (existing.mode !== "apply" || existing.kind === "intake") throw new Error(`Run ${existing.run_key} is not an enrollment apply run`);
    body = { kind: existing.kind, cohort_id: existing.cohort_id, lead_refs: existing.selected_leads, manifest_hash: existing.manifest_hash };
    console.log(JSON.stringify({ resuming: existing.run_key, status: existing.status, next_index: existing.next_index, selected: existing.selected_leads.length }));
  } else {
    const selection =
      args.selection.mode === "selected"
        ? { mode: "selected" as const, lead_refs: salesOutreachLeadRefSchema.array().parse(JSON.parse(readFileSync(args.selection.file, "utf8"))) }
        : { mode: "backfill_scope" as const };
    const report = await reportEnrollment({ selection, kind: args.kind, ...(args.cohort_id ? { cohort_id: args.cohort_id } : {}) });
    if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2));
    const { lead_refs, review, ...summary } = report;
    console.log(JSON.stringify({ ...summary, selected: lead_refs.length, review_sample: review.slice(0, 20) }, null, 2));
    if (args.mode === "report") return;
    if (!lead_refs.length) {
      console.log("Nothing in scope; no run created.");
      return;
    }
    body = { kind: report.kind, cohort_id: report.cohort_id, lead_refs, manifest_hash: report.manifest_hash };
  }

  await assertProductionWriterMatchesDeployment();
  for (let call = 0; call < MAX_APPLY_CALLS; call++) {
    const result = await applyEnrollment({ actor, run_key: args.run_key!, ...body });
    console.log(JSON.stringify({ status: result.status, next_index: result.next_index, selected: result.selected, counts: result.counts, pause_reason: result.pause_reason }));
    if (result.status !== "running") {
      if (result.status === "completed") console.log(`Completed. Verify with: pnpm outreach:enrollment verify --target=${args.target} --run-key=${args.run_key}`);
      if (result.status === "lease_held") process.exitCode = 2;
      return;
    }
  }
  throw new Error("apply did not finish within the call budget; re-run the same command to resume");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Sales Outreach enrollment failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
