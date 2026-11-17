/** Run explicitly with node --import tsx --test ops/vantage/granot-trace.replica.ts. */
import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import { seedGranotTrace, PRIVATE_MARKER } from "./granot-fixture";
import { traceGranotAction } from "./granot-trace";
import { GRANOT_REHEARSAL, assertLocalHello, assertLocalIdentity } from "./local-safety";
import { withLocalDatabase } from "./local-database";

test("exact action traverses only five bounded scalar projections; mismatches stop before the next edge", async () => {
  await withLocalDatabase(GRANOT_REHEARSAL, async (setup) => {
    const f = await seedGranotTrace(setup);
    const commandNames: string[] = [], projections: Document[] = [];
    const client = new MongoClient(GRANOT_REHEARSAL.uri, { monitorCommands: true, maxPoolSize: 1, serverSelectionTimeoutMS: 2_000 });
    client.on("commandStarted", (event) => { commandNames.push(event.commandName); });
    client.on("commandSucceeded", (event) => {
      if (event.commandName === "aggregate") {
        const reply = event.reply as { cursor: { firstBatch: Document[] } };
        projections.push(...reply.cursor.firstBatch);
      }
    });
    const update = (collection: string, id: ObjectId, fields: Document) => setup.collection(collection).updateOne({ _id: id }, { $set: fields });
    let db: Db;
    const trace = () => traceGranotAction(db, String(f.run), f.action);
    try {
      assertLocalIdentity(GRANOT_REHEARSAL);
      await client.connect();
      assertLocalHello(await client.db("admin").command({ hello: 1 }), GRANOT_REHEARSAL);
      db = client.db(GRANOT_REHEARSAL.database);
      commandNames.length = 0;
      const result = await trace();
      assert.equal(result.stop, "canonical_lead_read");
      assert.equal(result.action?.recorded_outcome, "accepted_for_processing");
      assert.equal(result.decision?.matches_run_checkpoint, false);
      assert.equal(result.receipt?.matches_sealed_capture_time, true);
      assert.equal(result.action?.statement_object_present, true);
      assert.deepEqual(result.decision?.target_lead_effect_kinds, ["lead_updated"]);
      assert.equal(result.lead?.observation_vs_current_winner, "older");
      assert.equal(result.lead?.certified_for_this_decision, false);
      assert.deepEqual(commandNames, Array(5).fill("aggregate"));
      assert.equal(projections.length, 5);
      for (const privateValue of [PRIVATE_MARKER, f.action, "changed_paths", "granot_statement", "payload", "contact"]) {
        assert.equal(JSON.stringify(projections).includes(privateValue), false);
      }

      await update("synchronization_decisions", f.decision, { "effects.0.ref.id": String(new ObjectId()) });
      assert.deepEqual((await trace()).decision?.target_lead_effect_kinds, []);
      await update("form_leads", f.lead, { last_accepted_granot_observation: {
        observation_id: f.observation, captured_at: f.captured, evidence: {
          version: 2, outcome: "applied", decision_id: f.decision, receipt_id: f.receipt,
        },
      } });
      assert.equal((await trace()).lead?.certified_for_this_decision, true);
      await update("form_leads", f.lead, { "last_accepted_granot_observation.evidence.version": 1 });
      assert.equal((await trace()).lead?.certified_for_this_decision, false);
      await update("synchronization_decisions", f.decision, { outcome: PRIVATE_MARKER, "target.model": PRIVATE_MARKER });
      const malformed = await trace();
      assert.equal(malformed.stop, "no_canonical_lead_target");
      assert.equal(malformed.decision?.outcome, "unknown");
      assert.equal(JSON.stringify(malformed).includes(PRIVATE_MARKER), false);

      await update("synchronization_decisions", f.decision, { observation_id: new ObjectId() });
      assert.equal((await trace()).stop, "linked_decision_missing");
      await update("granot_webhook_receipts", f.receipt, { "processing.latest_decision_id": null });
      assert.equal((await trace()).stop, "latest_decision_pointer_missing");
      await update("granot_automation_runs", f.run, { "receipts.0.observation_id": String(new ObjectId()) });
      assert.equal((await trace()).stop, "run_observation_pointer_mismatch");
      await update("granot_automation_runs", f.run, { "receipts.0.lifecycle_receipt_id": String(new ObjectId()) });
      assert.equal((await trace()).stop, "run_receipt_pointer_mismatch");
      await update("granot_automation_runs", f.run, { "receipts.0.lifecycle_receipt_id": "" });
      assert.equal((await trace()).stop, "run_receipt_pointer_invalid");
      await update("granot_automation_runs", f.run, { "receipts.0.error_code": "GRANOT_OPERATION_IDEMPOTENCY_CONFLICT" });
      commandNames.length = 0;
      const conflict = await trace();
      assert.equal(conflict.stop, "operation_idempotency_conflict");
      assert.equal(conflict.receipt, null);
      assert.deepEqual(commandNames, ["aggregate"]);
      await update("granot_automation_runs", f.run, { receipts: [] });
      assert.equal((await trace()).stop, "operation_key_correlation_only");
      await update("granot_webhook_receipts", f.receipt, { channel_operation_kind: "booking_action_apply" });
      assert.equal((await trace()).stop, "receipt_operation_kind_mismatch");
      await update("granot_automation_runs", f.run, { receipts: [{ action_id: f.action }, { action_id: f.action }] });
      assert.equal((await trace()).stop, "ambiguous_run_evidence");
      await update("granot_automation_runs", f.run, { receipts: [], "approval.plan_checksum": "0".repeat(64) });
      assert.equal((await trace()).stop, "approval_evidence_incomplete");
      await update("granot_automation_runs", f.run, { "approval.selected_action_ids": [] });
      assert.equal((await trace()).stop, "action_not_selected");
      assert.equal((await traceGranotAction(db, String(f.run), "$approval.selected_action_ids")).stop, "action_missing");
      assert.equal((await traceGranotAction(db, String(new ObjectId()), f.action)).stop, "run_missing");
    } finally {
      await client.close();
      // Clean only this invocation's uniquely generated fixture IDs. Leave the blind rehearsal and concurrent tests intact.
      for (const [collection, id] of [
        ["granot_automation_runs", f.run], ["granot_webhook_receipts", f.receipt], ["granot_observations", f.observation],
        ["synchronization_decisions", f.decision], ["synchronization_decisions", f.checkpoint], ["form_leads", f.lead],
      ] as const) await setup.collection(collection).deleteOne({ _id: id });
    }
  });
});
