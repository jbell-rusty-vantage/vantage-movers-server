/**
 * Outreach lifecycle repair C3 (RELEASE step OPS-1): settle the pre-CC-04 Call Log rows so their
 * contact events move from `awaiting_confirmation` to `confirmed` (`ops/lib/sales-outreach-settle-pre-cc04.ts`).
 *
 *   pnpm outreach:settle-pre-cc04 --target=<database>                      # dry run (default, read-only)
 *   pnpm outreach:settle-pre-cc04 --target=<database> --out=ids.json       # dry run + candidate ids
 *   pnpm outreach:settle-pre-cc04 --target=<database> --apply --out=ids.json
 *
 * - The target is named and must equal the database this process resolves; unnamed runs are refused.
 * - The dry run counts the candidates by New York day and direction, their contact events by
 *   `goal_credit`, the anomalies (null terminal rows with Call Log ids at or after CC-04; expected 0,
 *   never written) and the `Internal` null rows left alone.
 * - `--apply` passes the production-writer guard, settles in audited batches of 500 and re-runs the
 *   report; `--out` then holds the settled ids (the rollback set: `$set {call_log_state: null}`).
 *   A second apply matches 0. The minute contact sweep re-derives the rows; nothing else is enqueued.
 * - Prints one JSON summary.
 */
import { writeFileSync } from "node:fs";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { applySettle, parseSettleArgs, reportSettle } from "../lib/sales-outreach-settle-pre-cc04";

async function main() {
  const args = parseSettleArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  const before = await reportSettle();
  if (!args.apply) {
    if (args.out) writeFileSync(args.out, JSON.stringify({ mode: "dry_run", database, ids: before.ids }, null, 2));
    console.log(JSON.stringify({ mode: "dry_run", database, ...before.summary }, null, 2));
    return;
  }

  await assertProductionWriterMatchesDeployment();
  const run_id = `settle-pre-cc04-${new Date().toISOString()}`;
  const applied = await applySettle({ actor: csiOperatorActor(run_id), run_id });
  if (args.out) writeFileSync(args.out, JSON.stringify({ mode: "apply", database, run_id, ids: applied.ids }, null, 2));
  const after = await reportSettle();
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        database,
        before: before.summary,
        applied: { run_id: applied.run_id, settled: applied.settled, batches: applied.batches, by_day: applied.by_day },
        after: { candidates: after.summary.candidates, anomalies: after.summary.anomalies, internal_left: after.summary.internal_left },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "settle-pre-cc04 failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
