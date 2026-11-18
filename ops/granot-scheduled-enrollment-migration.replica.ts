import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import { migrateScheduledEnrollment } from "./granot-scheduled-enrollment-migration";
import { GRANOT_ESTIMATES_CRON_ACTOR_ID } from "../src/services/domainCommands/types";

test("legacy enrollment resumes by hash ID, preserves live deadlines and catches an overlapping legacy insert behind the cursor", async t => {
  if (process.env.GRANOT_ARCHIVE_REPLICA_TESTS !== "true") return t.skip("opt-in isolated archive replica");
  const client = new MongoClient("mongodb://127.0.0.1:27964/?replicaSet=archiveSlim", { serverSelectionTimeoutMS: 3000 });
  const db = client.db("testvantagemovers_archive" + new ObjectId());
  try {
    assert.deepEqual((await db.admin().command({ hello: 1 })).hosts, ["127.0.0.1:27964"]);
    const runs = db.collection("granot_automation_runs"), cutoff = new Date(), expiry = new Date(+cutoff + 86400000);
    const legacy = { createdAt: cutoff, expires_at: expiry, purge_at: new Date(+expiry + 6 * 86400000),
      operation: "estimates_in_process", workflow: "apply", initiator: { actor_type: "system", actor_id: GRANOT_ESTIMATES_CRON_ACTOR_ID },
      request_snapshot: { auto_apply: true, scheduled_slot_key: "synthetic-child" } };
    await runs.createIndex({ archive_review_at: 1 }, { sparse: true, name: "granot_scheduled_archive_due" });
    const original = await runs.insertMany([{ ...legacy, status: "queued" }, { ...legacy, status: "failed" }, { ...legacy, status: "completed",
      initiator: { actor_type: "owner", actor_id: "manual" } }]);
    const start = await migrateScheduledEnrollment(db, cutoff, 1, 1, cutoff);
    assert.equal(start?.stage, "initial"); assert.equal(start?.enrolled, 1);
    await runs.updateOne({ _id: original.insertedIds[0] }, { $set: { status: "completed" } });
    const first = await migrateScheduledEnrollment(db, cutoff, 8, 1, cutoff);
    assert.equal(first?.stage, "awaiting_final_pass"); assert.equal(first?.enrolled, 2);
    assert.deepEqual(await migrateScheduledEnrollment(db, cutoff, 8, 1, cutoff), first);
    const overlap = await runs.insertOne({ ...legacy, _id: new ObjectId("000000000000000000000001"), createdAt: new Date(+cutoff + 12), status: "queued" });
    const late = await runs.insertOne({ ...legacy, createdAt: new Date(+cutoff + 800001), status: "queued" });
    const after = new Date(+cutoff + 800003);
    const complete = await migrateScheduledEnrollment(db, cutoff, 8, 1, after);
    assert.equal(complete?.stage, "complete"); assert.equal(complete?.enrolled, 3);
    assert.deepEqual(await migrateScheduledEnrollment(db, cutoff, 8, 1, after), complete);
    for (const _id of [original.insertedIds[0], original.insertedIds[1], overlap.insertedId]) {
      const run = await runs.findOne({ _id }); assert.ok(run);
      assert.equal(+run.expires_at, +expiry); assert.equal(+run.archive_review_at, +expiry); assert.equal(run.purge_at, null);
    }
    for (const _id of [original.insertedIds[2], late.insertedId]) assert.ok((await runs.findOne({ _id }))?.purge_at instanceof Date);
    await assert.rejects(migrateScheduledEnrollment(db, new Date(+cutoff - 1), 1, 1, after), /another cutover/);
  } finally { await db.dropDatabase(); await client.close(); }
});
