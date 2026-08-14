import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalJson } from "../durableWork/checksum";
import {
  fillLegacyWebhookReceiptV2Fields,
  translateLegacyProcessingState,
} from "./receiptCompatibility";
import {
  emptyRemovedCredentialKeyCounts,
  hashCredentialRedactedPayload,
  redactCredentialKeys,
} from "./receiptEvidence";

test("[AC-02][AC-35] hashes canonical credential-redacted JSON as lowercase SHA-256 hex", () => {
  const payload = {
    event_type: "lead_created",
    "X-API-SECRET": "must-not-be-hashed",
    nested: { authorization: "must-not-be-hashed", priority: "1" },
  };

  const evidence = hashCredentialRedactedPayload(payload);
  const expected = createHash("sha256")
    .update(
      canonicalJson({
        event_type: "lead_created",
        nested: { priority: "1" },
      }),
      "utf8",
    )
    .digest("hex");

  assert.equal(evidence.payload_sha256, expected);
  assert.match(evidence.payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.payload_sha256, evidence.payload_sha256.toLowerCase());
  assert.deepEqual(evidence.redacted_payload, {
    event_type: "lead_created",
    nested: { priority: "1" },
  });
});

test("[AC-35] reports removed credential-key counts only and never values", () => {
  const redacted = redactCredentialKeys({
    Authorization: "must-not-be-stored",
    cookie: "must-not-be-stored",
    set_cookie: "must-not-be-stored",
    "x_api_secret": "must-not-be-stored",
    "content-type": "application/json",
    nested: [{ "X-Api-Secret": "must-not-be-stored" }],
  });

  assert.deepEqual(redacted.removed_key_counts, {
    "x-api-secret": 2,
    authorization: 1,
    cookie: 1,
    "set-cookie": 1,
  });
  assert.deepEqual(redacted.value, {
    "content-type": "application/json",
    nested: [{}],
  });
  assert.equal(JSON.stringify(redacted).includes("must-not-be-stored"), false);
});

test("[AC-35] leaves non-credential keys untouched and starts counts at zero", () => {
  const redacted = redactCredentialKeys({
    "content-type": "application/json",
    "x-request-id": "synthetic-request",
  });
  assert.deepEqual(redacted.removed_key_counts, emptyRemovedCredentialKeyCounts());
  assert.deepEqual(redacted.value, {
    "content-type": "application/json",
    "x-request-id": "synthetic-request",
  });
});

test("[AC-02] identical redacted payloads produce the same hash and remain distinct receipts later", () => {
  const first = hashCredentialRedactedPayload({ priority: "1" });
  const second = hashCredentialRedactedPayload({ priority: "1" });
  assert.equal(first.payload_sha256, second.payload_sha256);
});

test("[AC-02] received legacy processing translates to pending defaults only", () => {
  const capturedAt = new Date("2026-08-14T12:00:00.000Z");
  const translation = translateLegacyProcessingState("received", 2, capturedAt);
  assert.deepEqual(translation, {
    ok: true,
    processing: {
      state: "pending",
      technical_attempts: 2,
      match_attempt: 0,
      next_attempt_at: capturedAt,
      manual_requeue_count: 0,
    },
  });
});

test("[AC-02] refused legacy processing statuses are not translated", () => {
  const capturedAt = new Date("2026-08-14T12:00:00.000Z");
  for (const status of ["processed", "ignored", "failed", "invented"]) {
    const translation = translateLegacyProcessingState(status, 1, capturedAt);
    assert.deepEqual(translation, {
      ok: false,
      reason: "refused_legacy_processing_status",
      processing_status: status,
    });
  }
});

test("[AC-02][AC-35] legacy webhook fill uses 34.1 mapping, legacy_unknown, and count-only redaction", () => {
  const receivedAt = new Date("2026-08-14T15:00:00.000Z");
  const filled = fillLegacyWebhookReceiptV2Fields({
    event_type: "priority_updated",
    received_at: receivedAt,
    processing_status: "received",
    processing_attempts: 0,
    payload_kind: "object",
    headers: { "x-api-secret": "must-not-be-stored", "content-type": "application/json" },
    payload: { event_type: "priority_updated", authorization: "must-not-be-stored" },
  });

  assert.equal(filled.ok, true);
  if (!filled.ok) return;
  assert.equal(filled.already_current, false);
  assert.equal(filled.fields.source_system, "granot");
  assert.equal(filled.fields.observation_channel, "granot_webhook");
  assert.equal(filled.fields.captured_at.toISOString(), receivedAt.toISOString());
  assert.equal(filled.fields.route_event_class, "priority_updated");
  assert.equal(filled.fields.evidence_version, 2);
  assert.equal(filled.fields.authentication_method, "legacy_unknown");
  assert.equal(filled.fields.processing.state, "pending");
  assert.equal(filled.fields.processing.match_attempt, 0);
  assert.equal(filled.fields.processing.manual_requeue_count, 0);
  assert.equal(
    filled.fields.processing.next_attempt_at.toISOString(),
    receivedAt.toISOString(),
  );
  assert.equal(filled.removed_key_counts["x-api-secret"], 1);
  assert.equal(filled.removed_key_counts.authorization, 1);
  assert.equal(JSON.stringify(filled).includes("must-not-be-stored"), false);
});
