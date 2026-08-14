import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { hashCredentialRedactedPayload } from "../services/granotLifecycle/receiptEvidence";
import {
  GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  GRANOT_OBSERVATION_RECEIPT_INDEXES,
  GRANOT_OBSERVATION_RECEIPT_MODEL_NAME,
  GranotObservationReceipt,
  GranotWebhookReceipt,
  assertAllowlistedReceiptProcessingUpdate,
  getGranotObservationReceiptModel,
  getGranotWebhookReceiptModel,
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
    event_type: "lead_created",
    received_at: capturedAt,
    schema_version: 1,
    processing_status: "received",
    processing_attempts: 0,
    ...overrides,
  });
}

function extensionReceipt(overrides: Record<string, unknown> = {}) {
  return webhookReceipt({
    observation_channel: "browser_extension",
    route_event_class: undefined,
    event_type: undefined,
    channel_operation_kind: "lead_snapshot_apply",
    channel_operation_id: "77777777-7777-4777-8777-777777777777",
    authentication_method: "extension_session",
    ...overrides,
  });
}

function automationReceipt(overrides: Record<string, unknown> = {}) {
  return webhookReceipt({
    observation_channel: "granot_http_automation",
    route_event_class: undefined,
    event_type: undefined,
    channel_operation_kind: "booking_action_apply",
    channel_operation_id: "run-1:booked_reconciliation:row-1",
    authentication_method: "automation_owner_approval",
    ...overrides,
  });
}

test("[AC-02] deprecated alias keeps the same model, collection, and mongoose name", () => {
  assert.equal(GranotObservationReceipt.modelName, GRANOT_OBSERVATION_RECEIPT_MODEL_NAME);
  assert.equal(GranotObservationReceipt.modelName, "GranotWebhookReceipt");
  assert.equal(
    GranotObservationReceipt.collection.collectionName,
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  assert.equal(GranotObservationReceipt.collection.collectionName, "granot_webhook_receipts");
  assert.equal(GranotWebhookReceipt, GranotObservationReceipt);
  assert.equal(getGranotWebhookReceiptModel(), getGranotObservationReceiptModel());
  assert.equal(
    getGranotWebhookReceiptModel().collection.collectionName,
    "granot_webhook_receipts",
  );
});

test("[AC-02] declares the five named Section 9.1 indexes and keeps legacy indexes", () => {
  const indexes = GranotObservationReceipt.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;

  for (const expected of GRANOT_OBSERVATION_RECEIPT_INDEXES) {
    const declared = indexes.find(([, options]) => options.name === expected.name);
    assert.ok(declared, expected.name);
    assert.deepEqual(declared?.[0], expected.key);
    if ("unique" in expected) {
      assert.equal(declared?.[1].unique, true);
    } else {
      assert.notEqual(declared?.[1].unique, true);
    }
    if ("partialFilterExpression" in expected) {
      assert.deepEqual(
        declared?.[1].partialFilterExpression,
        expected.partialFilterExpression,
      );
    }
  }

  const payloadIndex = indexes.find(
    ([, options]) => options.name === "granot_observation_receipt_payload_sha256_diag",
  );
  assert.notEqual(payloadIndex?.[1].unique, true);

  assert.ok(
    indexes.some(
      ([key]) => key.event_type === 1 && key.received_at === -1,
    ),
  );
  assert.ok(
    indexes.some(
      ([key]) => key.processing_status === 1 && key.received_at === 1,
    ),
  );
});

test("[AC-02] unique operation-id index is partial and payload hash index is never unique", () => {
  const unique = GRANOT_OBSERVATION_RECEIPT_INDEXES.find(
    (index) => index.name === "granot_observation_receipt_channel_operation_id_unique",
  );
  assert.deepEqual(unique?.key, {
    observation_channel: 1,
    channel_operation_id: 1,
  });
  assert.equal(unique?.unique, true);
  assert.deepEqual(unique?.partialFilterExpression, {
    channel_operation_id: { $type: "string" },
  });
});

test("[AC-02] webhook receipts require route_event_class and forbid channel_operation_kind", async () => {
  await webhookReceipt().validate();
  await assert.rejects(
    webhookReceipt({ route_event_class: undefined, event_type: undefined }).validate(),
    /route_event_class/,
  );
  await assert.rejects(
    webhookReceipt({ channel_operation_kind: "lead_snapshot_apply" }).validate(),
    /channel_operation_kind/,
  );
  const emptyOperationId = webhookReceipt({ channel_operation_id: "" });
  await emptyOperationId.validate();
  assert.equal(emptyOperationId.channel_operation_id, undefined);
});

test("[AC-02] extension and automation receipts require operation kind and operation id", async () => {
  await extensionReceipt().validate();
  await automationReceipt().validate();
  await assert.rejects(
    extensionReceipt({ channel_operation_kind: undefined }).validate(),
    /channel_operation_kind/,
  );
  await assert.rejects(
    extensionReceipt({ channel_operation_id: undefined }).validate(),
    /channel_operation_id/,
  );
  await assert.rejects(
    automationReceipt({ channel_operation_kind: undefined }).validate(),
    /channel_operation_kind/,
  );
  await assert.rejects(
    automationReceipt({ channel_operation_id: undefined }).validate(),
    /channel_operation_id/,
  );
  await assert.rejects(
    extensionReceipt({ route_event_class: "lead_created" }).validate(),
    /webhook route deliveries/,
  );
});

test("[AC-02] operation-id validation rejects empty, overlong, control, bidi, and wrong-channel shapes", async () => {
  await assert.rejects(
    extensionReceipt({ channel_operation_id: "" }).validate(),
    /channel_operation_id/,
  );
  await assert.rejects(
    extensionReceipt({ channel_operation_id: "a".repeat(301) }).validate(),
    /1-300|channel_operation_id/,
  );
  await assert.rejects(
    extensionReceipt({
      channel_operation_id: "aaaaaaaa-bbbb-4ccc-8d\u0001dd-eeeeeeeeeeee",
    }).validate(),
    /control|channel_operation_id/,
  );
  await assert.rejects(
    extensionReceipt({
      channel_operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee\u202e",
    }).validate(),
    /bidirectional|channel_operation_id/,
  );
  await assert.rejects(
    extensionReceipt({
      channel_operation_id: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    }).validate(),
    /lowercase UUID v4/,
  );
  await assert.rejects(
    extensionReceipt({ channel_operation_id: "not-a-uuid" }).validate(),
    /lowercase UUID v4/,
  );
  await assert.rejects(
    automationReceipt({ channel_operation_id: "run-only" }).validate(),
    /run_id|:action_id|channel_operation_id/,
  );
  await assert.rejects(
    automationReceipt({ channel_operation_id: ":missing-run" }).validate(),
    /run_id|:action_id|channel_operation_id/,
  );
});

test("[AC-02] last_error.message is capped at 500 characters", async () => {
  await assert.rejects(
    webhookReceipt({
      processing: {
        state: "dead_letter",
        technical_attempts: 1,
        match_attempt: 0,
        next_attempt_at: capturedAt,
        manual_requeue_count: 0,
        last_error: {
          code: "synthetic_failure",
          message: "x".repeat(501),
          failed_at: capturedAt,
        },
      },
    }).validate(),
    /500|message/,
  );
});

test("[AC-02] legacy capture-shaped create fills specified v2 fields without claiming a proven secret", async () => {
  const receipt = new GranotObservationReceipt({
    provider: "granot",
    event_type: "booking_status_changed",
    received_at: capturedAt,
    schema_version: 1,
    payload_kind: "object",
    headers: { "content-type": "application/json" },
    payload: { event_type: "booking_status_changed" },
    processing_status: "received",
    processing_attempts: 0,
  });

  await receipt.validate();
  assert.equal(receipt.source_system, "granot");
  assert.equal(receipt.observation_channel, "granot_webhook");
  assert.equal(receipt.captured_at.toISOString(), capturedAt.toISOString());
  assert.equal(receipt.route_event_class, "booking_status_changed");
  assert.equal(receipt.evidence_version, 2);
  assert.equal(receipt.authentication_method, "legacy_unknown");
  assert.match(receipt.payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.processing.state, "pending");
  assert.equal(receipt.processing.technical_attempts, 0);
  assert.equal(receipt.processing.match_attempt, 0);
  assert.equal(receipt.processing.manual_requeue_count, 0);
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.processing_status, "received");
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
    }),
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
