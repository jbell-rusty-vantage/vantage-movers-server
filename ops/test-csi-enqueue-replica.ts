/** Local replica only. Synthetic rows in a unique database; never loads production env. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mongoose from "mongoose";
import { BSON } from "mongodb";
import { csiEnqueueReplicaTarget } from "./lib/csi-enqueue-replica-target";

const database = `testvantagemovers_enqueue${randomUUID().replaceAll("-", "")}`;
// Do not inherit a configurable target: this harness creates indexes and drops its test database.
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "enqueue-replica";
process.env.OBSERVABILITY_ENABLED = "false";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo, withTransaction } = await import("../src/db.js");
  const { getSalesIntelligenceJobModel } = await import("../src/models/SalesIntelligenceJob.js");
  const { enqueueCsiJob, claimCsiJob, renewCsiJob, completeCsiJob, failCsiJob, continueCsiJob } = await import("../src/services/salesIntelligence/jobs.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  const Model = getSalesIntelligenceJobModel();
  await Model.createCollection(); await Model.createIndexes();
  const input = { dedupe_key: "test:insert", stage: "outreach_ensure" as const, subject_key: "test:subject", input_revision: 1 };
  const now = new Date(Date.now() - 60_000);
  const first = await withTransaction(session => enqueueCsiJob(input, session, now));
  assert.equal(+first.createdAt, +now); assert.equal(+first.updatedAt, +now);
  const bytes = async () => BSON.serialize((await Model.collection.findOne({ _id: first._id }))!);
  const original = await bytes();
  const duplicate = await withTransaction(session => enqueueCsiJob({ ...input, priority: 99 }, session, new Date()));
  assert.equal(String(duplicate._id), String(first._id)); assert.equal(duplicate.priority, first.priority);
  assert.deepEqual(await bytes(), original);
  await assert.rejects(withTransaction(session => enqueueCsiJob({ ...input, input_revision: 2 }, session)), /IDEMPOTENCY_CONFLICT/);
  assert.deepEqual(await bytes(), original);
  const session = await mongoose.startSession();
  try { await assert.rejects(enqueueCsiJob(input, session), /INVALID_INPUT/); } finally { await session.endSession(); }
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => withTransaction(s => enqueueCsiJob({ ...input, dedupe_key: "test:concurrent" }, s, now))));
  assert.equal(new Set(concurrent.map(j => String(j._id))).size, 1);
  assert.equal(await Model.countDocuments({ dedupe_key: "test:concurrent" }), 1);
  await Model.collection.updateOne({ _id: first._id }, { $set: { deployment: "other" } });
  await assert.rejects(withTransaction(s => enqueueCsiJob(input, s)), /IDEMPOTENCY_CONFLICT/);
  assert.equal(await claimCsiJob("worker", String(first._id)), null);
  await Model.collection.updateOne({ _id: first._id }, { $set: { deployment: "enqueue-replica", database: "other" } });
  await assert.rejects(withTransaction(s => enqueueCsiJob(input, s)), /IDEMPOTENCY_CONFLICT/);
  assert.equal(await claimCsiJob("worker", String(first._id)), null);
  await Model.collection.updateOne({ _id: first._id }, { $set: { database } });
  let claimed = await claimCsiJob("worker", String(first._id)); assert.ok(claimed);
  assert.equal(claimed.attempts, 1); assert.ok(+claimed.updatedAt > +now);
  let lease = { job_id: String(first._id), owner: "worker", epoch: claimed.lease_epoch };
  const held = await bytes();
  await withTransaction(s => enqueueCsiJob(input, s)); assert.deepEqual(await bytes(), held);
  await delay(10); await renewCsiJob(lease, 600_000);
  const renewed = await Model.findById(first._id); assert.ok(renewed); assert.ok(+renewed.updatedAt > +claimed.updatedAt);
  await assert.rejects(renewCsiJob({ ...lease, epoch: lease.epoch + 1 }), /LEASE_LOST/);
  await delay(10); await failCsiJob(lease, "transient");
  const retry = await Model.findById(first._id); assert.ok(retry); assert.equal(retry.status, "retry"); assert.equal(retry.attempts, 1); assert.ok(+retry.updatedAt > +renewed.updatedAt);
  assert.equal(await claimCsiJob("worker", String(first._id)), null);
  await Model.collection.updateOne({ _id: first._id }, { $set: { next_attempt_at: now } });
  claimed = await claimCsiJob("worker", String(first._id)); assert.ok(claimed); assert.equal(claimed.attempts, 2);
  lease = { ...lease, epoch: claimed.lease_epoch };
  await delay(10);
  assert.equal(await continueCsiJob(lease, async () => "progress"), "progress");
  const continued = await Model.findById(first._id); assert.ok(continued); assert.equal(continued.attempts, 1); assert.equal(continued.status, "pending"); assert.ok(+continued.updatedAt > +claimed.updatedAt);
  claimed = await claimCsiJob("worker", String(first._id)); assert.ok(claimed);
  lease = { ...lease, epoch: claimed.lease_epoch };
  await delay(10); assert.equal(await completeCsiJob(lease, async () => "result", { result: { ok: true } }), "result");
  const completed = await Model.findById(first._id); assert.ok(completed); assert.equal(completed.status, "completed"); assert.ok(completed.completed_at); assert.ok(+completed.updatedAt > +claimed.updatedAt);
  const completeBytes = await bytes(); await withTransaction(s => enqueueCsiJob(input, s)); assert.deepEqual(await bytes(), completeBytes);
  assert.equal(await claimCsiJob("worker", String(first._id)), null);
  assert.equal((await Model.collection.indexes()).find(i => i.name === "csi_job_completed_ttl")?.expireAfterSeconds, 14 * 86400);
  console.log("PASS: insert timestamps, byte-stable pending/leased/completed duplicates, payload conflicts, transaction requirement, concurrent inserts, dataset fences, claims, renewal, retry, continuation, completion, lease rejection and unchanged TTL");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
