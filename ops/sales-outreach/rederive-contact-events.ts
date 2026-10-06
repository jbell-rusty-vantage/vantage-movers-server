/**
 * Outreach lifecycle repair C8: re-derive contact events from a New York business day on, so every event
 * stores its `association_reason` and the dirty rep-days store the "Other outbound" breakdown
 * (`ops/lib/sales-outreach-rederive-contact-events.ts`).
 *
 *   pnpm outreach:rederive-contact-events --target=<database>                              # dry run from yesterday (read-only)
 *   pnpm outreach:rederive-contact-events --target=<database> --from=2026-10-05            # dry run from a day
 *   pnpm outreach:rederive-contact-events --target=<database> --from=2026-10-05 --apply     # off-peak: after 20:30 New York
 *   pnpm outreach:rederive-contact-events --target=<database> --from=2026-10-05 --kind=call
 *
 * - The target is named and must equal the database this process resolves; unnamed runs are refused.
 * - The dry run derives every source in read-only transactions and reports `would_change` by
 *   `association_reason`, the evaluate nominations it would cause and the expected "Other outbound"
 *   breakdown per business day (every reviewed initiator; the team read sums roster reps only).
 * - `--apply` passes the production-writer guard, writes the changed events page by page (the sweep's
 *   function: one transaction per page, `outreach_evaluate` nominations for subjects whose events moved),
 *   recounts the dirty rep-days, then repeats the dry run: `verify.would_change` is 0 when it converged.
 * - Refused (exit 3, nothing written) unless the configuration is active with the desk or goal metrics
 *   enabled — the same admission as the sweep. Exit 1 when a page or a rep-day recount failed (re-run:
 *   idempotent).
 * - Prints one JSON summary.
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo, withTransaction } from "../../src/db";
import { salesOutreachConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { wantsContactEvidence } from "../../src/services/salesOutreach/contacts/jobs";
import { mongoContactEventStore } from "../../src/services/salesOutreach/contacts/mongoStore";
import { mongoRepDayStore } from "../../src/services/salesOutreach/contacts/repDayService";
import { newYorkBusinessDay } from "../../src/services/salesOutreach/reads/businessDay";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import {
  dryRunContactEventStore,
  kindsOf,
  mongoRederiveSourcePager,
  parseRederiveArgs,
  recountDirtyRepDays,
  rederivePages,
  resolveRederiveRange,
  summarizeRederive,
} from "../lib/sales-outreach-rederive-contact-events";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

async function main() {
  const args = parseRederiveArgs(process.argv.slice(2));
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
  const range = resolveRederiveRange({ from: args.from, today });
  const header = {
    mode,
    database,
    range: { from: range.from, from_instant: range.from_instant.toISOString(), kind: args.kind, today },
    configuration: { version: inspected.version, revision: inspected.revision },
  };
  const pass = (store: typeof mongoContactEventStore) =>
    rederivePages({ kinds: kindsOf(args.kind), from: range.from_instant, now, pager: mongoRederiveSourcePager, store, transaction: withTransaction });

  if (!args.apply) {
    console.log(JSON.stringify({ ...header, ...summarizeRederive(await pass(dryRunContactEventStore(mongoContactEventStore)), "dry_run") }, null, 2));
    return;
  }

  await assertProductionWriterMatchesDeployment();
  const applied = await pass(mongoContactEventStore);
  const recount = await recountDirtyRepDays({ keys: applied.dirty_rep_days, loader, now, store: mongoRepDayStore, transaction: withTransaction });
  const verify = await pass(dryRunContactEventStore(mongoContactEventStore));
  console.log(
    JSON.stringify(
      {
        ...header,
        ...summarizeRederive(applied, "apply"),
        rep_day_recount: recount,
        verify: { would_change: verify.changed, pages_failed: verify.pages_failed },
      },
      null,
      2,
    ),
  );
  if (applied.pages_failed > 0 || recount.outcomes.failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "rederive-contact-events failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
