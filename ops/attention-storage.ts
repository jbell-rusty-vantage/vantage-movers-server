/** Aggregate-only storage evidence. Default is read-only. --indexes creates only the new artifact indexes. */
import mongoose from "mongoose";
import { writeFileSync } from "node:fs";
import { BSON, Timestamp } from "mongodb";
import { connectMongo } from "../src/db";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";
import { ATTENTION_ARTIFACT_INDEXES, getAttentionArtifactModel } from "../src/models/salesIntelligence/attentionArtifact";
import { decompressAttentionRows, rowSearchKeys } from "../src/services/salesIntelligence/outreach/attention";
import { attentionIndexEntry } from "../src/services/salesIntelligence/outreach/attentionIndex";
import { decodeAttentionArtifact, encodeAttentionManifest, restoreAttentionRow, attentionIdentity } from "../src/services/salesIntelligence/outreach/attentionManifest";
import { attentionRowDtoSchema } from "../src/services/salesIntelligence/dto";
import { resolvePolicy } from "../src/services/salesIntelligence/policy";
import { canonicalJson } from "../src/services/durableWork/checksum";
import { attentionStorageIndexProductionRefusal } from "./lib/attention-storage-guard";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
async function main() {
  const creatingIndexes = process.argv.includes("--indexes");
  const production = getMongoDatabaseName() === "vantagemovers";
  // DDL is a write even though the normal storage probe is read-only. Refuse
  // before opening a production connection unless an operator explicitly opted in.
  const productionRefusal = creatingIndexes ? attentionStorageIndexProductionRefusal(getMongoDatabaseName(), process.argv) : null;
  if (productionRefusal) throw new Error(productionRefusal);
  await connectMongo();
  if (creatingIndexes) {
    // The guard reads the deployed stamp from Mongo, so it necessarily runs after
    // connecting but always before the DDL. It also rejects a dirty or undeployed writer.
    if (production) await assertProductionWriterMatchesDeployment();
    await getAttentionArtifactModel().createIndexes();
    console.log(JSON.stringify({ indexes: ATTENTION_ARTIFACT_INDEXES.map(i => i.name), dataset: csiDataset() })); return;
  }
  const db = getSalesIntelligenceAttentionSnapshotModel().db.db!;
  const until = arg("--until") ? new Date(arg("--until")!) : new Date();
  const since = arg("--since") ? new Date(arg("--since")!) : new Date(+until - 12 * 60_000);
  const namespaces = ["sales_intelligence_attention_snapshots", "sales_intelligence_attention_artifacts"].map(c => `${db.databaseName}.${c}`);
  const oplog = await mongoose.connection.getClient().db("local").collection("oplog.rs").aggregate([
    { $match: { ts: { $gte: Timestamp.fromNumber(Math.floor(+since / 1000) * 2 ** 32), $lt: Timestamp.fromNumber(Math.floor(+until / 1000) * 2 ** 32) } } },
    { $project: { wall: 1, operations: { $cond: [{ $isArray: "$o.applyOps" }, "$o.applyOps", ["$$ROOT"]] } } },
    { $unwind: "$operations" }, { $match: { "operations.ns": { $in: namespaces } } },
    { $group: { _id: { ns: "$operations.ns", op: "$operations.op" }, count: { $sum: 1 }, bytes: { $sum: { $bsonSize: "$operations" } }, first: { $min: "$wall" }, last: { $max: "$wall" } } },
  ]).toArray();
  const stats = [];
  for (const collection of ["sales_intelligence_attention_snapshots", "sales_intelligence_attention_artifacts"]) {
    const stat = await db.command({ collStats: collection });
    stats.push({ collection, count: stat.count, data_bytes: stat.size, storage_bytes: stat.storageSize, index_bytes: stat.totalIndexSize });
  }
  const headers = await getSalesIntelligenceAttentionSnapshotModel().collection.find({ ...csiDataset(), chunk_index: null }).sort({ as_of: -1 }).limit(4).toArray();
  const report: Record<string, unknown> = { at: new Date(), since, until, seconds: (+until - +since) / 1000, oplog, stats,
    headers: headers.map(h => ({ as_of: h.as_of, total_items: h.counts.total_items, manifest: Boolean(h.manifest), bytes: BSON.calculateObjectSize(h),
      expires_at: h.expires_at, cursor_expires_at: h.cursor_expires_at, publish_ms: +h._id.getTimestamp() - +h.as_of })) };
  const legacy = headers.filter(h => h.rows_gzip_base64).slice(0, 2).reverse();
  if (legacy.length === 2) {
    const policy = await resolvePolicy();
    if (legacy.some(h => h.policy_version !== policy.version)) throw new Error("Shadow needs the exact snapshot staffing policy");
    const staffing = { timezone: policy.timezone, staffed_hours: policy.staffed_hours };
    const rows = legacy.map(h => decompressAttentionRows(h.rows_gzip_base64!).map(row => attentionRowDtoSchema.parse(row)));
    report.shadow = [128, 256, 512, 1024].map(buckets => {
      const encoded = rows.map(part => encodeAttentionManifest(part, staffing, (row, position) => ({ ...attentionIndexEntry(row, position), search: rowSearchKeys(row) }), buckets));
      let checked = 0;
      for (const [i, candidate] of encoded.entries()) {
        const originals = new Map(rows[i]!.map(row => [attentionIdentity(row), row]));
        for (const artifact of candidate.artifacts.filter(a => a.kind === "rows")) {
          const part = decodeAttentionArtifact("rows", artifact.hash, artifact.bytes);
          if (!Array.isArray(part)) throw new Error("Invalid shadow artifact");
          for (const stable of part) {
            const restored = restoreAttentionRow(stable, legacy[i]!.as_of, staffing);
            if (canonicalJson(restored) !== canonicalJson(originals.get(attentionIdentity(restored)))) throw new Error("Shadow semantic mismatch");
            checked++;
          }
        }
      }
      const previous = new Set(encoded[0]!.artifacts.map(a => a.hash));
      const next = encoded[1]!, missing = next.artifacts.filter(a => !previous.has(a.hash));
      const newBytes = missing.reduce((sum, a) => sum + BSON.calculateObjectSize({ ...a, ...csiDataset(), encoding: next.manifest.encoding, created_at: new Date() }), 0)
        + BSON.calculateObjectSize({ manifest: next.manifest });
      const baselineBytes = BSON.calculateObjectSize(legacy[1]!);
      return { buckets, checked_rows: checked, interval_seconds: (+legacy[1]!.as_of - +legacy[0]!.as_of) / 1000,
        changed_artifacts: missing.length, artifact_count: next.artifacts.length, new_bytes: newBytes, baseline_bytes: baselineBytes,
        reduction_percent: 100 * (1 - newBytes / baselineBytes), initial_artifact_bytes: next.artifacts.reduce((sum, a) => sum + a.bytes.length, 0) };
    });
  }
  const output = JSON.stringify(report, null, 2);
  if (arg("--out")) writeFileSync(arg("--out")!, output);
  console.log(output);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Attention storage probe failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
