import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotObservationModel } from "../../src/models/GranotObservation.js";
import { getGranotObservationReceiptModel } from "../../src/models/GranotObservationReceipt.js";
import { getSynchronizationDecisionModel } from "../../src/models/SynchronizationDecision.js";
import { captureGranotLifecycleWebhookReceipt } from "../../src/services/granotLifecycle/capture.js";
import { granotObservationProcessor } from "../../src/services/granotLifecycle/processor.js";
import { stableHash } from "./granot-lifecycle-shadow.lib.js";

const FORBIDDEN = [
  "form_leads", "call_leads", "booked_leads", "cancelled_leads",
  "granot_booking_reconciliation_cases", "granot_release_reconciliation_cases",
  "granot_booking_discrepancies", "granot_release_discrepancies",
  "domain_command_executions", "entity_changes", "sheet_sync_jobs", "notification_deliveries",
] as const;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") { t.skip("Replica proof is opt-in."); return false; }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) { t.skip("Refusing non-test database."); return false; }
  await connectMongo();
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName) { t.skip("Replica set required."); return false; }
  return true;
}

async function snapshot() {
  const db = mongoose.connection.db!;
  const values = [];
  for (const collection of FORBIDDEN) {
    const rows = await db.collection(collection).find({}, { projection: { _id: 1, domain_revision: 1, updatedAt: 1 } }).sort({ _id: 1 }).toArray();
    values.push({ collection, count: rows.length, hash: stableHash(rows.map((row) => [String(row._id), row.domain_revision ?? null, row.updatedAt ?? null])) });
  }
  return values;
}

after(async () => { await mongoose.disconnect().catch(() => undefined); });

test("[AC-31][AC-35][AC-37][AC-38] historical processor replay is causally idempotent with zero forbidden effects", async (t) => {
  if (!(await replicaReady(t))) return;
  const captured = await captureGranotLifecycleWebhookReceipt({
    route_event_class: "lead_created",
    captured_at: new Date("2000-01-01T00:00:00.000Z"),
    authentication_method: "header_secret",
    headers: { "content-type": "application/json" },
    payload: { event_type: "lead_created", source: "" },
  });
  try {
    const before = await snapshot();
    const first = await granotObservationProcessor.process({ receipt_id: captured.receipt_id });
    const replay = await granotObservationProcessor.process({ receipt_id: captured.receipt_id });
    assert.equal(replay.decision_id, first.decision_id);
    assert.deepEqual(first.effects, []);
    const decision = await getSynchronizationDecisionModel().findById(first.decision_id).lean();
    assert.equal(decision?.execution_mode, "historical_shadow");
    assert.deepEqual(await snapshot(), before);
  } finally {
    const observations = await getGranotObservationModel().find({ receipt_id: captured.receipt_id }).select({ _id: 1 }).lean();
    await getSynchronizationDecisionModel().collection.deleteMany({ observation_id: { $in: observations.map((row) => row._id) } });
    await getGranotObservationModel().collection.deleteMany({ receipt_id: new mongoose.Types.ObjectId(captured.receipt_id) });
    await getGranotObservationReceiptModel().collection.deleteOne({ _id: new mongoose.Types.ObjectId(captured.receipt_id) });
  }
});
