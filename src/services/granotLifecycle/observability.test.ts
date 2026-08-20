import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
} from "../observability";
import { DomainCommandIdempotencyConflictError } from "../domainCommands/types";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import {
  getGranotLifecycleCommandConflictsTotal,
  resetGranotLifecycleMetrics,
} from "./metrics";
import {
  GRANOT_LIFECYCLE_EVENT_ALIASES,
  GRANOT_LIFECYCLE_EVENT_CATALOG,
  emitGranotLifecycleEvent,
  maskLifecycleId,
  normalizeGranotLifecycleEventKey,
  observeGranotOwnerCommandConflict,
  observeGranotOwnerCommandResult,
  sanitizeGranotLifecycleEventDetails,
} from "./observability";

test("[AC-35][AC-37] Unit 30 event catalog is frozen and aliases are one-way", () => {
  assert.deepEqual([...GRANOT_LIFECYCLE_EVENT_CATALOG], [
    "granot_lifecycle.capture.failed",
    "granot_lifecycle.queue.publish_failed",
    "granot_lifecycle.processing.completed",
    "granot_lifecycle.technical_retry.scheduled",
    "granot_lifecycle.dead_letter.entered",
    "granot_lifecycle.manual_requeue",
    "granot_lifecycle.booking_case.opened",
    "granot_lifecycle.booking_case.refreshed",
    "granot_lifecycle.booking_case.resolved",
    "granot_lifecycle.release_case.opened",
    "granot_lifecycle.release_case.refreshed",
    "granot_lifecycle.release_case.resolved",
    "granot_lifecycle.booking_discrepancy.opened",
    "granot_lifecycle.booking_discrepancy.refreshed",
    "granot_lifecycle.booking_discrepancy.resolved",
    "granot_lifecycle.release_discrepancy.opened",
    "granot_lifecycle.release_discrepancy.refreshed",
    "granot_lifecycle.release_discrepancy.resolved",
    "granot_lifecycle.owner_command.applied",
    "granot_lifecycle.owner_command.replayed",
    "granot_lifecycle.owner_command.conflict",
    "granot_lifecycle.activation.committed",
    "ringcentral.granot_adoption.adopted",
    "ringcentral.granot_adoption.conflict",
  ]);
  assert.equal(
    normalizeGranotLifecycleEventKey("granot_lifecycle.booking_case_opened"),
    "granot_lifecycle.booking_case.opened",
  );
  assert.equal(
    normalizeGranotLifecycleEventKey("granot_lifecycle.dead_letter"),
    "granot_lifecycle.dead_letter.entered",
  );
  assert.equal(
    normalizeGranotLifecycleEventKey("granot_lifecycle.technical_retry"),
    "granot_lifecycle.technical_retry.scheduled",
  );
  assert.equal(
    normalizeGranotLifecycleEventKey("ringcentral.call_lead.adopted"),
    "ringcentral.granot_adoption.adopted",
  );
  assert.equal(
    Object.values(GRANOT_LIFECYCLE_EVENT_ALIASES).every((key) =>
      (GRANOT_LIFECYCLE_EVENT_CATALOG as readonly string[]).includes(key),
    ),
    true,
  );
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

test("[AC-35] sanitizer masks identifiers case-insensitively and retains bounded conflict codes", () => {
  assert.deepEqual(sanitizeGranotLifecycleEventDetails({
    Receipt_ID: "aaaaaaaaaaaaaaaaaaaaaaaa",
    Conflict_Code: "DOMAIN_REVISION_CONFLICT",
  }), {
    receipt_id: "aaaaaa...aaaa",
    conflict_code: "DOMAIN_REVISION_CONFLICT",
  });
});

test("[AC-35] unknown catalog keys are dropped and emission never throws", async () => {
  clearCapturedOperationalEvents();
  await emitGranotLifecycleEvent({
    eventKey: "granot_lifecycle.not_a_real_event",
    summary: "Must not persist.",
    details: { payload: { secret: true } },
  });
  assert.equal(getCapturedOperationalEvents().length, 0);
  await emitGranotLifecycleEvent({
    eventKey: "granot_lifecycle.booking_case_opened",
    summary: "Opened via alias.",
    details: { kind: "booking", case_id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
  });
  const events = getCapturedOperationalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.input.eventKey, "granot_lifecycle.booking_case.opened");
  assert.equal(events[0]?.input.details?.kind, "booking");
  assert.equal(JSON.stringify(events).includes("bbbbbbbbbbbbbbbbbbbbbbbb"), false);
});

test("[AC-31][AC-37] apply/replay/conflict stay distinguishable and replay emits no resolve", async () => {
  resetGranotLifecycleMetrics();
  clearCapturedOperationalEvents();
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
  const keys = getCapturedOperationalEvents().map((event) => event.input.eventKey);
  assert.deepEqual(keys, [
    "granot_lifecycle.owner_command.applied",
    "granot_lifecycle.booking_case.resolved",
    "granot_lifecycle.owner_command.replayed",
  ]);
});

test("[AC-35] owner command conflicts increment closed codes only", async () => {
  resetGranotLifecycleMetrics();
  clearCapturedOperationalEvents();
  await observeGranotOwnerCommandConflict(new DomainCommandIdempotencyConflictError());
  await observeGranotOwnerCommandConflict(
    new GranotLifecycleError("race", GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT, 409),
  );
  await observeGranotOwnerCommandConflict(
    new GranotLifecycleError("other", GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED, 400),
  );
  assert.equal(
    getGranotLifecycleCommandConflictsTotal("DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT"),
    1,
  );
  assert.equal(
    getGranotLifecycleCommandConflictsTotal("GRANOT_CASE_REVISION_CONFLICT"),
    1,
  );
  assert.equal(getGranotLifecycleCommandConflictsTotal("VALIDATION_FAILED"), 0);
  const keys = getCapturedOperationalEvents().map((event) => event.input.eventKey);
  assert.deepEqual(keys, [
    "granot_lifecycle.owner_command.conflict",
    "granot_lifecycle.owner_command.conflict",
  ]);
});
