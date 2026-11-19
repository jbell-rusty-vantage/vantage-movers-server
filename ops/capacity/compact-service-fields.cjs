/** Lossless field compaction. Supply preview or apply, an ISO cutoff and a new report path.
 * Resuming the same cutoff skips compacted rows. No document or index is deleted.
 */
const fs = require("node:fs");
const { MongoClient, ObjectId } = require("mongodb");
const [mode, cutoffText, destination, only] = process.argv.slice(2);
const cutoff = new Date(cutoffText);
if (!["preview", "apply"].includes(mode) || !Number.isFinite(+cutoff) || cutoff > new Date() || !destination || fs.existsSync(destination)) {
  throw Error("Expected mode, past UTC cutoff and unused output path");
}
const uri = new URL(process.env.MONGO_URI);
if (uri.hostname !== "vantagecluster.ccf491v.mongodb.net") throw Error("Unexpected cluster");
if (process.env.MONGO_DNS_SERVERS) require("node:dns").setServers(process.env.MONGO_DNS_SERVERS.split(","));
const client = new MongoClient(uri.href, { maxPoolSize: 2, appName: "owner-service-retention", retryWrites: true });
const db = client.db("vantagemovers");
const ceiling = ObjectId.createFromTime(Math.floor(+cutoff / 1000));
const rules = [
  { collection: "daily_operations_events", field: "redis_stream_id", predicate: { redis_stream_id: { $type: "null" }, $expr: { $eq: [{ $type: "$redis_stream_id" }, "null"] } } },
  { collection: "domain_command_executions", field: "result", predicate: {
    origin: { $in: ["granot_lifecycle", "vantage_admin", "ringcentral"] },
    command_name: { $in: ["createFormLead", "createCallLead", "createLeadFromGranot", "synchronizeLeadFromGranot", "createBookingFromLead", "createLeadlessBooking", "confirmGranotBooking", "createCancellation",
      "deleteFormLead", "deleteCallLead", "deleteBookedLead", "deleteCancelledLead", "updateSourceOwnedLead", "updateBookedLead",
      "updateCancelledLead", "updateBooking", "createReferralBooking", "createExistingReferralBooking", "recoverCallLeadMoveDate",
      "mirrorFormLeadToCallSibling", "adoptRingCentralCall"] },
    entity_refs: { $type: "array" }, warnings: { $type: "array" },
    $expr: { $eq: ["$result", { status: "applied", entity_refs: "$entity_refs", warnings: "$warnings" }] },
  } },
  { collection: "sheet_sync_jobs", field: "leased_until", predicate: { status: "synced", leased_until: new Date(0) } },
  { collection: "sheet_sync_attempts", field: "google_reasons", predicate: { google_reasons: { $size: 0 } } },
];
async function preview(rule) {
  const [row] = await db.collection(rule.collection).aggregate([
    { $match: { _id: { $lt: ceiling }, ...rule.predicate } },
    { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: { $bsonSize: "$$ROOT" } },
      saved: { $sum: { $subtract: [{ $bsonSize: "$$ROOT" }, { $bsonSize: { $unsetField: { field: rule.field, input: "$$ROOT" } } }] } } } },
    { $project: { _id: 0 } },
  ], { maxTimeMS: 120000 }).toArray();
  return row || { count: 0, bytes: 0, saved: 0 };
}
async function run() {
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.isWritablePrimary || hello.setName !== "atlas-khw1wz-shard-0") throw Error("Unexpected primary");
  const report = { mode, cutoff, started: new Date(), collections: {} };
  const selected = only ? rules.filter(rule => only.split(",").includes(rule.collection)) : rules;
  if (!selected.length || (only && selected.length !== only.split(",").length)) throw Error("Unknown collection selection");
  for (const rule of selected) {
    const collection = db.collection(rule.collection);
    const before = await preview(rule);
    const entry = report.collections[rule.collection] = { before, batches: 0, modified: 0 };
    if (mode === "apply") {
      let last;
      while (true) {
        const _id = last ? { $gt: last, $lt: ceiling } : { $lt: ceiling };
        const candidates = await collection.find({ _id, ...rule.predicate }, { projection: { _id: 1 } })
          .hint("_id_").sort({ _id: 1 }).limit(500).maxTimeMS(60000).toArray();
        if (!candidates.length) break;
        const ids = candidates.map(row => row._id);
        const result = await collection.updateMany({ _id: { $in: ids }, ...rule.predicate }, { $unset: { [rule.field]: "" } }, { writeConcern: { w: "majority" }, maxTimeMS: 30000 });
        entry.batches++; entry.modified += result.modifiedCount;
        last = ids.at(-1);
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      entry.after = await preview(rule);
    }
    console.log(rule.collection, JSON.stringify(entry));
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  }
  report.finished = new Date();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2));
}
run().finally(() => client.close()).catch(error => { console.error(error.name, error.code, error.message.slice(0,120)); process.exitCode = 1; });
