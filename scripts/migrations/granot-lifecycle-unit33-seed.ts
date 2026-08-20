/** Synthetic-only seed for the Unit 33 disposable receipt cleanup proof. */
import mongoose from "mongoose";
import { getMongoDatabaseName, isTestMode } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { GRANOT_OBSERVATION_RECEIPT_COLLECTION } from "../../src/models/GranotObservationReceipt.js";
import { hashCredentialRedactedPayload } from "../../src/services/granotLifecycle/receiptEvidence.js";

const SYNTHETIC_ID = new mongoose.Types.ObjectId("33aa00000000000000000001");
const CAPTURED_AT = new Date("2026-08-19T00:00:00.000Z");

async function main(): Promise<void> {
  const databaseName = getMongoDatabaseName();
  if (!isTestMode() || !/^testvantagemovers_unit33migration$/i.test(databaseName)) {
    throw new Error("Refusing Unit 33 seed outside testvantagemovers_unit33migration.");
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== databaseName) {
    throw new Error("Connected database does not match the Unit 33 seed target.");
  }
  const collection = mongoose.connection.db.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  const payload = { event_type: "lead_created", priority: "1" };
  await collection.updateOne(
    { _id: SYNTHETIC_ID },
    {
      $setOnInsert: {
        source_system: "granot",
        observation_channel: "granot_webhook",
        captured_at: CAPTURED_AT,
        route_event_class: "lead_created",
        authentication_method: "legacy_unknown",
        evidence_version: 2,
        payload_kind: "object",
        headers: { "content-type": "application/json" },
        payload,
        payload_sha256: hashCredentialRedactedPayload(payload).payload_sha256,
        processing: {
          state: "pending",
          technical_attempts: 0,
          match_attempt: 0,
          next_attempt_at: CAPTURED_AT,
          manual_requeue_count: 0,
        },
        provider: "granot",
        event_type: "lead_created",
        received_at: CAPTURED_AT,
        schema_version: 1,
        processing_status: "received",
        processing_attempts: 0,
        createdAt: CAPTURED_AT,
        updatedAt: CAPTURED_AT,
      },
    },
    { upsert: true },
  );
  await collection.createIndex(
    { event_type: 1, received_at: -1 },
    { name: "granot_webhook_receipt_event_received_legacy" },
  );
  await collection.createIndex(
    { processing_status: 1, received_at: 1 },
    { name: "granot_webhook_receipt_status_received_legacy" },
  );
  console.info("Seeded one redacted v2 receipt with retired compatibility fields/indexes.");
}

main()
  .catch(() => {
    console.error("Unit 33 synthetic seed failed with a bounded technical error.");
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect().catch(() => undefined));
