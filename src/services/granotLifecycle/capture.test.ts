import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { canonicalJson } from "../durableWork/checksum";
import {
  GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH,
  allowlistGranotWebhookHeaders,
  buildGranotWebhookReceiptInsert,
  captureGranotLifecycleWebhookReceipt,
  type GranotWebhookReceiptInsert,
} from "./capture";
import {
  getGranotLifecycleReceiptsTotal,
  resetGranotLifecycleMetrics,
} from "./metrics";

const capturedAt = new Date("2026-08-17T16:00:00.000Z");
const syntheticPayload = {
  event_type: "lead_created",
  job_no: "567632",
  priority: "1",
};

afterEach(() => {
  resetGranotLifecycleMetrics();
});

test("[AC-01][AC-35] capture writes a complete v2 webhook receipt with proven auth and no later fields", async () => {
  const persisted: GranotWebhookReceiptInsert[] = [];
  const result = await captureGranotLifecycleWebhookReceipt(
    {
      route_event_class: "priority_updated",
      captured_at: capturedAt,
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": "must-not-be-stored",
        authorization: "Bearer must-not-be-stored",
        cookie: "must-not-be-stored",
        "x-forwarded-for": "203.0.113.10",
        "x-granot-delivery-id": "delivery-123",
        "x-request-id": "synthetic-request",
      },
      payload: {
        ...syntheticPayload,
        "x-api-secret": "must-not-be-stored",
      },
      authentication_method: "body_secret",
    },
    async (document) => {
      persisted.push(document);
      return { receipt_id: "receipt-1" };
    },
  );

  assert.deepEqual(result, { receipt_id: "receipt-1" });
  assert.equal(persisted.length, 1);
  const document = persisted[0];
  assert.ok(document);
  assert.equal(document.source_system, "granot");
  assert.equal(document.observation_channel, "granot_webhook");
  assert.equal(document.captured_at.toISOString(), capturedAt.toISOString());
  assert.equal(document.received_at.toISOString(), capturedAt.toISOString());
  assert.equal(document.route_event_class, "priority_updated");
  assert.equal(document.event_type, "priority_updated");
  assert.equal(document.authentication_method, "body_secret");
  assert.equal(document.evidence_version, 2);
  assert.equal(document.schema_version, 1);
  assert.equal(document.provider, "granot");
  assert.equal(document.payload_kind, "object");
  assert.deepEqual(document.payload, syntheticPayload);
  assert.deepEqual(document.headers, {
    "content-type": "application/json",
    "x-request-id": "synthetic-request",
  });
  assert.deepEqual(document.processing, {
    state: "pending",
    technical_attempts: 0,
    match_attempt: 0,
    next_attempt_at: capturedAt,
    manual_requeue_count: 0,
  });
  assert.equal(document.processing_status, "received");
  assert.equal(document.processing_attempts, 0);
  assert.equal("channel_operation_kind" in document, false);
  assert.equal("channel_operation_id" in document, false);
  assert.equal("initiator" in document, false);
  assert.equal(JSON.stringify(document).includes("must-not-be-stored"), false);
  assert.equal(
    getGranotLifecycleReceiptsTotal({
      channel: "granot_webhook",
      event_class: "priority_updated",
    }),
    1,
  );
});

test("[AC-01][AC-35] header allowlist keeps only the five bounded names", () => {
  const longValue = "x".repeat(GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH + 25);
  assert.deepEqual(
    allowlistGranotWebhookHeaders({
      "Content-Type": "application/json",
      "Content-Length": "12",
      "User-Agent": "synthetic-agent",
      "X-Request-Id": longValue,
      "X-Vercel-Id": ["first", longValue],
      authorization: "Bearer must-not-be-stored",
      cookie: "must-not-be-stored",
      "x-api-secret": "must-not-be-stored",
      "x-forwarded-for": "203.0.113.10",
      forwarded: "for=203.0.113.10",
      "x-granot-delivery-id": "delivery-123",
      "x-unknown": "omit-me",
      "x-vercel-id-extra": undefined,
    }),
    {
      "content-type": "application/json",
      "content-length": "12",
      "user-agent": "synthetic-agent",
      "x-request-id": "x".repeat(GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH),
      "x-vercel-id": [
        "first",
        "x".repeat(GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH),
      ],
    },
  );
});

test("[AC-02][AC-35] hashes the credential-redacted payload after allowlisting headers", () => {
  const document = buildGranotWebhookReceiptInsert({
    route_event_class: "lead_created",
    captured_at: capturedAt,
    headers: {
      "content-type": "application/json",
      "x-api-secret": "must-not-be-hashed",
    },
    payload: {
      ...syntheticPayload,
      "X-API-SECRET": "must-not-be-hashed",
    },
    authentication_method: "header_secret",
  });
  const expected = createHash("sha256")
    .update(canonicalJson(syntheticPayload), "utf8")
    .digest("hex");
  assert.equal(document.payload_sha256, expected);
  assert.match(document.payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(document.payload_sha256, document.payload_sha256.toLowerCase());
  assert.deepEqual(document.payload, syntheticPayload);
  assert.equal(JSON.stringify(document).includes("must-not-be-hashed"), false);
});

test("[AC-02] identical webhook deliveries stay distinct receipts and may share the diagnostic hash", async () => {
  const persisted: GranotWebhookReceiptInsert[] = [];
  const first = await captureGranotLifecycleWebhookReceipt(
    webhookInput(),
    async (document) => {
      persisted.push(document);
      return { receipt_id: "receipt-a" };
    },
  );
  const second = await captureGranotLifecycleWebhookReceipt(
    webhookInput(),
    async (document) => {
      persisted.push(document);
      return { receipt_id: "receipt-b" };
    },
  );

  assert.notEqual(first.receipt_id, second.receipt_id);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0]?.payload_sha256, persisted[1]?.payload_sha256);
  assert.deepEqual(persisted[0]?.payload, persisted[1]?.payload);
});

test("[AC-01] capture refuses an unproven authentication method before persist", async () => {
  const persisted: GranotWebhookReceiptInsert[] = [];
  await assert.rejects(
    captureGranotLifecycleWebhookReceipt(
      {
        ...webhookInput(),
        authentication_method: "legacy_unknown" as never,
      },
      async (document) => {
        persisted.push(document);
        return { receipt_id: "receipt-should-not-exist" };
      },
    ),
    /proven authentication method/,
  );
  assert.equal(persisted.length, 0);
  assert.equal(
    getGranotLifecycleReceiptsTotal({
      channel: "granot_webhook",
      event_class: "lead_created",
    }),
    0,
  );
});

function webhookInput() {
  return {
    route_event_class: "lead_created" as const,
    captured_at: capturedAt,
    headers: { "content-type": "application/json" },
    payload: syntheticPayload,
    authentication_method: "header_secret" as const,
  };
}
