/** Release one generation after the operator has verified its external recovery dependencies. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { connectMongo } from "../src/db";
import mongoose from "mongoose";
import { ARCHIVE_BUCKET, archiveObject } from "../src/services/granotHistory/archiveCodec";
import { createGoogleServiceAccountAuth } from "../src/services/googleAuth/serviceAccount";
import type { Db, Document } from "mongodb";

async function stillReferenced(db: Db, hash: string) {
  const checks: [string, Document][] = [
    ["granot_history_archive_chunks", { $or: [{ _id: hash }, { hash }] }],
    ["granot_closed_automation_runs", { $or: [{ hash }, { "run_archive.hash": hash }] }],
    ["granot_archived_receipts", { $or: [{ hash }, { "evidence_archive.hash": hash }, { "history_archive.hash": hash }] }],
    ["granot_webhook_receipts", { $or: [{ "evidence_archive.hash": hash }, { "history_archive.hash": hash }] }],
    ["granot_automation_runs", { "archive_summary.hash": hash }],
  ];
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      for (const [name, filter] of checks) {
        if (await db.collection<Document & { _id: unknown }>(name).findOne(filter, { session, projection: { _id: 1 }, maxTimeMS: 5000 })) return true;
      }
      return false;
    }, { readConcern: { level: "snapshot" } });
  } finally { await session.endSession(); }
}

async function main() {
  const [mode, evidencePath] = process.argv.slice(2);
  if (!["begin", "release"].includes(mode) || !evidencePath) throw Error("Expected begin|release and a reviewed evidence JSON path");
  const bytes = readFileSync(evidencePath);
  const evidence = JSON.parse(bytes.toString("utf8"));
  const { hash, generation } = evidence;
  if (!/^[a-f0-9]{64}$/.test(hash) || typeof generation !== "string" || !/^\d+$/.test(generation) ||
      !["backup_clearance", "rollback_clearance", "reader_clearance", "external_writer_clearance"].every(
        key => typeof evidence[key] === "string" && evidence[key].trim().length > 0
      )) throw Error("Generation-specific backup, rollback, reader and external-writer evidence required");
  const proof = createHash("sha256").update(bytes).digest("hex");
  await connectMongo();
  const db = mongoose.connection.db;
  if (!db || db.databaseName !== "vantagemovers" || (await db.admin().command({hello:1})).setName !== "atlas-khw1wz-shard-0")
    throw Error("Unexpected database");
  const storage = google.storage({version:"v1", auth:createGoogleServiceAccountAuth(["https://www.googleapis.com/auth/devstorage.full_control"])});
  const object = archiveObject(db.databaseName, hash);
  const target = {bucket:ARCHIVE_BUCKET, object, generation};
  const current = (await storage.objects.get({...target,fields:"generation,metageneration,customTime,temporaryHold,eventBasedHold,retention,metadata,updated"})).data;
  if (current.generation !== generation || !current.metageneration || current.eventBasedHold || current.retention?.retainUntilTime)
    throw Error("Generation changed or independent retention applies");
  const meta = current.metadata ?? {};
  if (current.customTime && !current.temporaryHold) { console.log("Already released at",current.customTime); return; }
  const cas = {...target,ifGenerationMatch:generation,ifMetagenerationMatch:current.metageneration};
  if (await stillReferenced(db,hash)) throw Error("A MongoDB reader still references this object");
  if (mode === "begin") {
    if (meta.granotReleaseReview && meta.granotReleaseEvidence === proof && current.temporaryHold) {console.log("Review already started"); return;}
    if (current.temporaryHold && meta.granotPublisherHold !== "1") throw Error("An independent hold or review is active");
    await storage.objects.patch({...cas,requestBody:{temporaryHold:true,metadata:{...meta,
      granotReleaseReview:randomUUID(),granotReleaseEvidence:proof,granotPublisherHold:""}}});
    console.log("Review started for",generation);
    return;
  }
  const started = Date.parse(current.updated ?? "");
  if (!current.temporaryHold || !meta.granotReleaseReview || meta.granotReleaseEvidence !== proof ||
      !Number.isFinite(started) || Date.now()-started < 800_000)
    throw Error("Begin this review and drain the server publication window first");
  const released = (await storage.objects.patch({...cas,requestBody:{temporaryHold:false,customTime:new Date().toISOString(),
    metadata:{...meta,granotReleaseReview:"",granotPublisherHold:""}}})).data;
  console.log("Recovery clock started for",released.generation,released.customTime);
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>mongoose.disconnect());
