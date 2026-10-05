/**
 * All Numbers v2 cleanup (all-numbers CONTRACT §5, phase B). Run only after phase B is deployed and
 * the migration was verified.
 *
 *   node --env-file=.env --import tsx ops/numbers-v2/cleanup.ts --target=<database>            # dry run (default): reads only
 *   node --env-file=.env --import tsx ops/numbers-v2/cleanup.ts --target=<database> --apply    # writes
 *
 * Apply, in this order:
 *   1. drops the `contact_numbers` indexes keyed on the retired fields (`kind`, `classification`,
 *      `contact_eligibility`, `rollups.*`);
 *   2. unsets the retired fields (`kind`, `classification*`, `contact_eligibility`, `rollups`) on every
 *      Contact Number, purged ones included;
 *   3. drops `number_lead_attachments`.
 * It refuses to apply while any non-purged number lacks `summary_version: 1` (run the migration first).
 * Writes go through the driver, not the Mongoose model: the phase B schema no longer declares these
 * paths, and `strict: "throw"` refuses an `$unset` of an undeclared path. Idempotent: a second run finds
 * nothing to do. Production applies pass the production-writer guard. Prints one JSON summary.
 *
 * Point of no return: after the cleanup the phase A code cannot be redeployed (its interim Numbers
 * reads expect `rollups`), and the attachment seed is gone.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { CONTACT_NUMBER_SUMMARY_VERSION } from "../../src/models/ContactNumber";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { NUMBER_V1_FIELDS, parseNumbersV2Args } from "../lib/numbers-v2";

/** Indexes of the retired fields, as phase A declared them. */
export const RETIRED_CONTACT_NUMBER_INDEXES = [
  "contact_number_classification_activity_id",
  "contact_number_kind_activity",
  "contact_number_kind_human_conversation",
  "contact_number_kind_first_observed",
  "contact_number_kind_interactions",
  "contact_number_eligibility",
] as const;

export async function runNumbersV2Cleanup(argv: readonly string[], log: (line: string) => void = console.log) {
  const args = parseNumbersV2Args(argv, { allowed: ["--apply"] });
  assertTargetMatchesDatabase(args.target, getMongoDatabaseName());
  await connectMongo();
  const db = mongoose.connection.useDb(args.target, { useCache: true }).db;
  if (!db) throw new Error("database handle unavailable");
  const numbers = db.collection("contact_numbers");
  const retiredFilter = { $or: NUMBER_V1_FIELDS.map((field) => ({ [field]: { $exists: true } })) };
  const collections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const indexes = (await numbers.indexes()).map((index) => index.name).filter((name): name is string => Boolean(name));
  const plan = {
    numbers_with_retired_fields: await numbers.countDocuments(retiredFilter),
    indexes_to_drop: RETIRED_CONTACT_NUMBER_INDEXES.filter((name) => indexes.includes(name)),
    attachments_collection: collections.has("number_lead_attachments"),
    attachments: collections.has("number_lead_attachments") ? await db.collection("number_lead_attachments").countDocuments() : 0,
    unstamped_numbers: await numbers.countDocuments({ purged_at: null, summary_version: { $ne: CONTACT_NUMBER_SUMMARY_VERSION } }),
  };
  const summary: Record<string, unknown> = { mode: args.apply ? "apply" : "dry_run", database: args.target, plan };
  if (!args.apply) {
    log(JSON.stringify(summary, null, 2));
    return summary;
  }
  if (plan.unstamped_numbers > 0) throw new Error(`Refusing: ${plan.unstamped_numbers} non-purged numbers lack summary_version ${CONTACT_NUMBER_SUMMARY_VERSION}; run ops/numbers-v2/migrate.ts --apply first`);
  await assertProductionWriterMatchesDeployment();
  for (const name of plan.indexes_to_drop) await numbers.dropIndex(name);
  const unset = await numbers.updateMany(retiredFilter, { $unset: Object.fromEntries(NUMBER_V1_FIELDS.map((field) => [field, ""])) });
  const dropped = plan.attachments_collection ? await db.collection("number_lead_attachments").drop() : false;
  summary.applied = { indexes_dropped: plan.indexes_to_drop, numbers_unset: unset.modifiedCount, attachments_dropped: dropped };
  summary.after = { numbers_with_retired_fields: await numbers.countDocuments(retiredFilter) };
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("ops/numbers-v2/cleanup.ts")) {
  runNumbersV2Cleanup(process.argv.slice(2))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "All Numbers v2 cleanup failed");
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
