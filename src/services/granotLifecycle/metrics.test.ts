import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getGranotLifecycleClaimRecoveriesTotal,
  getGranotLifecycleDeadLettersTotal,
  getGranotLifecycleOldestDueSeconds,
  getGranotLifecycleQueueDue,
  getGranotLifecycleTechnicalRetriesTotal,
  incrementGranotLifecycleClaimRecoveries,
  incrementGranotLifecycleDeadLetters,
  incrementGranotLifecycleTechnicalRetries,
  resetGranotLifecycleMetrics,
  setGranotLifecycleOldestDueSeconds,
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
