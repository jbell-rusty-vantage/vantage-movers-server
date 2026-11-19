import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { captureGranotLifecycleLogs } from "./testLifecycleLogCapture";
import {
  resetGranotLifecycleMetrics,
} from "./metrics";
import {
  maskLifecycleId,
  observeGranotOwnerCommandResult,
  sanitizeGranotLifecycleEventDetails,
} from "./observability";

let logs: ReturnType<typeof captureGranotLifecycleLogs>;

beforeEach(() => {
  logs = captureGranotLifecycleLogs();
});

afterEach(() => {
  logs.restore();
});

test("[AC-35] sanitizer drops payload, contact, credentials, and free-form reason text", () => {
  const details = sanitizeGranotLifecycleEventDetails({
    channel: "granot_webhook",
    event_class: "none",
    payload: { email: "owner@example.invalid" },
    reason: "Customer asked to stop",
    email: "owner@example.invalid",
    phone: "5550001234",
    job_number: "100",
    authorization: "secret",
    receipt_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    outcome: "policy_blocked",
  });
  assert.deepEqual(details, {
    channel: "granot_webhook",
    event_class: "none",
    receipt_id: "aaaaaa...aaaa",
    outcome: "policy_blocked",
  });
  assert.equal(maskLifecycleId("short"), "***");
});

test("[AC-31][AC-37] apply/replay/conflict stay distinguishable and replay emits no resolve", async () => {
  resetGranotLifecycleMetrics();
  await observeGranotOwnerCommandResult({
    replayed: false,
    command: "confirmGranotBooking",
    case_kind: "booking",
    case_resolved: true,
  });
  await observeGranotOwnerCommandResult({
    replayed: true,
    command: "confirmGranotBooking",
    case_kind: "booking",
    case_resolved: true,
  });
  assert.deepEqual(logs.keys(), [
    "granot_lifecycle.owner_command.applied",
    "granot_lifecycle.booking_case.resolved",
    "granot_lifecycle.owner_command.replayed",
  ]);
});
