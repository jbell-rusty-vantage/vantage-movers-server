/** Local replica only. Synthetic rows in a unique database; never loads production env. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mongoose from "mongoose";
import { BSON } from "mongodb";
import { csiEnqueueReplicaTarget } from "./lib/csi-enqueue-replica-target";

const database = `testvantagemovers_enqueue${randomUUID().replaceAll("-", "")}`;
// Do not inherit a configurable target: this harness creates indexes and drops its test database.
// Provider credentials are dropped and dotenv points at a file that does not exist, so no `import "dotenv/config"`
// reached through `src/` can load the production `.env` (dotenv only fills unset keys, so it would add secrets).
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.csi-enqueue-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "enqueue-replica";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo, withTransaction } = await import("../src/db.js");
  const { getSalesIntelligenceJobModel } = await import("../src/models/SalesIntelligenceJob.js");
  const { enqueueCsiJob, claimCsiJob, renewCsiJob, completeCsiJob, failCsiJob, continueCsiJob } = await import("../src/services/salesIntelligence/jobs.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  const Model = getSalesIntelligenceJobModel();
  await Model.createCollection(); await Model.createIndexes();
  const input = { dedupe_key: "test:insert", stage: "lead_link" as const, subject_key: "test:subject", input_revision: 1 };
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
  await proveRetiredStageFence(Model, withTransaction);
  console.log("PASS: insert timestamps, byte-stable pending/leased/completed duplicates, payload conflicts, transaction requirement, concurrent inserts, dataset fences, claims, renewal, retry, continuation, completion, lease rejection, unchanged TTL and the retired-stage fence");
}
/**
 * Slimming SPEC §7.4: rows of retired stages written by an earlier release (pending, retry, paused and a
 * lease an old deployment still holds) are terminalized as `retired`; terminal rows are untouched; nothing
 * claims them; the old holder's completion loses its lease and its effect rolls back; a late queue wake-up
 * is acknowledged without a handler; enqueue refuses the stage; no collection appears.
 */
async function proveRetiredStageFence(
  Model: Awaited<typeof import("../src/models/SalesIntelligenceJob.js")>["getSalesIntelligenceJobModel"] extends () => infer M ? M : never,
  withTransaction: Awaited<typeof import("../src/db.js")>["withTransaction"],
) {
  const { enqueueCsiJob, claimCsiJob, completeCsiJob, retireLegacyCsiJobs } = await import("../src/services/salesIntelligence/jobs.js");
  const { dispatchCsiWakeup } = await import("../src/services/numberActivity/jobDispatch.js");
  const collections = async () => (await mongoose.connection.db!.listCollections().toArray()).map(c => c.name).sort();
  // Importing the dispatcher registers retained models whose `autoCreate` runs in the background; settle every
  // registered model first, so the snapshot below cannot race a retained collection's creation.
  // allSettled: a pre-existing invalid Agent index spec (unique+sparse+partialFilterExpression) rejects its init.
  await Promise.allSettled(mongoose.modelNames().map(name => mongoose.model(name).init()));
  const before = await collections();
  const now = new Date();
  // Start from a clean retained queue: main() leaves runnable retained rows (e.g. the `test:concurrent`
  // lead_link job), which an undirected claim below would rightly lease.
  await Model.collection.updateMany(
    { status: { $in: ["pending", "leased", "retry", "paused"] } },
    { $set: { status: "completed", completed_at: now, lease_owner: null, leased_until: null } },
  );
  const row = (stage: string, status: string, extra: Record<string, unknown> = {}) => ({
    _id: new mongoose.Types.ObjectId(), dedupe_key: `legacy:${stage}:${status}:${randomUUID()}`, payload_hash: "legacy", stage,
    subject_key: "number:legacy", input_revision: 1, deployment: "enqueue-replica", database, status, attempts: 1, max_attempts: 8,
    priority: 0, next_attempt_at: new Date(now.getTime() - 60_000), lease_owner: null, lease_epoch: 3, leased_until: null, reason: null,
    result: null, completed_at: null, input_refs: [], createdAt: now, updatedAt: now, ...extra,
  });
  const pending = row("analysis", "pending"), retry = row("transcription", "retry"), paused = row("media_fetch", "paused");
  const leased = row("outreach_ensure", "leased", { lease_owner: "old-deployment", leased_until: new Date(now.getTime() + 300_000) });
  const dead = row("move_assessment", "dead_letter"), done = row("application", "completed", { completed_at: now });
  await Model.collection.insertMany([pending, retry, paused, leased, dead, done]);
  // Nothing claims a retired row, even by id and even once its lease would have expired.
  for (const target of [pending, retry]) assert.equal(await claimCsiJob("retained-worker", String(target._id)), null);
  assert.equal(await claimCsiJob("retained-worker"), null, "an undirected claim takes no retired row");
  // A late queue wake-up for a pending retired row: acknowledged and terminalized, no handler.
  let handled = 0;
  const wake = await dispatchCsiWakeup({ job_id: String(pending._id) }, { handlers: { lead_link: async () => { handled++; } } });
  assert.deepEqual(wake, { status: "retired", job_id: String(pending._id), stage: "analysis", retired: 1 });
  assert.equal(handled, 0);
  const swept = await retireLegacyCsiJobs({ now });
  assert.equal(swept.retired, 3);
  assert.deepEqual(swept.stages, { transcription: 1, media_fetch: 1, outreach_ensure: 1 });
  for (const target of [pending, retry, paused, leased]) {
    const stored = await Model.collection.findOne({ _id: target._id });
    assert.equal(stored?.status, "retired"); assert.equal(stored?.reason, "stage_retired");
    assert.equal(stored?.lease_owner, null); assert.equal(stored?.leased_until, null);
    assert.equal(stored?.completed_at ?? null, null, "no completed_at: the TTL never removes a fenced row before the purge backs it up");
    assert.equal(stored?.lease_epoch, 4, "the epoch moved, so an old lease can never write again");
  }
  assert.equal((await Model.collection.findOne({ _id: dead._id }))?.status, "dead_letter", "terminal rows are untouched");
  assert.equal((await Model.collection.findOne({ _id: done._id }))?.status, "completed");
  // The old deployment's completion with the epoch it claimed loses the lease; its effect rolls back.
  let effect = false;
  await assert.rejects(completeCsiJob({ job_id: String(leased._id), owner: "old-deployment", epoch: 3 }, async () => { effect = true; }), /LEASE_LOST/);
  assert.equal(effect, false, "the fence is read before the mutation runs");
  assert.equal((await retireLegacyCsiJobs()).retired, 0, "idempotent");
  await assert.rejects(withTransaction(session => enqueueCsiJob({ dedupe_key: "legacy:new", stage: "analysis" as never, subject_key: "number:legacy", input_revision: 1 }, session)), /INVALID_INPUT/);
  assert.equal(await Model.collection.countDocuments({ dedupe_key: "legacy:new" }), 0);
  assert.deepEqual(await collections(), before, "no collection was created");
  const retired = (await collections()).filter(name => RETIRED_COLLECTION.test(name));
  assert.deepEqual(retired, [], "no retired collection exists in the proof database");
}
/** Every collection the slimming retires (SPEC §4, §6, §7.2), with the test-mode `test_` aliases. */
const RETIRED_COLLECTION = /^(test_)?(lead_conversations|intelligence_[a-z_]+|move_assessment_artifacts|sales_intelligence_ai_(budget|reservations)|sales_intelligence_attention_[a-z_]+|outreach_(records|followups|band_transitions|rep_days)|operational_(events|incidents|report_runs)|notification_deliveries|admin_audit_logs)$/;

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  // Settle background model init first, or a late autoCreate/autoIndex recreates collections after the drop.
  await Promise.allSettled(mongoose.modelNames().map(name => mongoose.model(name).init()));
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
