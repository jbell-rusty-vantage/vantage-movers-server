/** Preview or remove exactly reproducible webhook previews. Keep original evidence and all indexed fields. */
import { isDeepStrictEqual } from "node:util";
import { BSON } from "mongodb";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { previewRingCentralWebhookPayload } from "../../src/services/ringcentral/webhook-capture";

async function main() {
  const [mode, timestamp] = process.argv.slice(2);
  if (!["preview", "apply"].includes(mode ?? "") || !timestamp) throw Error("Expected preview|apply and ISO cutoff");
  const cutoff = new Date(timestamp);
  if (!Number.isFinite(+cutoff) || +cutoff > Date.now()) throw Error("Invalid cutoff");
  await connectMongo();
  const db = mongoose.connection.db;
  if (db?.databaseName !== "vantagemovers") throw Error("Unexpected database");
  const collection = db.collection("ringcentral_webhook_events");
  const query = { receivedAt: { $lte: cutoff }, normalizedPreview: { $exists: true } };
  let eligible = 0, bytes = 0, held = 0, modified = 0;
  let batch = [];
  for await (const row of collection.find(query, { projection: { normalizedPreview: 1, rawBody: 1 } }).sort({ _id: 1 }).batchSize(100)) {
    if (!row.rawBody || !isDeepStrictEqual(previewRingCentralWebhookPayload(row.rawBody), row.normalizedPreview)) {
      held++;
      continue;
    }
    eligible++;
    bytes += BSON.calculateObjectSize({ normalizedPreview: row.normalizedPreview }) - 5;
    if (mode === "apply") {
      batch.push({ updateOne: { filter: { _id: row._id, rawBody: { $eq: row.rawBody }, normalizedPreview: { $eq: row.normalizedPreview } }, update: { $unset: { normalizedPreview: "" } } } });
      if (batch.length === 100) {
        modified += (await collection.bulkWrite(batch)).modifiedCount;
        batch = [];
      }
    }
  }
  if (batch.length) modified += (await collection.bulkWrite(batch)).modifiedCount;
  console.log(JSON.stringify({ collection: collection.collectionName, mode, cutoff, eligible, bytes, held, holdReason: "raw evidence missing or preview differs", modified }));
}
main().finally(() => mongoose.disconnect()).catch(error => { console.error(error.name); process.exitCode = 1; });
