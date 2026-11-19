import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyAlertTransition,
  evaluateGranotLifecycleAlerts,
} from "./alerts";

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

test("[AC-37] repeated evaluation does not fan out: only open/clear transitions emit", () => {
  assert.equal(classifyAlertTransition("firing", false), "firing");
  assert.equal(classifyAlertTransition("firing", true), null);
  assert.equal(classifyAlertTransition("ok", true), "recovered");
  assert.equal(classifyAlertTransition("insufficient_data", true), null);
  assert.equal(classifyAlertTransition("ok", false), null);
  assert.equal(classifyAlertTransition("insufficient_data", false), null);
});
