/** Owner-authorized emergency cleanup. Uses a verified external backup manifest.
 * node --env-file=.env --import tsx scripts/prune-legacy-outreach-jobs.ts --apply --manifest <path>
 * Without --apply, validates and reports only. Never selects modern repair jobs.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import mongoose from "mongoose";
import { BSON } from "mongodb";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";

async function main() {
  const args = process.argv.slice(2);
  const manifestArg = args.indexOf("--manifest");
  if (manifestArg < 0 || !args[manifestArg + 1]) throw new Error("Manifest required");
  const manifestPath = path.resolve(args[manifestArg + 1]);
  const manifest = BSON.EJSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (getMongoDatabaseName() !== "vantagemovers" || manifest.database !== "vantagemovers" ||
      manifest.collection !== "sales_intelligence_jobs" || Number(manifest.count) > 66097) {
    throw new Error("Unexpected cleanup scope");
  }
  const archive = fs.readFileSync(manifest.archive);
  if (createHash("sha256").update(archive).digest("hex") !== manifest.sha256) throw new Error("Backup checksum mismatch");
  const docs = BSON.EJSON.parse(gunzipSync(archive).toString());
  const ids = manifest.ids.map((id: unknown) => new mongoose.Types.ObjectId(String(id)));
  if (docs.length !== ids.length || docs.length !== Number(manifest.count) ||
      docs.some((doc: { _id: unknown }, i: number) => String(doc._id) !== String(ids[i]))) throw new Error("Backup ID mismatch");
  await connectMongo();
  const db = mongoose.connection.db!;
  if (db.databaseName !== "vantagemovers") throw new Error("Wrong connected database");
  const jobs = db.collection("sales_intelligence_jobs");
  const legacy = /^csi:outreach:repair:OutreachRecord:[a-f0-9]{24}:[0-9]{13}$/;
  if (await jobs.countDocuments({ dedupe_key: legacy, createdAt: { $gte: new Date(Date.now() - 3600000) } })) {
    throw new Error("Legacy writer is active");
  }
  // Full reference checks were performed when creating this exact archived manifest.
  // Recheck indexed live execution dependencies before deleting the locked cohort.
  for (const [name, field] of [["intelligence_runs", "job_id"], ["intelligence_submissions", "application_job_id"],
    ["sales_intelligence_ai_reservations", "job_id"], ["contact_numbers", "intelligence_schedule.job_id"]]) {
    if (await db.collection(name).findOne({ [field]: { $in: ids } }, { projection: { _id: 1 } })) throw new Error(`Referenced jobs: ${name}`);
  }
  const guard = {
    deployment: "csi-production", database: "vantagemovers", stage: "outreach_ensure", status: "completed",
    dedupe_key: legacy, completed_at: { $type: "date" as const, $lt: new Date(manifest.at.getTime() - 3600000) },
    "result.pending_blob_delete": { $exists: false },
    $or: [{ leased_until: null }, { leased_until: { $lte: new Date() } }],
  };
  const before = await db.stats();
  const result = { startedAt: new Date(), manifest: manifestPath, planned: ids.length, deleted: 0, remaining: -1, before, after: null as unknown };
  const resultPath = path.join(path.dirname(manifestPath), `prune-result-${Date.now()}.json`);
  const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ planned: ids.length, archivedDocumentBytes: Number(manifest.documentBytes), apply: args.includes("--apply") }));
  if (!args.includes("--apply")) return;
  save();
  for (let start = 0; start < ids.length; start += 1000) {
    const batch = ids.slice(start, start + 1000);
    const removed = await jobs.deleteMany({ ...guard, _id: { $in: batch } });
    result.deleted += removed.deletedCount;
    save();
    if (start % 10000 === 0) console.log(JSON.stringify({ deleted: result.deleted, planned: ids.length }));
  }
  result.remaining = await jobs.countDocuments({ _id: { $in: ids } });
  result.after = await db.stats();
  save();
  console.log(JSON.stringify({ deleted: result.deleted, remaining: result.remaining, beforeDataBytes: before.dataSize,
    after: result.after, resultPath }));
  if (result.remaining) throw new Error("Some archived rows remain; inspect result before retrying");
}
main().catch(error => { console.error(error instanceof Error ? error.name + ": " + error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, "[redacted]") : "Cleanup failed"); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
