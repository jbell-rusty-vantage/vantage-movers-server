import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, ObjectId, type Document } from "mongodb";
import { getDailyOperationsCollectionName } from "../../config/domain/dailyOperations";
import { easternDayKey } from "../dailyOperations/dayDocument";
import { captureChannelOperationReceipt } from "../granotLifecycle/capture";
import { currentReceiptReplay } from "../granotLifecycle/receiptReplay";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import { OperationIdempotencyConflictError } from "../granotLifecycle/errors";
import { digest } from "./archiveCodec";
import { policies, runFutureRetention } from "./futureRetention";
import { closedRuns, packClosedRun } from "./closedAutomationRun";
import { readArchivedReceipt } from "./settledLeadEvidence";

test("settled webhook, extension and effect-bearing HTTP detail restores after retirement while references, priority 5 and uncounted deliveries remain live", async t => {
  if (process.env.GRANOT_ARCHIVE_REPLICA_TESTS !== "true") return t.skip("opt-in isolated archive replica");
  const client = new MongoClient("mongodb://127.0.0.1:27964/?replicaSet=archiveSlim", { serverSelectionTimeoutMS: 3000 });
  const db = client.db("testvantagemovers_archive" + new ObjectId());
  try {
    assert.deepEqual((await db.admin().command({ hello: 1 })).hosts, ["127.0.0.1:27964"]);
    const now = new Date(), at = new Date(+now - 2 * 86400000), job = "T-72004";
    const receipts = db.collection("granot_webhook_receipts"), observations = db.collection("granot_observations"), decisions = db.collection("synchronization_decisions");
    await receipts.createIndex({ "processing.retention_review_at": 1 }, { name: "granot_retention_review_v1", sparse: true });
    await receipts.createIndex({ observation_channel: 1, channel_operation_id: 1 }, { unique: true, partialFilterExpression: { channel_operation_id: { $type: "string" } } });
    await policies(db).insertOne({ _id: "v1", mode: "shadow", new_data_from: new Date(+at - 86400000) });
    const target = { model: "FormLead" as const, id: String(new ObjectId()) };
    await db.collection("form_leads").insertOne({ _id: new ObjectId(target.id), last_accepted_granot_observation: { captured_at: now, observation_id: new ObjectId() } });
    const objects = new Map<string, Buffer>(), generation = "117";
    const storage = {
      store: async (_database: string, bytes: Buffer) => {
        const hash = digest(bytes); objects.set(hash, bytes);
        return { hash, generation, persisted: Buffer.from(bytes) };
      },
      read: async (_database: string, hash: string, g?: string) => {
        assert.equal(g, generation); assert.ok(objects.has(hash));
        return Buffer.from(objects.get(hash)!);
      },
    };
    const days = db.collection(getDailyOperationsCollectionName("days"));
    await days.insertOne({ day: easternDayKey(at), webhook_counts_version: 1, webhooks: { priority_updated: 4 } });
    const run = String(new ObjectId());
    async function seed(channel: "granot_webhook" | "browser_extension" | "granot_http_automation", priority = "2", counted = true) {
      const receipt = new ObjectId(), observation = new ObjectId(), decision = new ObjectId();
      const operation = channel === "granot_http_automation" ? run + ":synthetic" : crypto.randomUUID();
      const payload = { operation_id: operation, operation_kind: "lead_snapshot_apply" as const, granot_statement: { priority } };
      const hash = hashCredentialRedactedPayload(payload).payload_sha256, webhook = channel === "granot_webhook";
      const effects = [{ kind: "lead_updated", changed_paths: ["granot_priority"] }];
      const result = { decision_id: String(decision), observation_id: String(observation), target, outcome: "applied", effects };
      await receipts.insertOne({ _id: receipt, observation_channel: channel, captured_at: at, createdAt: at, payload, payload_sha256: hash, headers: { "content-type": "application/json" },
        ...(webhook ? { webhook_day_counted: counted, route_event_class: "priority_updated" } : { channel_operation_id: operation, channel_operation_kind: payload.operation_kind }),
        processing: { state: "completed", completed_at: at, latest_decision_id: decision, retention_review_at: now, replay_result: result } });
      await observations.insertOne({ _id: observation, receipt_id: receipt, kind: "lead_snapshot", priority: { valid: true, canonical: priority },
        ...(webhook ? { route_event_class: "priority_updated" } : {}), captured_at: at, identity: { normalized_job_no: job } });
      await decisions.insertOne({ _id: decision, observation_id: observation, decided_at: at, outcome: "applied", effects, target, execution_mode: "live" });
      return { receipt, observation, decision, result, payload, operation, hash };
    }
    const web = await seed("granot_webhook"), ext = await seed("browser_extension"), http = await seed("granot_http_automation");
    const priority = await seed("granot_webhook", "5"), uncounted = await seed("granot_webhook", "2", false), held = await seed("granot_webhook");
    await db.collection("granot_booking_reconciliation_cases").insertOne({ evidence: [{ observation_id: held.observation }] });
    const replay = { operation: http.operation, receipt: String(http.receipt), kind: http.payload.operation_kind, hash: http.hash,
      result: { ...http.result, outcome: "applied" as const, effects: [{ kind: "lead_updated" as const, changed_paths: ["granot_priority"] }] } };
    const object = await storage.store(db.databaseName, packClosedRun(run, [replay]));
    await closedRuns(db).insertOne({ _id: run, count: 1, hash: object.hash, generation, closed_at: at });
    const read = () => runFutureRetention(db, now, async () => true, storage);
    const shadow = await read();
    assert.deepEqual(shadow, { status: "shadow", examined: 6, archived: 3, stamped: 0, retired: 0 });
    assert.equal(await receipts.countDocuments({}), 6);
    await policies(db).updateOne({ _id: "v1" }, { $set: { mode: "future" } });
    await receipts.updateMany({}, { $set: { "processing.retention_review_at": now } });
    const outcome = await read();
    assert.deepEqual(outcome, { status: "future", examined: 6, archived: 3, stamped: 0, retired: 3 });
    for (const row of [web, ext, http]) {
      assert.equal(await observations.countDocuments({ _id: row.observation }), 0);
      assert.equal(await decisions.countDocuments({ _id: row.decision }), 0);
      const restored = await readArchivedReceipt(db, row.receipt, storage.read);
      assert.deepEqual(restored?.receipt.payload, row.payload);
      assert.deepEqual(restored?.decisions[0].effects, row.result.effects);
      assert.equal(String(restored?.observation._id), String(row.observation));
    }
    assert.equal(await receipts.countDocuments({ _id: { $in: [web.receipt, http.receipt] } }), 0);
    const stub = await receipts.findOne({ _id: ext.receipt });
    assert.ok(stub); assert.equal(stub.payload, undefined); assert.equal(stub.headers, undefined);
    assert.deepEqual(currentReceiptReplay(stub.processing.replay_result, stub.processing.latest_decision_id), ext.result);
    const retake = (payload: Document) => captureChannelOperationReceipt({
      observation_channel: "browser_extension", channel_operation_kind: "lead_snapshot_apply", channel_operation_id: ext.operation,
      captured_at: now, payload, headers: {}, authentication_method: "extension_session",
      initiator: { origin: "browser_extension", actor_type: "owner", actor_id: "replica", actor_role: "owner", actor_label: "Replica", request_id: "test" },
    }, async doc => ({ receipt_id: String((await receipts.insertOne(doc)).insertedId) }),
    async q => {
      const row = await receipts.findOne(q);
      return row ? { _id: row._id, payload_sha256: row.payload_sha256, channel_operation_kind: row.channel_operation_kind } : null;
    });
    assert.equal((await retake(ext.payload)).status, "replayed");
    await assert.rejects(retake({ ...ext.payload, granot_statement: { priority: "3" } }), OperationIdempotencyConflictError);
    assert.equal(await receipts.countDocuments({ _id: { $in: [priority.receipt, uncounted.receipt, held.receipt] }, payload: { $exists: true } }), 3);
    assert.equal((await days.findOne({ day: easternDayKey(at) }))?.webhooks.priority_updated, 4);
    await assert.rejects(readArchivedReceipt(db, web.receipt, async () => Buffer.alloc(0)), /checksum mismatch/);
  } finally { await db.dropDatabase(); await client.close(); }
});
