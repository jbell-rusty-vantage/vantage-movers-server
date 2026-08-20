import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES,
  getGranotLifecycleClaimRecoveriesTotal,
  getGranotLifecycleCommandConflictsTotal,
  getGranotLifecycleDeadLettersTotal,
  getGranotLifecycleDecisionToEffectSamples,
  getGranotLifecycleOldestDueSeconds,
  getGranotLifecycleOpenBookingCases,
  getGranotLifecycleOpenCases,
  getGranotLifecycleOpenDiscrepancies,
  getGranotLifecycleQueueDue,
  getGranotLifecycleReceiptsTotal,
  getGranotLifecycleTechnicalRetriesTotal,
  incrementGranotLifecycleClaimRecoveries,
  incrementGranotLifecycleCommandConflicts,
  incrementGranotLifecycleDeadLetters,
  incrementGranotLifecycleReceiptsTotal,
  incrementGranotLifecycleTechnicalRetries,
  recordGranotLifecycleDecisionToEffectMs,
  resetGranotLifecycleMetrics,
  setGranotLifecycleOldestDueSeconds,
  setGranotLifecycleOpenBookingCases,
  setGranotLifecycleOpenCases,
  setGranotLifecycleOpenDiscrepancies,
  setGranotLifecycleQueueDue,
} from "./metrics";

test("[AC-35] portion Unit 08 metrics accept only bounded error-code labels", () => {
  resetGranotLifecycleMetrics();
  incrementGranotLifecycleTechnicalRetries("dependency_failure");
  incrementGranotLifecycleDeadLetters("transaction_failure");
  incrementGranotLifecycleTechnicalRetries("Job Number 100");
  incrementGranotLifecycleDeadLetters("owner@example.invalid");
  incrementGranotLifecycleClaimRecoveries();
  setGranotLifecycleQueueDue(3);
  setGranotLifecycleOldestDueSeconds(12);
  assert.equal(getGranotLifecycleTechnicalRetriesTotal("dependency_failure"), 1);
  assert.equal(getGranotLifecycleDeadLettersTotal("transaction_failure"), 1);
  assert.equal(getGranotLifecycleTechnicalRetriesTotal("Job Number 100"), 0);
  assert.equal(getGranotLifecycleDeadLettersTotal("owner@example.invalid"), 0);
  assert.equal(getGranotLifecycleClaimRecoveriesTotal(), 1);
  assert.equal(getGranotLifecycleQueueDue(), 3);
  assert.equal(getGranotLifecycleOldestDueSeconds(), 12);
});

test("[AC-31][AC-35] Section 33 metric names stay exact and receipt labels stay closed", () => {
  resetGranotLifecycleMetrics();
  assert.deepEqual([...GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES], [
    "granot_lifecycle_receipts_total",
    "granot_lifecycle_queue_due",
    "granot_lifecycle_oldest_due_seconds",
    "granot_lifecycle_claim_recoveries_total",
    "granot_lifecycle_technical_retries_total",
    "granot_lifecycle_dead_letters_total",
    "granot_lifecycle_decisions_total",
    "granot_lifecycle_capture_to_decision_ms",
    "granot_lifecycle_decision_to_effect_ms",
    "granot_lifecycle_open_cases",
    "granot_lifecycle_open_discrepancies",
    "granot_lifecycle_command_conflicts_total",
    "ringcentral_call_log_runtime_ms",
    "ringcentral_adoptions_total",
    "ringcentral_call_log_lease_contention_total",
  ]);
  incrementGranotLifecycleReceiptsTotal({ channel: "granot_webhook", event_class: "lead_created" });
  incrementGranotLifecycleReceiptsTotal({ channel: "browser_extension", event_class: "none" });
  incrementGranotLifecycleReceiptsTotal({ channel: "granot_webhook", event_class: "create_form_lead" });
  incrementGranotLifecycleReceiptsTotal({ channel: "granot_webhook", event_class: "owner@example.invalid" });
  assert.equal(getGranotLifecycleReceiptsTotal({ channel: "granot_webhook", event_class: "lead_created" }), 1);
  assert.equal(getGranotLifecycleReceiptsTotal({ channel: "browser_extension", event_class: "none" }), 1);
  assert.equal(getGranotLifecycleReceiptsTotal({ channel: "granot_webhook", event_class: "create_form_lead" }), 0);
  recordGranotLifecycleDecisionToEffectMs(12);
  recordGranotLifecycleDecisionToEffectMs(-1);
  assert.deepEqual(getGranotLifecycleDecisionToEffectSamples(), [12]);
  incrementGranotLifecycleCommandConflicts("DOMAIN_REVISION_CONFLICT");
  incrementGranotLifecycleCommandConflicts("Job Number 100");
  assert.equal(getGranotLifecycleCommandConflictsTotal("DOMAIN_REVISION_CONFLICT"), 1);
  assert.equal(getGranotLifecycleCommandConflictsTotal("Job Number 100"), 0);
});

test("[AC-18][AC-19] Booking-case gauge is current cardinality, not an evidence counter", () => {
  resetGranotLifecycleMetrics();
  setGranotLifecycleOpenBookingCases("create_missing_booking", 1);
  setGranotLifecycleOpenBookingCases("create_missing_booking", 1);
  setGranotLifecycleOpenBookingCases("review_existing_booking", 2);
  assert.equal(getGranotLifecycleOpenBookingCases("create_missing_booking"), 1);
  assert.equal(getGranotLifecycleOpenBookingCases("review_existing_booking"), 2);
  setGranotLifecycleOpenCases("release", "release", 4);
  setGranotLifecycleOpenCases("release", "release", 3);
  setGranotLifecycleOpenDiscrepancies("booking", "booked_record_link_conflict", 2);
  setGranotLifecycleOpenDiscrepancies("booking", "owner@example.invalid", 9);
  assert.equal(getGranotLifecycleOpenCases("release", "release"), 3);
  assert.equal(getGranotLifecycleOpenDiscrepancies("booking", "booked_record_link_conflict"), 2);
  assert.equal(getGranotLifecycleOpenDiscrepancies("booking", "owner@example.invalid"), 0);
});
