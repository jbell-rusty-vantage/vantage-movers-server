import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { canonicalJson } from "../durableWork/checksum";
import {
  GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH,
  allowlistGranotWebhookHeaders,
  buildGranotChannelReceiptInsert,
  buildGranotWebhookReceiptInsert,
  captureChannelOperationReceipt,
  captureGranotLifecycleWebhookReceipt,
  type GranotChannelReceiptInsert,
  type GranotWebhookReceiptInsert,
} from "./capture";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  OperationIdempotencyConflictError,
} from "./errors";
import type { DurableActor } from "../durableWork/types";
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

const ownerInitiator: DurableActor = {
  actor_type: "owner",
  actor_id: "owner-1",
  actor_label: "owner@example.invalid",
  actor_role: "owner",
  request_id: "req-extension-1",
  origin: "browser_extension",
};

const applyItem = {
  operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  operation_kind: "lead_snapshot_apply" as const,
  granot_statement: { source: "Synthetic Forms", priority: "1", user: "MIKE", rep: "SALES" },
};

function channelInput(overrides: Record<string, unknown> = {}) {
  return {
    observation_channel: "browser_extension" as const,
    authentication_method: "extension_session" as const,
    channel_operation_kind: "lead_snapshot_apply" as const,
    channel_operation_id: applyItem.operation_id,
    captured_at: capturedAt,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer must-not-be-stored",
      cookie: "must-not-be-stored",
    },
    payload: applyItem,
    initiator: ownerInitiator,
    ...overrides,
  };
}

test("[AC-02][AC-33][AC-35] extension channel capture stores one browser_extension receipt and redacts credentials", async () => {
  const persisted: GranotChannelReceiptInsert[] = [];
  const result = await captureChannelOperationReceipt(
    channelInput(),
    async (document) => {
      persisted.push(document);
      return { receipt_id: "ext-receipt-1" };
    },
  );
  assert.equal(result.status, "inserted");
  assert.equal(result.receipt_id, "ext-receipt-1");
  assert.equal(persisted.length, 1);
  const document = persisted[0];
  assert.ok(document);
  assert.equal(document.observation_channel, "browser_extension");
  assert.equal(document.authentication_method, "extension_session");
  assert.equal(document.channel_operation_kind, "lead_snapshot_apply");
  assert.equal(document.channel_operation_id, applyItem.operation_id);
  assert.equal(document.initiator?.origin, "browser_extension");
  assert.equal(document.evidence_version, 2);
  assert.deepEqual(document.headers, { "content-type": "application/json" });
  assert.equal(JSON.stringify(document).includes("must-not-be-stored"), false);
  assert.equal("route_event_class" in document, false);
});

test("[AC-02] same extension operation ID + same hash replays the existing receipt", async () => {
  const firstHash = buildGranotChannelReceiptInsert(channelInput()).payload_sha256;
  const result = await captureChannelOperationReceipt(
    channelInput(),
    async () => {
      const error = Object.assign(new Error("duplicate"), { code: 11000 });
      throw error;
    },
    async () => ({
      _id: { toString: () => "winner-receipt" } as never,
      payload_sha256: firstHash,
      channel_operation_kind: "lead_snapshot_apply",
    }),
  );
  assert.equal(result.status, "replayed");
  assert.equal(result.receipt_id, "winner-receipt");
});

test("[AC-02] same extension operation ID + different hash is GRANOT_OPERATION_IDEMPOTENCY_CONFLICT", async () => {
  await assert.rejects(
    captureChannelOperationReceipt(
      channelInput(),
      async () => {
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      },
      async () => ({
        _id: { toString: () => "winner-receipt" } as never,
        payload_sha256: "a".repeat(64),
        channel_operation_kind: "lead_snapshot_apply",
      }),
    ),
    (error: unknown) =>
      error instanceof OperationIdempotencyConflictError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.OPERATION_IDEMPOTENCY_CONFLICT &&
      error.statusCode === 409,
  );
});

const automationInitiator: DurableActor = {
  actor_type: "owner",
  actor_id: "owner-auto-1",
  actor_label: "owner@example.invalid",
  actor_role: "owner",
  request_id: "req-auto-1",
  origin: "vantage_admin",
};

const automationItem = {
  operation_id: "507f1f77bcf86cd799439011:Synthetic Forms:row-1",
  operation_kind: "lead_snapshot_apply" as const,
  granot_statement: { source: "Synthetic Forms", priority: "1", user: "MIKE", rep: "SALES" },
};

function automationInput(overrides: Record<string, unknown> = {}) {
  return {
    observation_channel: "granot_http_automation" as const,
    authentication_method: "automation_owner_approval" as const,
    channel_operation_kind: "lead_snapshot_apply" as const,
    channel_operation_id: automationItem.operation_id,
    captured_at: capturedAt,
    headers: {},
    payload: automationItem,
    initiator: automationInitiator,
    ...overrides,
  };
}

test("[AC-02] automation channel capture stores one granot_http_automation receipt", async () => {
  const persisted: GranotChannelReceiptInsert[] = [];
  const result = await captureChannelOperationReceipt(
    automationInput(),
    async (document) => {
      persisted.push(document);
      return { receipt_id: "auto-receipt-1" };
    },
  );
  assert.equal(result.status, "inserted");
  assert.equal(persisted[0]?.observation_channel, "granot_http_automation");
  assert.equal(persisted[0]?.authentication_method, "automation_owner_approval");
  assert.equal(persisted[0]?.channel_operation_id, automationItem.operation_id);
  assert.equal(persisted[0]?.initiator?.origin, "vantage_admin");
  assert.deepEqual(persisted[0]?.headers, {});
});

test("[AC-02] same automation operation ID + different kind is GRANOT_OPERATION_IDEMPOTENCY_CONFLICT", async () => {
  const firstHash = buildGranotChannelReceiptInsert(automationInput()).payload_sha256;
  await assert.rejects(
    captureChannelOperationReceipt(
      automationInput(),
      async () => {
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      },
      async () => ({
        _id: { toString: () => "winner-receipt" } as never,
        payload_sha256: firstHash,
        channel_operation_kind: "booking_action_apply",
      }),
    ),
    (error: unknown) => error instanceof OperationIdempotencyConflictError,
  );
});
