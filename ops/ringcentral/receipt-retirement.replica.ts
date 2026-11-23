/**
 * RingCentral receipt retirement, end to end on the local replica (csi01, loopback only) with a fake bucket.
 *   node --import tsx ops/ringcentral/receipt-retirement.replica.ts
 * Proves: a storage failure changes nothing; a run archives every reviewed receipt, deletes only the proven ones, keeps
 * held receipts, receipts newer than a day, receipts behind the recovery watermark and the newest receipt; a retired
 * receipt restores byte for byte by original ID; a re-run does nothing. Synthetic rows in a unique database dropped at the end.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { BSON, ObjectId } from "mongodb";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_rcretire${randomUUID().replaceAll("-", "").slice(0, 12)}`;
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "rc-retire-replica";

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { payloadHash } = await import("../../src/services/salesIntelligence/transactions.js");
  const { CLOUD_STORAGE_NAMESPACES, createFakeObjectStore } = await import("../../src/services/cloudStorage/index.js");
  const { ensureRingCentralWebhookEventIndexes } = await import("../../src/services/ringcentral/webhook-capture.js");
  const { RECEIPT_ARCHIVE_PACKS_COLLECTION, RECEIPT_ARCHIVE_PACK_INDEXES, RECEIPT_RETIREMENT_CONTROL_COLLECTION, RECEIPT_RETIREMENT_CONTROL_ID,
    lookupArchivedReceipt, receiptsOf, retireProvenReceipts } = await import("../../src/services/numberActivity/receiptRetirement.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  assert.match(process.env.MONGO_URI!, /^mongodb:\/\/127\.0\.0\.1:/, "loopback replica only");
  const db = mongoose.connection.db!;
  try {
    await ensureRingCentralWebhookEventIndexes();
    for (const i of RECEIPT_ARCHIVE_PACK_INDEXES) await db.collection(RECEIPT_ARCHIVE_PACKS_COLLECTION).createIndex(i.key, { name: i.name,
      ...("unique" in i ? { unique: true } : {}), ...("expireAfterSeconds" in i ? { expireAfterSeconds: i.expireAfterSeconds } : {}) });
    await db.collection(RECEIPT_RETIREMENT_CONTROL_COLLECTION).insertOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID as never, enabled_at: new Date(), cursor: null });
    const now = new Date(), hour = 3_600_000;
    const at = (hoursAgo: number) => new Date(+now - hoursAgo * hour);
    await db.collection("sales_intelligence_sync_state").insertOne({ scope: "webhook_receipts", cursor: { last_sync_to: at(30) } });
    const C = new ObjectId();
    await db.collection("call_interactions").insertOne({ _id: C, projection_revision: 3 });

    const dataset = { deployment: "rc-retire-replica", database };
    const receipt = (uuid: string, hoursAgo: number) => ({ _id: ObjectId.createFromTime(Math.floor(+at(hoursAgo) / 1000)), provider: "ringcentral", receivedAt: at(hoursAgo), uuid,
      telephonySessionId: `s-${uuid}`, rawBody: { uuid, body: { telephonySessionId: `s-${uuid}`, parties: [{ partyId: "p" }] } }, headers: {} });
    const job = (r: { _id: ObjectId; uuid: string }, revision: number, status = "completed") => {
      const input = { stage: "capture_projection", subject_key: `webhook_receipt:${r.uuid}`, input_revision: 1, input_refs: [String(r._id)] };
      return { _id: new ObjectId(), ...dataset, ...input, dedupe_key: `csi:capture_projection:receipt:${r.uuid}`, status, completed_at: at(40), lease_epoch: 1,
        reason: null, payload_hash: payloadHash({ ...dataset, ...input }),
        result: { receipt_id: String(r._id), receipt_uuid: r.uuid, sessions: 1, ok: 1, failed: 0, call_log_refresh: [],
          results: [{ telephony_session_id: `s-${r.uuid}`, ok: true, interaction_id: String(C), contact_number_id: null, projection_revision: revision,
            noop: false, created: false, newly_terminal: true, jobs: 0 }] } };
    };
    const proven = receipt("proven", 48), behind = receipt("behind", 47), pending = receipt("pending", 46);
    const watermarked = receipt("watermarked", 29.5), fresh = receipt("fresh", 2), sms = { ...receipt("sms", 49), telephonySessionId: undefined };
    await receiptsOf(db).insertMany([proven, behind, pending, watermarked, fresh, sms] as never[]);
    await db.collection("sales_intelligence_jobs").insertMany([job(proven, 3), job(behind, 4), job(pending, 3, "pending"), job(watermarked, 3), job(fresh, 3)]);
    const before = new Map((await receiptsOf(db).find({}, { raw: true }).toArray() as unknown as Buffer[]).map((raw) => [String(BSON.deserialize(raw)._id), Buffer.from(raw)]));
    const options = { prefix: CLOUD_STORAGE_NAMESPACES["ringcentral-webhook-receipts"].prefix, reuse: { mode: "refuse_released" as const },
      sealedNames: CLOUD_STORAGE_NAMESPACES["ringcentral-webhook-receipts"].sealedNames };

    // 1. Storage failure: nothing deleted, cursor unchanged, lease released.
    const broken = createFakeObjectStore(options).store;
    await assert.rejects(retireProvenReceipts(db, { now, store: { ...broken, put: async () => { throw new Error("gcs down"); } } }));
    assert.equal(await receiptsOf(db).countDocuments(), 6);
    const afterFailure = await db.collection(RECEIPT_RETIREMENT_CONTROL_COLLECTION).findOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID as never });
    assert.equal(afterFailure?.cursor, null); assert.equal(afterFailure?.lease_owner, null);

    // 2. A run reviews the three day-old receipts behind the watermark, archives all three and deletes only the proven one.
    const { store, bucket } = createFakeObjectStore(options);
    const run = await retireProvenReceipts(db, { now, store });
    assert.deepEqual([run.rows, run.retire, run.hold, run.deleted, run.packs], [3, 1, 2, 1, 1]);
    assert.deepEqual(run.held_reasons, { "capture_projection:effect_missing": 1, job_not_completed: 1 });
    const left = new Set((await receiptsOf(db).find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    assert.ok(!left.has(String(proven._id)), "the proven receipt left MongoDB");
    for (const r of [behind, pending, watermarked, fresh, sms]) assert.ok(left.has(String(r._id)), `${r.uuid} stays hot`);
    const [pack] = await db.collection(RECEIPT_ARCHIVE_PACKS_COLLECTION).find().toArray();
    assert.ok(pack && pack.rows === 3 && pack.retire === 1 && pack.hold === 2 && pack.expires_at > now);
    assert.ok((await bucket.stat(pack.name))?.customTime, "the pack's 90-day clock started at creation");

    // 3. The retired receipt restores byte for byte by original ID; a re-run reviews nothing new.
    const found = await lookupArchivedReceipt(db, String(proven._id), store);
    assert.ok(found && Buffer.from(BSON.serialize(found.doc)).equals(before.get(String(proven._id))!), "restored byte for byte");
    const again = await retireProvenReceipts(db, { now, store });
    assert.equal(again.rows, 0, "the cursor moved past every reviewed receipt");
    console.log(JSON.stringify({ ok: true, database, run, pack: { rows: pack.rows, size: pack.size } }));
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
