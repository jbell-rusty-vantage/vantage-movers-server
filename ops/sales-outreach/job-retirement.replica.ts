/**
 * Validated retirement, end to end on the local replica (csi01, loopback only) with a fake bucket.
 *   node --import tsx ops/sales-outreach/job-retirement.replica.ts
 * Proves: with the switch on, a real completion keeps its full row; a storage failure changes nothing; a run archives
 * every row, compacts only proven routine jobs, leaves held and ordinary rows untouched, restores a retired job byte for
 * byte by original ID, and a re-run does nothing. Synthetic rows in a unique database that is dropped at the end.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { BSON, ObjectId } from "mongodb";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_retire${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.job-retirement-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "retire-replica";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { enqueueCsiJob, claimCsiJob, completeCsiJob } = await import("../../src/services/salesIntelligence/jobs.js");
  const { withTransaction } = await import("../../src/db.js");
  const { payloadHash } = await import("../../src/services/salesIntelligence/transactions.js");
  const { CLOUD_STORAGE_NAMESPACES, createFakeObjectStore } = await import("../../src/services/cloudStorage/index.js");
  const { RETIREMENT_CONTROL_COLLECTION, RETIREMENT_CONTROL_ID, resetJobRetirementCache } = await import("../../src/services/salesIntelligence/retirement/control.js");
  const { ARCHIVE_PACKS_COLLECTION, ARCHIVE_PACK_INDEXES, retireCompletedJobs, lookupArchivedJob } = await import("../../src/services/salesIntelligence/retirement/worker.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  const db = mongoose.connection.db!;
  try {
    const Model = getSalesIntelligenceJobModel();
    await Model.createCollection(); await Model.createIndexes();
    for (const i of ARCHIVE_PACK_INDEXES) await db.collection(ARCHIVE_PACKS_COLLECTION).createIndex(i.key, { name: i.name,
      ...("unique" in i ? { unique: true } : {}), ...("expireAfterSeconds" in i ? { expireAfterSeconds: i.expireAfterSeconds } : {}) });
    await db.collection(RETIREMENT_CONTROL_COLLECTION).insertOne({ _id: RETIREMENT_CONTROL_ID as never, enabled_at: new Date(Date.now() - 3_600_000), cursor: null });
    resetJobRetirementCache();
    const S = new ObjectId().toHexString(), T = new ObjectId().toHexString(), C = new ObjectId(), R = new ObjectId().toHexString();
    await db.collection("sales_outreach_projections").insertMany([
      { subject_id: new ObjectId(S), publication_revision: 5 }, { subject_id: new ObjectId(T), publication_revision: 1 }]);
    await db.collection("call_interactions").insertOne({ _id: C, projection_revision: 3 });

    // 1. Switch on: a real completion keeps its full row (no receipt, no purge instant).
    const due = { stage: "outreach_evaluate" as const, dedupe_key: `sod:evaluate:${S}:due:1763600400000`, subject_key: `outreach-subject:${S}`, input_revision: 1, input_refs: [S] };
    await withTransaction((session) => enqueueCsiJob(due, session, new Date(Date.now() - 1000)));
    const claimed = (await claimCsiJob("replica", undefined, 60_000, "outreach_evaluate"))!;
    await completeCsiJob({ job_id: String(claimed._id), owner: "replica", epoch: claimed.lease_epoch }, async () => null,
      { result: { outcome: "updated", subject_id: S, publication_revision: 5, next_evaluation_at: null } });
    const full = await db.collection("sales_intelligence_jobs").findOne({ _id: claimed._id });
    assert.ok(full && full.result && !full.record_kind && !full.routine_purge_at, "switch on: completion keeps the full row");

    // 2. More completed rows: a clean capture (effect present), an evaluation whose effect is missing, a non-routine key.
    const dataset = { deployment: "retire-replica", database };
    const completed = new Date(Date.now() - 60_000);
    const row = (stage: string, dedupe_key: string, subject_key: string, ref: string, result: unknown) => {
      const input = { stage, subject_key, input_revision: 1, input_refs: [new ObjectId(ref)] };
      return { _id: new ObjectId(), ...dataset, ...input, dedupe_key, result, status: "completed", completed_at: completed, attempts: 1, max_attempts: 8,
        lease_epoch: 1, reason: null, createdAt: completed, updatedAt: completed, payload_hash: payloadHash({ ...dataset, stage, subject_key, input_revision: 1, input_refs: [ref] }) };
    };
    const capture = row("capture_projection", `csi:capture_projection:receipt_id:${R}`, `webhook_receipt:${R}`, R, { receipt_id: R, receipt_uuid: null, sessions: 1, ok: 1, failed: 0,
      call_log_refresh: [], results: [{ telephony_session_id: "s", ok: true, interaction_id: String(C), contact_number_id: null, projection_revision: 3, noop: false, created: false, newly_terminal: true, jobs: 0 }] });
    const missing = row("outreach_evaluate", `sod:evaluate:${T}:due:1763600400000`, `outreach-subject:${T}`, T, { outcome: "updated", subject_id: T, publication_revision: 5, next_evaluation_at: null });
    const ordinary = row("outreach_evaluate", `sod:evaluate:${S}:policy:0123456789abcdef`, `outreach-subject:${S}`, S, { outcome: "unchanged", subject_id: S, publication_revision: 5, next_evaluation_at: null });
    await db.collection("sales_intelligence_jobs").insertMany([capture, missing, ordinary]);
    const before = new Map((await db.collection("sales_intelligence_jobs").find({}, { raw: true }).toArray() as unknown as Buffer[])
      .map((raw) => [String(BSON.deserialize(raw)._id), Buffer.from(raw)]));
    const later = new Date(Date.now() + 6 * 60_000);
    const options = { prefix: "history/sales-intelligence/v2/", reuse: { mode: "refuse_released" as const }, sealedNames: CLOUD_STORAGE_NAMESPACES["sales-intelligence-retirement"].sealedNames };

    // 3. Storage failure: nothing compacted, cursor unchanged, lease released.
    const broken = createFakeObjectStore(options).store;
    await assert.rejects(retireCompletedJobs(db, { now: later, store: { ...broken, put: async () => { throw new Error("gcs down"); } } }));
    assert.equal(await db.collection("sales_intelligence_jobs").countDocuments({ record_kind: "completion_receipt" }), 0);
    const afterFailure = await db.collection(RETIREMENT_CONTROL_COLLECTION).findOne({ _id: RETIREMENT_CONTROL_ID as never });
    assert.equal(afterFailure?.cursor, null); assert.equal(afterFailure?.lease_owner, null);

    // 4. A run archives all four, compacts the two proven routine jobs, and leaves the held and ordinary rows untouched.
    const { store, bucket } = createFakeObjectStore(options);
    const run = await retireCompletedJobs(db, { now: later, store });
    assert.deepEqual([run.rows, run.retire, run.hold, run.keep, run.compacted, run.packs], [4, 2, 1, 1, 2, 1]);
    assert.deepEqual(run.held_reasons, { "outreach_evaluate:effect_missing": 1 });
    const after = new Map((await db.collection("sales_intelligence_jobs").find({}).toArray()).map((d) => [String(d._id), d]));
    for (const id of [String(claimed._id), String(capture._id)]) {
      const d = after.get(id)!;
      assert.ok(d.record_kind === "completion_receipt" && d.result === undefined && d.routine_purge_at instanceof Date && d.dedupe_key, `${id} compacted with its dedupe key`);
    }
    assert.equal(+after.get(String(capture._id))!.routine_purge_at - +completed, 7 * 86_400_000, "a capture keeps the receipt TTL");
    for (const id of [String(missing._id), String(ordinary._id)])
      assert.ok(Buffer.from(BSON.serialize(after.get(id)!)).equals(before.get(id)!), `${id} untouched`);
    const [pack] = await db.collection(ARCHIVE_PACKS_COLLECTION).find().toArray();
    assert.ok(pack && pack.rows === 4 && pack.retire === 2 && pack.hold === 1 && pack.keep === 1 && pack.expires_at > later);
    const object = await bucket.stat(pack.name);
    assert.ok(object?.customTime, "the pack's 90-day clock started at creation");

    // 5. A retired job restores from GCS byte for byte by original ID; a re-run finds nothing.
    for (const id of [String(claimed._id), String(capture._id)]) {
      const found = await lookupArchivedJob(db, id, store);
      assert.ok(found && Buffer.from(BSON.serialize(found.doc)).equals(before.get(id)!), `${id} restored byte for byte`);
    }
    const again = await retireCompletedJobs(db, { now: later, store });
    assert.equal(again.rows, 0, "the cursor moved past every archived row");

    // 6. More rows share one completion instant than fit a batch: the group is walked by _id, nothing skipped or split.
    const instant = new Date(Date.now() + 1000); // after the cursor, still settled for `later`
    const tied = [0, 1, 2].map((n) => ({ ...row("outreach_evaluate", `sod:evaluate:${S}:due:${1763600400000 + n + 1}`, `outreach-subject:${S}`, S,
      { outcome: "unchanged", subject_id: S, publication_revision: 5, next_evaluation_at: null }), completed_at: instant }));
    await db.collection("sales_intelligence_jobs").insertMany(tied);
    const grouped = await retireCompletedJobs(db, { now: later, store, batchSize: 2, maxBatches: 10 });
    assert.equal(grouped.compacted, 3, "every tied row retired across batches");
    assert.equal(await db.collection("sales_intelligence_jobs").countDocuments({ _id: { $in: tied.map((t) => t._id) }, record_kind: "completion_receipt" }), 3);
    console.log(JSON.stringify({ ok: true, database, run, pack: { rows: pack.rows, size: pack.size } }));
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
