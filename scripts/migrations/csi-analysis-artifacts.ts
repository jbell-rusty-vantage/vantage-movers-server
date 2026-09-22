/** Additive index only. Default is read-only; --apply creates the summary artifact uniqueness fence. */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getIntelligenceEvidenceSnapshotModel, INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES } from "../../src/models/IntelligenceEvidenceSnapshot";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";

async function main() {
  await connectMongo();
  const collection = getIntelligenceEvidenceSnapshotModel().collection;
  const index = INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES.find(i => i.name === "csi_evidence_artifact_unique")!;
  const present = (await collection.indexes()).some(i => i.name === index.name);
  if (!present && process.argv.includes("--apply")) await collection.createIndex({ artifact_key: 1 }, {
    name: index.name, unique: true, partialFilterExpression: { artifact_key: { $type: "string" } },
  });
  console.log(JSON.stringify({ database: getMongoDatabaseName(), index: index.name,
    ready: present || process.argv.includes("--apply"), applied: !present && process.argv.includes("--apply") }));
}
main().catch(error => { console.error(JSON.stringify({ error: error instanceof Error ? error.name : "migration_failed" })); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
