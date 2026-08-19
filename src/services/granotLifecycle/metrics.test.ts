import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getGranotLifecycleClaimRecoveriesTotal,
  getGranotLifecycleDeadLettersTotal,
  getGranotLifecycleOldestDueSeconds,
  getGranotLifecycleOpenBookingCases,
  getGranotLifecycleQueueDue,
  getGranotLifecycleTechnicalRetriesTotal,
  incrementGranotLifecycleClaimRecoveries,
  incrementGranotLifecycleDeadLetters,
  incrementGranotLifecycleTechnicalRetries,
  resetGranotLifecycleMetrics,
  setGranotLifecycleOldestDueSeconds,
  setGranotLifecycleOpenBookingCases,
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

test("[AC-18][AC-19] Booking-case gauge is current cardinality, not an evidence counter", () => {
  resetGranotLifecycleMetrics();
  setGranotLifecycleOpenBookingCases("create_missing_booking", 1);
  setGranotLifecycleOpenBookingCases("create_missing_booking", 1);
  setGranotLifecycleOpenBookingCases("review_existing_booking", 2);
  assert.equal(getGranotLifecycleOpenBookingCases("create_missing_booking"), 1);
  assert.equal(getGranotLifecycleOpenBookingCases("review_existing_booking"), 2);
});
