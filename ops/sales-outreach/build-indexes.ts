/**
 * Build the Sales Outreach Desk indexes (IMPLEMENTATION-PLAN §4, FAST-TRACK step 2).
 *
 *   pnpm outreach:indexes --target=<database>            # plan (default): read-only
 *   pnpm outreach:indexes --target=<database> --apply    # create what is missing
 *
 * - The target is named, never inferred, and must equal the database this process resolves.
 * - Plan mode reads index lists and probes unique indexes for duplicates; it writes nothing.
 * - Apply is idempotent: identical indexes are skipped, conflicts and duplicates refuse the run
 *   before any index is created, and production applies pass the production-writer guard.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { SALES_OUTREACH_MODEL_REGISTRY } from "../../src/models/salesOutreach/registry";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import {
  assertTargetMatchesDatabase,
  createIndexOptions,
  duplicateProbePipeline,
  parseIndexBuildArgs,
  planIndexBuild,
  type ObservedIndex,
} from "../lib/sales-outreach-indexes";

async function main() {
  const { target, mode } = parseIndexBuildArgs(process.argv.slice(2));
  assertTargetMatchesDatabase(target, getMongoDatabaseName());
  await connectMongo();
  const db = mongoose.connection.useDb(target, { useCache: true }).db;
  if (!db) throw new Error("database handle unavailable");
  if (mode === "apply") await assertProductionWriterMatchesDeployment();

  const declared = SALES_OUTREACH_MODEL_REGISTRY.map((entry) => ({
    collection: String(entry.model().collection.collectionName),
    indexes: entry.indexes,
  }));
  const existingCollections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const observed = new Map<string, ObservedIndex[]>();
  for (const { collection } of declared)
    observed.set(collection, existingCollections.has(collection) ? ((await db.collection(collection).indexes()) as ObservedIndex[]) : []);

  const actions = planIndexBuild(declared, observed);
  const duplicates: { collection: string; name: string; samples: number }[] = [];
  for (const action of actions) {
    if (action.action !== "create" || !action.spec.unique || !existingCollections.has(action.collection)) continue;
    const found = await db.collection(action.collection).aggregate(duplicateProbePipeline(action.spec), { allowDiskUse: true }).toArray();
    if (found.length) duplicates.push({ collection: action.collection, name: action.name, samples: found.length });
  }
  const conflicts = actions.filter((a) => a.action === "conflict");
  const report = {
    mode,
    database: target,
    create: actions.filter((a) => a.action === "create").map((a) => `${a.collection}.${a.name}`),
    exists: actions.filter((a) => a.action === "exists").length,
    conflicts,
    duplicates,
  };
  console.log(JSON.stringify(report, null, 2));
  if (conflicts.length || duplicates.length) {
    process.exitCode = 1;
    console.error("Refusing to build: resolve the conflicts/duplicates above first.");
    return;
  }
  if (mode !== "apply") return;
  for (const action of actions) {
    if (action.action !== "create") continue;
    await db.collection(action.collection).createIndex(action.spec.key as Record<string, 1 | -1>, createIndexOptions(action.spec));
    console.log(JSON.stringify({ created: `${action.collection}.${action.name}` }));
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Sales Outreach index build failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
