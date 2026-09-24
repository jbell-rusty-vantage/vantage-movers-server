/**
 * Read-only: recent Attention snapshot headers with their walk time (ObjectId creation − `as_of`),
 * row counts and V2 fields. Used to watch the production publish against its 90 s budget.
 *   node --env-file=.env --import tsx scripts/dev_ops/inspect-attention-walks.ts [--n 15]
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../src/models/SalesIntelligenceAttentionSnapshot";

async function main() {
  await connectMongo();
  const i = process.argv.indexOf("--n"), n = i >= 0 ? Number(process.argv[i + 1]) : 15;
  const rows = await getSalesIntelligenceAttentionSnapshotModel().collection.find({ ...csiDataset(), chunk_index: null },
    { projection: { snapshot_id: 1, as_of: 1, counts: 1, "metrics.as_of": 1, index_gzip_base64: { $substrCP: ["$index_gzip_base64", 0, 1] } } })
    .sort({ as_of: -1 }).limit(n).toArray();
  for (const row of rows) {
    const written = (row._id as mongoose.Types.ObjectId).getTimestamp();
    const asOf = row.as_of as Date;
    console.log(JSON.stringify({ as_of: asOf.toISOString(), walk_s: Math.round((+written - +asOf) / 100) / 10, total_items: row.counts?.total_items ?? null,
      closed_items: row.counts?.closed_items ?? null, chunks: row.counts?.chunks ?? 0, v2: Boolean(row.index_gzip_base64) }));
  }
}
main().then(() => mongoose.disconnect()).catch(async error => { console.error(error instanceof Error ? error.message : String(error)); await mongoose.disconnect().catch(() => undefined); process.exitCode = 1; });
