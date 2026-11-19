/** Count only credential field sizes on the server. Never retrieve or archive credential values. */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { WEBHOOK_CREDENTIAL_HEADERS } from "../../src/services/ringcentral/webhook-capture";

async function main() {
  const [mode, iso] = process.argv.slice(2);
  const cutoff = new Date(iso ?? "");
  if (!["preview", "apply"].includes(mode ?? "") || !Number.isFinite(+cutoff) || +cutoff > Date.now()) throw Error("Expected preview|apply and past ISO cutoff");
  await connectMongo();
  const db = mongoose.connection.db;
  if (db?.databaseName !== "vantagemovers") throw Error("Unexpected database");
  const c = db.collection("ringcentral_webhook_events");
  const fields = WEBHOOK_CREDENTIAL_HEADERS.map(name => "headers." + name);
  const match = { receivedAt: { $lte: cutoff }, $or: fields.map(path => ({ [path]: { $exists: true } })) };
  const kept = { $arrayToObject: { $filter: { input: { $objectToArray: "$headers" }, as: "h",
    cond: { $not: [{ $in: ["$$h.k", WEBHOOK_CREDENTIAL_HEADERS] }] } } } };
  const preview = await c.aggregate([{ $match: match }, { $group: { _id: null, rows: { $sum: 1 },
    bytes: { $sum: { $subtract: [{ $bsonSize: "$headers" }, { $bsonSize: kept }] } } } }]).next();
  let modified = 0;
  if (mode === "apply") {
    const unset = Object.fromEntries(fields.map(path => [path, ""]));
    for (;;) {
      const rows = await c.find(match, { projection: { _id: 1 } }).sort({ receivedAt: 1 }).limit(500).toArray();
      if (!rows.length) break;
      modified += (await c.updateMany({ ...match, _id: { $in: rows.map(r => r._id) } }, { $unset: unset })).modifiedCount;
    }
  }
  console.log(JSON.stringify({ collection: c.collectionName, mode, cutoff, rows: preview?.rows ?? 0, bytes: preview?.bytes ?? 0, modified }));
}
main().finally(() => mongoose.disconnect()).catch(error => { console.error(error.name); process.exitCode = 1; });
