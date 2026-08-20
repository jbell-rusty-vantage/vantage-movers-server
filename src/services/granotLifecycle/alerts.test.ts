import assert from "node:assert/strict";
import { test } from "node:test";
import { GRANOT_LIFECYCLE_ALERT_THRESHOLDS } from "../../config/domain/granotLifecycle";
import {
  classifyAlertTransition,
  evaluateGranotLifecycleAlerts,
  nearestRankP95,
} from "./alerts";
import { GRANOT_LIFECYCLE_ALERT_CODES } from "./observability";

const emptySnapshot = {
  oldest_due_age_ms: null,
  oldest_due_threshold_since: null,
  dead_letter_count: 0,
  capture_503_count_24h: 0,
  claim_recoveries_1h: 0,
  capture_to_decision_samples_24h: [],
  ringcentral_lease_held: false,
  ringcentral_lease_age_ms: null,
  source_rates: [],
};

function byCode(code: string) {
  return evaluateGranotLifecycleAlerts(emptySnapshot).find((alert) => alert.code === code);
}

test("[AC-37][AC-38] Unit 30 rollout alert codes stay frozen", () => {
  assert.deepEqual([...GRANOT_LIFECYCLE_ALERT_CODES], [
    "oldest_due_exceeded",
    "dead_letter_present",
    "capture_unavailable",
    "claim_recovery_rate",
    "capture_to_decision_p95",
    "ringcentral_lease_held",
    "source_ambiguity_policy_blocked_rate",
  ]);
  assert.equal(GRANOT_LIFECYCLE_ALERT_THRESHOLDS.oldest_due_ms, 15 * 60 * 1000);
  assert.equal(GRANOT_LIFECYCLE_ALERT_THRESHOLDS.oldest_due_continuity_ms, 10 * 60 * 1000);
  assert.equal(GRANOT_LIFECYCLE_ALERT_THRESHOLDS.capture_to_decision_p95_ms, 10 * 60 * 1000);
  assert.equal(GRANOT_LIFECYCLE_ALERT_THRESHOLDS.source_ambiguity_policy_blocked_rate, 0.05);
});

test("[AC-37] oldest due fires only after 15 minutes plus 10 minutes continuity", () => {
  const now = new Date("2026-08-19T12:30:00.000Z");
  const ok = evaluateGranotLifecycleAlerts({ ...emptySnapshot, oldest_due_age_ms: 25 * 60 * 1000, oldest_due_threshold_since: new Date("2026-08-19T12:20:00.001Z") }, now);
  const firing = evaluateGranotLifecycleAlerts({ ...emptySnapshot, oldest_due_age_ms: 25 * 60 * 1000, oldest_due_threshold_since: new Date("2026-08-19T12:20:00.000Z") }, now);
  assert.equal(ok.find((alert) => alert.code === "oldest_due_exceeded")?.state, "ok");
  assert.equal(firing.find((alert) => alert.code === "oldest_due_exceeded")?.state, "firing");
  assert.equal(firing.find((alert) => alert.code === "oldest_due_exceeded")?.threshold, 15 * 60 * 1000);
});

test("[AC-31] insufficient data never recovers an active alert", () => {
  assert.equal(classifyAlertTransition("insufficient_data", true), null);
  assert.equal(classifyAlertTransition("ok", true), "recovered");
});

test("[AC-37] any current dead letter fires and zero is ok", () => {
  assert.equal(byCode("dead_letter_present")?.state, "ok");
  const firing = evaluateGranotLifecycleAlerts({ ...emptySnapshot, dead_letter_count: 1 });
  assert.equal(firing.find((alert) => alert.code === "dead_letter_present")?.state, "firing");
});

test("[AC-37] capture 503 and claim-recovery windows use exact thresholds", () => {
  assert.equal(
    evaluateGranotLifecycleAlerts({ ...emptySnapshot, capture_503_count_24h: 1 })
      .find((alert) => alert.code === "capture_unavailable")?.state,
    "firing",
  );
  assert.equal(
    evaluateGranotLifecycleAlerts({ ...emptySnapshot, claim_recoveries_1h: 5 })
      .find((alert) => alert.code === "claim_recovery_rate")?.state,
    "ok",
  );
  assert.equal(
    evaluateGranotLifecycleAlerts({ ...emptySnapshot, claim_recoveries_1h: 6 })
      .find((alert) => alert.code === "claim_recovery_rate")?.state,
    "firing",
  );
});

test("[AC-31] empty p95 and source-rate samples are insufficient_data, not success", () => {
  const alerts = evaluateGranotLifecycleAlerts(emptySnapshot);
  assert.equal(alerts.find((alert) => alert.code === "capture_to_decision_p95")?.state, "insufficient_data");
  assert.equal(
    alerts.find((alert) => alert.code === "source_ambiguity_policy_blocked_rate")?.state,
    "insufficient_data",
  );
});

test("[AC-31] p95 uses deterministic nearest-rank and the 10-minute threshold", () => {
  assert.equal(nearestRankP95([]), null);
  assert.equal(nearestRankP95([100]), 100);
  assert.equal(nearestRankP95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 10);
  const below = evaluateGranotLifecycleAlerts({
    ...emptySnapshot,
    capture_to_decision_samples_24h: [60_000, 90_000, 120_000],
  });
  const above = evaluateGranotLifecycleAlerts({
    ...emptySnapshot,
    capture_to_decision_samples_24h: [11 * 60 * 1000],
  });
  assert.equal(below.find((alert) => alert.code === "capture_to_decision_p95")?.state, "ok");
  assert.equal(above.find((alert) => alert.code === "capture_to_decision_p95")?.state, "firing");
});

test("[AC-38] RingCentral lease and enabled-source ambiguity rate stay bounded", () => {
  const lease = evaluateGranotLifecycleAlerts({
    ...emptySnapshot,
    ringcentral_lease_held: true,
    ringcentral_lease_age_ms: 10 * 60 * 1000 + 1,
    source_rates: [
      { scope_ref: "aaaaaa...bbbb", numerator: 0, denominator: 10 },
      { scope_ref: "cccccc...dddd", numerator: 1, denominator: 10 },
    ],
  });
  assert.equal(lease.find((alert) => alert.code === "ringcentral_lease_held")?.state, "firing");
  const rates = lease.filter((alert) => alert.code === "source_ambiguity_policy_blocked_rate");
  assert.equal(rates.length, 2);
  assert.equal(rates[0]?.state, "ok");
  assert.equal(rates[1]?.state, "firing");
  assert.equal(rates[0]?.scope_ref, "aaaaaa...bbbb");
  assert.equal(JSON.stringify(rates).includes("@"), false);
});

test("[AC-37] repeated evaluation does not fan out: only open/clear transitions emit", () => {
  assert.equal(classifyAlertTransition("firing", false), "firing");
  assert.equal(classifyAlertTransition("firing", true), null);
  assert.equal(classifyAlertTransition("ok", true), "recovered");
  assert.equal(classifyAlertTransition("insufficient_data", true), null);
  assert.equal(classifyAlertTransition("ok", false), null);
  assert.equal(classifyAlertTransition("insufficient_data", false), null);
});
