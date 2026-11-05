/** Aggregate-only release evidence; no models, hooks, writes or customer payloads. */
import { MongoClient } from 'mongodb';

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db('vantagemovers');
    const since = new Date(process.argv[2] ?? Date.now() - 86400000);
    if (!Number.isFinite(+since)) throw new Error('Invalid since timestamp');
    const result: Record<string, unknown> = { observed_at: new Date(), since, database: db.databaseName };
    const aggregate = (collection: string, pipeline: object[]) => db.collection(collection)
      .aggregate(pipeline, { maxTimeMS: 20000 }).toArray();
    result.decisions = await aggregate('synchronization_decisions', [
      { $match: { decided_at: { $gte: since } } },
      { $group: { _id: '$outcome', count: { $sum: 1 },
        sheet_requests: { $sum: { $cond: [{ $in: ['sheet_sync_requested', '$effects.kind'] }, 1, 0] } } } },
    ]);
    result.runs = await aggregate('granot_automation_runs', [
      { $match: { createdAt: { $gte: since }, operation: 'estimates_in_process' } },
      { $group: { _id: '$status', count: { $sum: 1 }, first: { $min: '$createdAt' }, last: { $max: '$updatedAt' } } },
    ]);
    for (const collection of ['sheet_sync_jobs', 'sales_intelligence_jobs']) {
      result[collection] = await aggregate(collection, [
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { status: '$status', stage: '$stage', operation: '$operation' }, count: { $sum: 1 }, oldest: { $min: '$createdAt' } } },
      ]);
      result[`${collection}_backlog`] = await aggregate(collection, [
        { $match: { status: { $in: ['pending', 'retrying', 'processing', 'failed'] } } },
        { $group: { _id: { status: '$status', stage: '$stage' }, count: { $sum: 1 }, oldest: { $min: '$createdAt' } } },
      ]);
    }
    result.storage = [];
    for (const collection of ['granot_automation_runs', 'granot_webhook_receipts', 'granot_observations', 'synchronization_decisions', 'sheet_sync_jobs', 'sales_intelligence_jobs']) {
      const stats = await db.command({ collStats: collection, scale: 1 });
      (result.storage as unknown[]).push({ collection, count: stats.count, logical_bytes: stats.size,
        storage_bytes: stats.storageSize, index_bytes: stats.totalIndexSize, average_document_bytes: stats.avgObjSize });
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error('Read-only audit failed:', error.code ?? error.name); process.exitCode = 1; });
