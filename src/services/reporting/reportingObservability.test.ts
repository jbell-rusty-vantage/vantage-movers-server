import assert from "node:assert/strict";
import test from "node:test";
import {
  findReportingStuckRuns,
  REPORTING_OBSERVABILITY_EVENT_KEYS,
  REPORTING_PHASE_STUCK_THRESHOLD_MS,
} from "./reportingObservability";

test("reporting observability defines operational alert event keys", () => {
  assert.match(REPORTING_OBSERVABILITY_EVENT_KEYS.oauthHealthFailed, /^reporting\./);
  assert.match(REPORTING_OBSERVABILITY_EVENT_KEYS.verificationMismatch, /^reporting\./);
  assert.match(REPORTING_OBSERVABILITY_EVENT_KEYS.liveTestJanitorCompleted, /^reporting\./);
  assert.doesNotMatch(
    Object.values(REPORTING_OBSERVABILITY_EVENT_KEYS).join(" "),
    /success|routine/i,
  );
});

test("findReportingStuckRuns respects phase age threshold", () => {
  const nowMs = Date.now();
  const stuck = findReportingStuckRuns({
    candidates: [
      {
        runId: "a",
        phase: "writing",
        updatedAtMs: nowMs - REPORTING_PHASE_STUCK_THRESHOLD_MS - 1,
      },
      {
        runId: "b",
        phase: "querying",
        updatedAtMs: nowMs - 60_000,
      },
    ],
    nowMs,
    phaseThresholdMs: REPORTING_PHASE_STUCK_THRESHOLD_MS,
  });
  assert.deepEqual(stuck.map((item) => item.runId), ["a"]);
});
