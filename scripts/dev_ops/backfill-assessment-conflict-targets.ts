/**
 * V-SERVER m6 one-time backfill: `move_assessment.conflict_targets` on Outreach projections published
 * before S1-FACTS. `conflict_targets` is derived from the immutable artifact's `conflicts` by the same
 * `conflictTargetsFor` the publish uses, so the backfill reads each pointed artifact and `$set`s the
 * derived value, guarded on the record still pointing at that artifact (a concurrent republish wins).
 * No model call, no revision bump: the next Attention publish carries `facts.details_disagree`.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/backfill-assessment-conflict-targets.ts                 # dry run
 *   ... --confirm-write [--allow-production]
 *
 * Output is counts only.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getMoveAssessmentArtifactModel } from "../../src/models/MoveAssessmentArtifact";
import { conflictTargetsFor } from "../../src/services/salesIntelligence/assessment/runtime";
import { isLoopbackTestDatabase } from "./sweep-number-rollups";

const BATCH = 500;
const flag = (name: string) => process.argv.includes(name);

export type ConflictTargetsSummary = { database: string; write: boolean; records: number; with_conflicts: number; updated: number; artifact_missing: number };

export async function backfillConflictTargets(write: boolean): Promise<ConflictTargetsSummary> {
  const summary: ConflictTargetsSummary = { database: getMongoDatabaseName(), write, records: 0, with_conflicts: 0, updated: 0, artifact_missing: 0 };
  const Records = getOutreachRecordModel(), Artifacts = getMoveAssessmentArtifactModel();
  let after: mongoose.Types.ObjectId | null = null;
  for (;;) {
    const batch: Array<{ _id: mongoose.Types.ObjectId; move_assessment?: { artifact_id?: unknown } | null }> = await Records.collection
      .find({ "move_assessment.artifact_id": { $ne: null }, $or: [{ "move_assessment.conflict_targets": { $exists: false } }, { "move_assessment.conflict_targets": { $size: 0 } }],
        ...(after ? { _id: { $gt: after } } : {}) }, { projection: { "move_assessment.artifact_id": 1 } })
      .sort({ _id: 1 }).limit(BATCH).toArray() as never;
    if (!batch.length) break;
    after = batch.at(-1)!._id;
    summary.records += batch.length;
    const artifactIds = batch.map(row => row.move_assessment!.artifact_id);
    const artifacts = await Artifacts.collection.find({ _id: { $in: artifactIds as mongoose.Types.ObjectId[] } }, { projection: { conflicts: 1 } }).toArray();
    const byId = new Map(artifacts.map(artifact => [String(artifact._id), conflictTargetsFor(artifact.conflicts)]));
    const updates = batch.flatMap(row => {
      const artifactId = row.move_assessment!.artifact_id;
      const targets = byId.get(String(artifactId));
      if (!targets) { summary.artifact_missing += 1; return []; }
      if (!targets.length) return [];
      summary.with_conflicts += 1;
      return [{ updateOne: { filter: { _id: row._id, "move_assessment.artifact_id": artifactId }, update: { $set: { "move_assessment.conflict_targets": targets } } } }];
    });
    if (write && updates.length) summary.updated += (await Records.collection.bulkWrite(updates as never, { ordered: false })).modifiedCount;
  }
  return summary;
}

async function main() {
  await connectMongo();
  const write = flag("--confirm-write");
  if (write && !isLoopbackTestDatabase(getMongoDatabaseName(), process.env.MONGO_URI) && !flag("--allow-production"))
    throw new Error("the database is not a loopback testvantagemovers_* one; pass --allow-production to write");
  console.log(JSON.stringify({ ...(await backfillConflictTargets(write)), dry_run: !write }));
}

if (require.main === module) {
  main().then(() => mongoose.disconnect()).catch(async (error) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    await mongoose.disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
}
