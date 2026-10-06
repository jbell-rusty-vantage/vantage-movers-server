/**
 * Outreach lifecycle repair C1b (+ the C5 zero-row backfill): recount rep-day rows over a range of New
 * York business days so every row stores both scopes' counts (`ops/lib/sales-outreach-recount-rep-days.ts`).
 *
 *   pnpm outreach:recount-rep-days --target=<database>                                     # dry run (default, read-only)
 *   pnpm outreach:recount-rep-days --target=<database> --from=2026-09-20                   # dry run of a range
 *   pnpm outreach:recount-rep-days --target=<database> --from=2026-09-20 --apply
 *   pnpm outreach:recount-rep-days --target=<database> --from=2026-10-05 --materialize-roster --apply
 *
 * - The target is named and must equal the database this process resolves; unnamed runs are refused.
 * - `--from` defaults to the contact derivation's coverage start (New York day), `--to` to today.
 * - The dry run recounts every key in a transaction that writes nothing and reports what an apply
 *   would write (`outcomes.written`), the scope changes and the per-day totals before and after.
 * - `--apply` passes the production-writer guard, recounts with the minute sweep's function and then
 *   repeats the dry run: `verify.outcomes.written` is 0 when the run converged.
 * - Refused (exit 3, nothing written) unless the configuration is active with the desk or goal
 *   metrics enabled — the same admission as the sweep.
 * - Prints one JSON summary.
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo, withTransaction } from "../../src/db";
import { salesOutreachConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { wantsContactEvidence } from "../../src/services/salesOutreach/contacts/jobs";
import { mongoRepDayStore } from "../../src/services/salesOutreach/contacts/repDayService";
import { newYorkBusinessDay } from "../../src/services/salesOutreach/reads/businessDay";
import { mongoSalesOutreachReadStore } from "../../src/services/salesOutreach/reads/store";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import {
  dryRunRepDayStore,
  parseRecountArgs,
  planRecountKeys,
  readRowsInRange,
  resolveRecountRange,
  runRecount,
  summarizeRecount,
} from "../lib/sales-outreach-recount-rep-days";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

const noPublish = async () => undefined;

async function main() {
  const args = parseRecountArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  const now = new Date();
  const today = newYorkBusinessDay(now);
  const loader = salesOutreachConfigurationLoader;
  const inspected = await loader.inspect();
  const mode = args.apply ? "apply" : "dry_run";
  if (inspected.state !== "active" || !wantsContactEvidence(inspected)) {
    console.log(JSON.stringify({ mode, database, refused: inspected.state !== "active" ? `configuration_${inspected.state}` : "desk_and_goal_metrics_disabled" }, null, 2));
    process.exitCode = 3;
    return;
  }
  const derivation = await mongoSalesOutreachReadStore.readContactDerivation();
  const range = resolveRecountRange({
    from: args.from,
    to: args.to,
    today,
    coverage_from_day: derivation?.coverage_from ? newYorkBusinessDay(derivation.coverage_from) : null,
  });
  const roster = (inspected.value.goals?.rep_work_schedules ?? []).map((row) => row.agent_id);
  const plan = async () => {
    const rows = await readRowsInRange(range.from, range.to);
    return { rows, keys: planRecountKeys({ rows, roster, ...range, today, materialize_roster: args.materialize_roster }) };
  };
  const header = {
    mode,
    database,
    range: { ...range, today },
    materialize_roster: args.materialize_roster,
    configuration: { version: inspected.version, revision: inspected.revision },
  };

  const dry = async () => {
    const { rows, keys } = await plan();
    return summarizeRecount(rows, await runRecount({ keys, loader, now, store: dryRunRepDayStore(mongoRepDayStore), transaction: withTransaction, publishGoal: noPublish }));
  };
  if (!args.apply) {
    console.log(JSON.stringify({ ...header, ...(await dry()) }, null, 2));
    return;
  }

  await assertProductionWriterMatchesDeployment();
  const { rows, keys } = await plan();
  const applied = summarizeRecount(rows, await runRecount({ keys, loader, now, store: mongoRepDayStore, transaction: withTransaction }));
  const verify = await dry();
  console.log(JSON.stringify({ ...header, ...applied, verify: { keys: verify.keys, outcomes: verify.outcomes } }, null, 2));
  if (applied.outcomes.failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "recount-rep-days failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
