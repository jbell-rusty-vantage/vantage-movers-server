import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { hashCredentialRedactedPayload } from "../services/granotLifecycle/receiptEvidence";
import {
  GranotObservationReceipt,
  assertAllowlistedReceiptProcessingUpdate,
} from "./GranotObservationReceipt";

const capturedAt = new Date("2026-08-14T16:00:00.000Z");
const syntheticPayload = { event_type: "lead_created", priority: "1" };
const payloadHash = hashCredentialRedactedPayload(syntheticPayload).payload_sha256;

function webhookReceipt(overrides: Record<string, unknown> = {}) {
  return new GranotObservationReceipt({
    source_system: "granot",
    observation_channel: "granot_webhook",
    captured_at: capturedAt,
    route_event_class: "lead_created",
    authentication_method: "legacy_unknown",
    evidence_version: 2,
    payload_kind: "object",
    headers: { "content-type": "application/json" },
    payload: syntheticPayload,
    payload_sha256: payloadHash,
    processing: {
      state: "pending",
      technical_attempts: 0,
      match_attempt: 0,
      next_attempt_at: capturedAt,
      manual_requeue_count: 0,
    },
    provider: "granot",
    ...overrides,
  });
}

test("receipt schema keeps the retired payload hash index out", () => {
  const indexes = GranotObservationReceipt.schema.indexes() as [Record<string, unknown>, unknown][];
  assert.ok(!indexes.some(([fields]) => Object.hasOwn(fields, "payload_sha256")));
});

test("[AC-02] model save rejects post-insert evidence mutation", async () => {
  const receipt = webhookReceipt();
  receipt.isNew = false;
  receipt.payload = { event_type: "priority_updated" };
  await assert.rejects(receipt.save(), /write-once|evidence/);
});

test("[AC-02] query updates reject non-processing operators and evidence paths", () => {
  assert.throws(
    () => assertAllowlistedReceiptProcessingUpdate({ $set: { payload: {} } }),
    /processing/,
  );
  assert.throws(
    () => assertAllowlistedReceiptProcessingUpdate({ $push: { "processing.state": "claimed" } }),
    /operator/,
  );
  assert.doesNotThrow(() =>
    assertAllowlistedReceiptProcessingUpdate({
      $set: { "processing.state": "claimed" },
      $inc: { "processing.technical_attempts": 1 },
      $unset: { "processing.lease_owner": 1 },
      $setOnInsert: { createdAt: capturedAt },
    }),
  );
  assert.throws(
    () => assertAllowlistedReceiptProcessingUpdate({ $setOnInsert: { payload: {} } }),
    /processing/,
  );
});

test("[AC-02] replace and delete query hooks reject evidence mutation", async () => {
  const id = new mongoose.Types.ObjectId();
  await assert.rejects(
    GranotObservationReceipt.replaceOne({ _id: id }, { payload: {} }),
    /replaced or deleted/,
  );
  await assert.rejects(
    GranotObservationReceipt.deleteOne({ _id: id }),
    /replaced or deleted/,
  );
  await assert.rejects(
    GranotObservationReceipt.updateOne({ _id: id }, { $set: { payload: {} } }),
    /processing/,
  );
});
