import assert from "node:assert/strict";
import test from "node:test";
import { BSON, ObjectId } from "mongodb";
import { historyReplica } from "./archiveTestSupport";
import { computeChecksum } from "../durableWork/checksum";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import { digest } from "./archiveCodec";
import { loadClosedOperations } from "./prepareClosedRun";
import { checkClosedOperation, closedRuns, readClosedRun } from "./closedAutomationRun";
import { archiveDueScheduledRuns, archiveScheduledRun, readArchivedScheduledRun } from "./scheduledRunArchive";

test("scheduled archive preserves historical replay and original BSON across upload failure and concurrent retry", async t => {
  const replica = await historyReplica(t, "archive");
  if (!replica) return;
  const { client, db } = replica;
  try {
    const runs = db.collection("granot_automation_runs"), receipts = db.collection("granot_webhook_receipts");
    await runs.createIndex({ archive_review_at: 1 }, { name: "granot_scheduled_archive_due", sparse: true });
    await receipts.createIndex({ observation_channel: 1, channel_operation_id: 1 }, { name: "granot_observation_receipt_channel_operation_id_unique", unique: true });
    const id = new ObjectId(), receipt = new ObjectId(), observation = new ObjectId(), decision = new ObjectId();
    const then = new Date(Date.now() - 2 * 86400000), now = new Date(), slot = "synthetic-exclusive-slot";
    const item = { operation_kind: "lead_snapshot_apply" as const, operation_id: String(id) + ":a", granot_statement: { priority: "2" } };
    const plan = { kind: "estimates_in_process", schema_version: 2, actions: [{ action_id: "a", classification: "update", lifecycle_apply: item }] };
    const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: plan });
    await runs.insertOne({ _id: id, workflow: "apply", operation: "estimates_in_process", status: "completed", createdAt: then, completed_at: then,
      expires_at: new Date(+now+86400000), archive_review_at: then, purge_at: null, plan_locked_at: then, plan_checksum: checksum, plan_snapshot: plan,
      request_snapshot: { scheduled_slot_key: slot + ":child", scheduled_coverage: { slotKey: slot } },
      collection_summary: { held_rows: 0, coverage: { complete: true } },
      approval: { selected_action_ids: ["a"], plan_checksum: checksum },
      receipts: [{ action_id: "a", lifecycle_receipt_id: String(receipt), observation_id: String(observation), decision_id: String(decision), outcome: "applied", outreach_refresh_completed: true }] });
    const target = { model: "FormLead", id: String(new ObjectId()) };
    const effect = { kind: "sheet_sync_requested", ref: null };
    const cached = { decision_id: String(decision), observation_id: String(observation), outcome: "applied", effects: [effect], target };
    await receipts.insertOne({ _id: receipt, observation_channel: "granot_http_automation", channel_operation_kind: item.operation_kind,
      channel_operation_id: item.operation_id, payload_sha256: hashCredentialRedactedPayload(item).payload_sha256,
      processing: { state: "completed", completed_at: then, latest_decision_id: decision, replay_result: cached } });
    await db.collection("granot_observations").insertOne({ _id: observation, receipt_id: receipt });
    const decisions = db.collection("synchronization_decisions");
    await decisions.insertOne({ _id: decision, observation_id: observation, outcome: "applied", target, effects: [{ kind: effect.kind }], decided_at: then });
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
    for (const effects of [[], [{ kind: "different_effect" }], [{ ...effect, ref: "different_ref" }]]) {
      await decisions.updateOne({ _id: decision }, { $set: { effects } });
      assert.equal(await archiveScheduledRun(db, id, now, store), "incomplete_evidence");
    }
    await decisions.updateOne({ _id: decision }, { $set: { effects: [effect] } });
    await receipts.updateOne({ _id: receipt }, { $unset: { "processing.replay_result.effects.0.ref": "" } });
    assert.equal(await archiveScheduledRun(db, id, now, store), "incomplete_evidence");
    await receipts.updateOne({ _id: receipt }, { $set: { "processing.replay_result": cached } });
    await decisions.updateOne({ _id: decision }, { $set: { effects: [{ kind: effect.kind }], "target.id": String(new ObjectId()) } });
    assert.equal(await archiveScheduledRun(db, id, now, store), "incomplete_evidence");
    await decisions.updateOne({ _id: decision }, { $set: { target } });
    // A missing historical Decision requires an independently attributable link.
    const linkId = new ObjectId();
    const linked = { ...cached, outcome: "linked", effects: [{ kind: "record_link_established",
      ref: { model: "GranotRecordLink", id: String(linkId) }, changed_paths: [] }] };

    const review = () => loadClosedOperations(db, String(id), now, { allowScheduledReplay: true });
    await decisions.deleteOne({ _id: decision });
    await receipts.updateOne({ _id: receipt }, { $set: { "processing.replay_result": linked } });
    assert.equal((await review()).reason, "incomplete_evidence");
    await db.collection("granot_observations").updateOne({ _id: observation }, { $set: { "identity.normalized_job_no": "TEST" } });
    await db.collection("form_leads").insertOne({ _id: new ObjectId(target.id) });
    await db.collection("granot_record_links").insertOne({ _id: linkId, provider: "granot", normalized_job_no: "TEST",
      established_by_decision_id: decision, lead_ref: { model: target.model, id: new ObjectId(target.id) } });
    assert.equal((await review()).reason, "ready");
    await receipts.updateOne({ _id: receipt }, { $set: { "processing.replay_result.effects.0.ref.id": String(new ObjectId()) } });
    assert.equal((await review()).reason, "incomplete_evidence");
    await receipts.updateOne({ _id: receipt }, { $set: { "processing.replay_result": cached } });
    await decisions.insertOne({ _id: decision, observation_id: observation, outcome: "applied", target, effects: [{ kind: effect.kind }], decided_at: then });
    const before = await runs.findOne({ _id: id }, { raw: true });
    assert.ok(Buffer.isBuffer(before));
    await assert.rejects(archiveScheduledRun(db, id, now, async (_db, bytes) => {
      if (objects.size) throw new Error("simulated storage outage");
      return store(_db, bytes);
    }), /storage outage/);
    assert.equal(await closedRuns(db).countDocuments({}), 0);
    assert.equal((await runs.findOne({ _id: id }))?.plan_checksum, checksum);
    assert.equal(objects.size, 1);
    let releaseUploads!: () => void;
    const bothReviewed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Both archive workers must reach upload")), 5000);
      releaseUploads = () => { clearTimeout(timeout); resolve(); };
    });
    let uploads = 0;
    const concurrentStore = async (database: string, bytes: Buffer) => {
      if (++uploads === 2) releaseUploads();
      await bothReviewed;
      return store(database, bytes);
    };
    const outcomes = await Promise.all([
      archiveScheduledRun(db, id, now, concurrentStore),
      archiveScheduledRun(db, id, now, concurrentStore),
    ]);
    assert.deepEqual(outcomes.sort(), ["archived", "source_changed"]);
    assert.equal(await closedRuns(db).countDocuments({}), 1);
    assert.equal(await archiveScheduledRun(db, id, now, store), "not_eligible");
    assert.equal(await runs.countDocuments({_id:id}),0);
    const stub = await db.collection("granot_completed_estimate_windows").findOne({ _id: id }), index = await closedRuns(db).findOne({ _id: String(id) });
    assert.ok(index);
    assert.equal(stub?.plan_snapshot, undefined);
    assert.equal(stub?.receipts,undefined);
    assert.equal(stub?.archive_summary.unapplied_actions, 0);
    assert.equal(stub?.collection_summary.coverage.complete, true);
    const read = async (_db: string, hash: string, generation?: string) => {
      assert.equal(generation, "1"); return Buffer.from(objects.get(hash)!);
    };
    assert.deepEqual(await readArchivedScheduledRun(db, String(id), read), before);
    await assert.rejects(readArchivedScheduledRun(db, String(id), async () => Buffer.alloc(1)), /checksum/);
    const rows = await readClosedRun(db, String(id), read);
    assert.ok(rows);
    assert.deepEqual(BSON.serialize(checkClosedOperation(rows, item).result), BSON.serialize(cached));
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
