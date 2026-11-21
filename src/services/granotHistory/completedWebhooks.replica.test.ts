import assert from "node:assert/strict";
import test from "node:test";
import { BSON, ObjectId } from "mongodb";
import { getDailyOperationsCollectionName } from "../../config/domain/dailyOperations";
import { easternDayKey } from "../dailyOperations/dayDocument";
import { fakeGranotArchive, historyReplica } from "./archiveTestSupport";
import { retireWebhookReceipt } from "./completedWebhooks";
import { archivedReceipts, readGranotChain } from "./retiredRecords";

test("completed inbound Lead receipts leave Mongo only after exact GCS recovery and committed business evidence", async (t) => {
  const replica = await historyReplica(t, "webhook");
  if (!replica) return;
  const { client, db } = replica;
  try {
    const at = new Date(),
      receipts = db.collection("granot_webhook_receipts");
    const observations = db.collection("granot_observations"),
      decisions = db.collection("synchronization_decisions");
    await db
      .collection(getDailyOperationsCollectionName("days"))
      .insertOne({ day: easternDayKey(at), webhook_counts_version: 1 });
    const { storage } = fakeGranotArchive();
    const read = storage.read;
    async function seed(
      route: string,
      outcome: string,
      reason: string,
      channel = "granot_webhook",
    ) {
      const id = new ObjectId(),
        obs = new ObjectId(),
        decision = new ObjectId(),
        lead = new ObjectId();
      await receipts.insertOne({
        _id: id,
        route_event_class: route,
        observation_channel: channel,
        captured_at: at,
        webhook_day_counted: true,
        payload: { synthetic: true },
        processing: {
          state: "completed",
          completed_at: at,
          latest_decision_id: decision,
        },
      });
      await observations.insertOne({
        _id: obs,
        receipt_id: id,
        route_event_class: route,
        kind: "lead_snapshot",
      });
      const target = { model: "FormLead", id: String(lead) };
      await decisions.insertOne({
        _id: decision,
        observation_id: obs,
        execution_mode: "live",
        outcome,
        reason_code: reason,
        target,
        effects: [
          {
            kind: outcome === "created" ? "lead_created" : "lead_updated",
            ref: target,
          },
        ],
      });
      return { id, obs, lead, decision };
    }
    const created = await seed(
      "lead_created",
      "created",
      "lead_created_authorized",
    );
    assert.equal(await retireWebhookReceipt(db, created.id, storage), "held");
    await db
      .collection("form_leads")
      .insertOne({
        _id: created.lead,
        ingestion_origin: "granot_lead_created",
      });
    const original = await receipts.findOne({ _id: created.id }, { raw: true });
    await assert.rejects(
      retireWebhookReceipt(db, created.id, {
        store: async () => {
          throw Error("GCS unavailable");
        },
      }),
    );
    await assert.rejects(
      retireWebhookReceipt(db, created.id, {
        store: async (name: string, bytes: Buffer) => ({
          ...(await storage.store(name, bytes)),
          persisted: Buffer.alloc(0),
        }),
      }),
    );
    assert.equal(await receipts.countDocuments({ _id: created.id }), 1);
    const results = await Promise.all([
      retireWebhookReceipt(db, created.id, storage),
      retireWebhookReceipt(db, created.id, storage),
    ]);
    assert.equal(results.filter((x) => x === "retired").length, 1);
    assert.equal(await receipts.countDocuments({ _id: created.id }), 0);
    const restored = await readGranotChain(db, created.id, read);
    assert.ok(restored);
    assert.deepEqual(restored.receipt.payload, { synthetic: true });
    assert.ok(Buffer.isBuffer(original));
    assert.deepEqual(
      BSON.deserialize(original).processing.latest_decision_id,
      restored.receipt.processing.latest_decision_id,
    );
    assert.equal(restored.decisions.length, 1);
    const locator = await archivedReceipts(db).findOne({ _id: created.id });
    assert.ok(locator && !("payload" in locator));
    const update = await seed(
      "priority_updated",
      "applied",
      "lead_state_changed",
    );
    await db.collection("form_leads").insertOne({ _id: update.lead });
    assert.equal(
      await retireWebhookReceipt(db, update.id, {
        store: async (name: string, bytes: Buffer) => {
          await receipts.updateOne(
            { _id: update.id },
            { $set: { "processing.latest_decision_id": new ObjectId() } },
          );
          return storage.store(name, bytes);
        },
      }),
      "changed",
    );
    await receipts.updateOne(
      { _id: update.id },
      { $set: { "processing.latest_decision_id": update.decision } },
    );
    assert.equal(await retireWebhookReceipt(db, update.id, storage), "retired");
    const observed = await seed(
      "lead_created",
      "policy_blocked",
      "creation_policy_observation_only",
    );
    const source = new ObjectId();
    await decisions.updateOne(
      { _id: observed.decision },
      {
        $set: {
          source_policy: { granot_crm_source_id: source, policy_version: "v1" },
        },
      },
    );
    await db
      .collection("granot_crm_sources")
      .insertOne({
        _id: source,
        lifecycle_policy_version: "v1",
        lead_created_policy: "create_if_missing",
      });
    assert.equal(await retireWebhookReceipt(db, observed.id, storage), "held");
    await db
      .collection("granot_crm_sources")
      .updateOne(
        { _id: source },
        { $set: { lead_created_policy: "observation_only" } },
      );
    assert.equal(
      await retireWebhookReceipt(db, observed.id, storage),
      "retired",
    );
    for (const row of [
      await seed(
        "booking_status_changed",
        "created",
        "lead_created_authorized",
      ),
      await seed(
        "lead_created",
        "pending_match",
        "pending_source_scoped_match",
      ),
      await seed("priority_updated", "invalid", "invalid_payload"),
      await seed(
        "lead_created",
        "policy_blocked",
        "creation_policy_observation_only",
        "browser_extension",
      ),
    ]) {
      assert.equal(await retireWebhookReceipt(db, row.id, storage), "held");
    }
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
