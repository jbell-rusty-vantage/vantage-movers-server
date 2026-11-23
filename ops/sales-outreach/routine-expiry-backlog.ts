/**
 * Give already-completed Sales Intelligence jobs the routine three-day purge they would get at completion today
 * (`ops/lib/sales-outreach-routine-expiry-backlog.ts`).
 *
 *   pnpm outreach:routine-expiry-backlog --target=vantagemovers                       # dry run (default, read-only)
 *   pnpm outreach:routine-expiry-backlog --target=vantagemovers --apply --limit=5000  # Owner-approved apply
 *   ... --after=<last _id>   resume after a stopped run; ... --batch=500 --pause-ms=250
 *
 * - The target must equal the database this process resolves.
 * - The dry run reads from a secondary and writes nothing.
 * - `--apply` requires `--limit`, passes the production-writer guard, reads the primary and writes one ordered-false
 *   bulk of single-row updates per batch. Each update is fenced on the row still being completed, unchanged and
 *   without `routine_purge_at`, so a re-run or a concurrent completion is a no-op. It prints `next_after` to resume.
 * - Prints one JSON summary.
 */
import mongoose from "mongoose";
import { BSON, ObjectId, type AnyBulkWriteOperation, type Document } from "mongodb";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { connectMongo } from "../../src/db";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { BACKLOG_STAGES, emptyPlan, parseBacklogArgs, planBacklogRow, type BacklogRow } from "../lib/sales-outreach-routine-expiry-backlog";

async function main() {
  const args = parseBacklogArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  if (args.apply) await assertProductionWriterMatchesDeployment();
  const collection = getSalesIntelligenceJobModel().collection;
  const now = new Date();
  const plan = emptyPlan();
  let scanned = 0, matched = 0, modified = 0, last: ObjectId | null = args.after ? new ObjectId(args.after) : null;
  // Every runtime query on this collection is scoped to this deployment's dataset; so is the backlog.
  const dataset = csiDataset();
  const filter = (after: ObjectId | null): Document => ({
    ...dataset, stage: { $in: [...BACKLOG_STAGES] }, status: "completed", completed_at: { $type: "date" },
    routine_purge_at: { $exists: false }, ...(after ? { _id: { $gt: after } } : {}),
  });
  const cursor = collection.find(filter(last), { sort: { _id: 1 }, batchSize: args.batch,
    readPreference: args.apply ? "primary" : "secondaryPreferred" });
  let pending: AnyBulkWriteOperation[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const written = await collection.bulkWrite(pending, { ordered: false });
    matched += written.matchedCount;
    modified += written.modifiedCount;
    pending = [];
    if (args.pause_ms) await new Promise((resolve) => setTimeout(resolve, args.pause_ms));
  };
  for await (const doc of cursor) {
    scanned++;
    const purge = planBacklogRow(plan, doc as unknown as BacklogRow, BSON.calculateObjectSize(doc), now);
    last = doc._id as ObjectId;
    if (!purge || !args.apply) continue;
    pending.push({ updateOne: {
      filter: { _id: doc._id, ...dataset, status: "completed", completed_at: doc.completed_at, payload_hash: doc.payload_hash,
        routine_purge_at: { $exists: false } },
      update: { $set: { routine_purge_at: purge } },
    } });
    if (pending.length >= args.batch) await flush();
    if (args.limit !== null && matched + pending.length >= args.limit) break;
  }
  await flush();
  await cursor.close();
  const eligible = Object.values(plan.eligible).reduce((sum, t) => ({ rows: sum.rows + t.rows, bytes: sum.bytes + t.bytes, leave_now: sum.leave_now + t.leave_now }),
    { rows: 0, bytes: 0, leave_now: 0 });
  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry_run", database, deployment: dataset.deployment, measured_at: now.toISOString(), scanned,
    eligible_total: { ...eligible, mib: +(eligible.bytes / 1_048_576).toFixed(2) }, plan,
    ...(args.apply ? { matched, modified, next_after: last ? String(last) : null } : {}),
  }, null, 2));
}

main().finally(() => mongoose.disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
