import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, BSON, ObjectId } from "mongodb";
import { computeChecksum } from "../durableWork/checksum";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import { digest } from "./archiveCodec";
import { checkClosedOperation, closedRuns, unpackClosedRun } from "./closedAutomationRun";
import { archiveDueScheduledRuns, archiveScheduledRun, readArchivedScheduledRun } from "./scheduledRunArchive";

test("scheduled archive preserves original BSON, exact replay and the deterministic schedule child across upload failure and retry", async t => {
  if (process.env.GRANOT_ARCHIVE_REPLICA_TESTS !== "true") return t.skip("opt-in isolated archive replica");
  const client = new MongoClient("mongodb://127.0.0.1:27964/?replicaSet=archiveSlim", { serverSelectionTimeoutMS: 3000 });
  const db = client.db("testvantagemovers_archive" + new ObjectId());
  try {
    const hello = await db.admin().command({ hello: 1 });
    assert.deepEqual(hello.hosts, ["127.0.0.1:27964"]);
    const runs = db.collection("granot_automation_runs"), receipts = db.collection("granot_webhook_receipts");
    await runs.createIndex({ archive_review_at: 1 }, { name: "granot_scheduled_archive_due", sparse: true });
    await receipts.createIndex({ observation_channel: 1, channel_operation_id: 1 }, { name: "granot_observation_receipt_channel_operation_id_unique", unique: true });
    const id = new ObjectId(), receipt = new ObjectId(), observation = new ObjectId(), decision = new ObjectId();
    const then = new Date(Date.now() - 2 * 86400000), now = new Date(), slot = "synthetic-exclusive-slot";
    const item = { operation_kind: "lead_snapshot_apply" as const, operation_id: String(id) + ":a", granot_statement: { priority: "2" } };
    const plan = { kind: "estimates_in_process", schema_version: 2, actions: [{ action_id: "a", classification: "update", lifecycle_apply: item }] };
    const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: plan });
    await runs.insertOne({ _id: id, workflow: "apply", operation: "estimates_in_process", status: "completed", createdAt: then, completed_at: then,
      expires_at: then, archive_review_at: then, purge_at: null, plan_locked_at: then, plan_checksum: checksum, plan_snapshot: plan,
      request_snapshot: { scheduled_slot_key: slot + ":child", scheduled_coverage: { slotKey: slot } },
      collection_summary: { held_rows: 0, coverage: { complete: true } },
      approval: { selected_action_ids: ["a"], plan_checksum: checksum },
      receipts: [{ action_id: "a", lifecycle_receipt_id: String(receipt), observation_id: String(observation), decision_id: String(decision), outcome: "stale", outreach_refresh_completed: true }] });
    await receipts.insertOne({ _id: receipt, observation_channel: "granot_http_automation", channel_operation_kind: item.operation_kind,
      channel_operation_id: item.operation_id, payload_sha256: hashCredentialRedactedPayload(item).payload_sha256,
      processing: { state: "completed", completed_at: then, latest_decision_id: decision } });
    await db.collection("granot_observations").insertOne({ _id: observation, receipt_id: receipt });
    await db.collection("synchronization_decisions").insertOne({ _id: decision, observation_id: observation, outcome: "stale",
      target: { model: "FormLead", id: String(new ObjectId()) }, effects: [], decided_at: then });
    const objects = new Map<string, Buffer>();
    const store = async (_db: string, bytes: Buffer) => {
      const hash = digest(bytes);
      objects.set(hash, bytes);
      return { hash, generation: "1", persisted: Buffer.from(bytes) };
    };
    assert.equal(await archiveScheduledRun(db, id, new Date(+then - 1), store), "not_eligible");
    await runs.updateOne({ _id: id }, { $set: { "receipts.0.outreach_refresh_completed": false } });
    assert.equal(await archiveScheduledRun(db, id, now, store), "incomplete_evidence");
    await runs.updateOne({ _id: id }, { $set: { "receipts.0.outreach_refresh_completed": true } });
    const before = await runs.findOne({ _id: id }, { raw: true });
    assert.ok(Buffer.isBuffer(before));
    await assert.rejects(archiveScheduledRun(db, id, now, async (_db, bytes) => {
      if (objects.size) throw new Error("simulated storage outage");
      return store(_db, bytes);
    }), /storage outage/);
    assert.equal(await closedRuns(db).countDocuments({}), 0);
    assert.equal((await runs.findOne({ _id: id }))?.plan_checksum, checksum);
    assert.deepEqual(await archiveDueScheduledRuns(db, now, store), { examined: 1, archived: 1, held: 0, failures: 0, oldest_due_at: then });
    const stub = await runs.findOne({ _id: id }), index = await closedRuns(db).findOne({ _id: String(id) });
    assert.ok(index);
    assert.equal(stub?.plan_snapshot, undefined);
    assert.deepEqual(stub?.receipts, []);
    assert.equal(stub?.archive_summary.unapplied_actions, 1);
    assert.equal(stub?.collection_summary.coverage.complete, true);
    const duplicate = await runs.updateOne({ _id: id }, { $setOnInsert: { status: "queued" } }, { upsert: true });
    assert.equal(duplicate.upsertedCount, 0);
    assert.equal((await runs.findOne({ _id: id }))?.status, "completed");
    const read = async (_db: string, hash: string, generation?: string) => {
      assert.equal(generation, "1"); return Buffer.from(objects.get(hash)!);
    };
    assert.deepEqual(await readArchivedScheduledRun(db, String(id), read), before);
    await assert.rejects(readArchivedScheduledRun(db, String(id), async () => Buffer.alloc(1)), /checksum/);
    const rows = unpackClosedRun(index, await read(db.databaseName, index.hash, index.generation));
    assert.equal(checkClosedOperation(rows, item).result.decision_id, String(decision));
    assert.throws(() => checkClosedOperation(rows, { ...item, granot_statement: { priority: "3" } }));
    assert.equal(BSON.deserialize(before).receipts.length, 1);
    const failedId = new ObjectId();
    await runs.insertOne({ _id: failedId, status: "failed", archive_review_at: then, purge_at: null, last_error: { code: "synthetic" } });
    const failed = await archiveDueScheduledRuns(db, now, store);
    assert.equal(failed.held, 1);
    const held = await runs.findOne({ _id: failedId });
    assert.equal(held?.archive_review.reason, "actionable_run");
    assert.equal(held?.archive_review.status, "failed");
    assert.equal(held?.purge_at, null);
    assert.ok(held?.archive_review_at > now);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
