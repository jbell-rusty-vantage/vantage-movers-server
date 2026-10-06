/**
 * Outreach lifecycle repair B1 (RELEASE operator step, after the deploy that contains B1): move the
 * first periods the pre-B1 planner opened at the boundary as `intake` starts to their late `activation`
 * start (`ops/lib/sales-outreach-repair-late-first-periods.ts`).
 *
 *   pnpm outreach:repair-late-first-periods --target=<database>            # dry run (default, read-only)
 *   pnpm outreach:repair-late-first-periods --target=<database> --apply
 *
 * - The target is named and must equal the database this process resolves; unnamed runs are refused.
 * - The dry run prints every plan (ids and instants only) and the skipped rows by reason.
 * - `--apply` passes the production-writer guard, repairs each row in its own audited transaction with
 *   an `outreach_evaluate` nomination, then re-runs the report (expected `repairable: 0`).
 * - Prints one JSON summary.
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { applyRepair, parseRepairArgs, reportRepair } from "../lib/sales-outreach-repair-late-first-periods";

async function main() {
  const args = parseRepairArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  const before = await reportRepair();
  if (!args.apply) {
    console.log(JSON.stringify({ mode: "dry_run", database, ...before.summary }, null, 2));
    return;
  }

  await assertProductionWriterMatchesDeployment();
  const run_id = `repair-late-first-periods-${new Date().toISOString()}`;
  const applied = await applyRepair({ actor: csiOperatorActor(run_id), run_id });
  const after = await reportRepair();
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        database,
        before: before.summary,
        applied: { run_id: applied.run_id, repaired: applied.repaired.length, period_ids: applied.repaired, conflicts: applied.conflicts, skipped: applied.skipped },
        after: { repairable: after.summary.repairable, skipped: after.summary.skipped },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "repair-late-first-periods failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
