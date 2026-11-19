import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateGranotLifecycleAlerts } from "./alerts";
import {
  GRANOT_LIFECYCLE_HEALTH_STALE_MS,
  isHealthWindowCovered,
  summarizeGranotLifecycleHealthCounters,
} from "./healthState";

const NOW = new Date("2026-10-03T12:00:30.000Z");
const HOUR = 60 * 60 * 1000;

function warmCoverage(overrides: Partial<{ counters_since: Date; last_write_at: Date; gap_at: Date | null }> = {}) {
  return {
    counters_since: new Date(NOW.getTime() - 30 * HOUR),
    last_write_at: new Date(NOW.getTime() - 60 * 1000),
    gap_at: null,
    ...overrides,
  };
}


test("unseeded, stale or gapped windows read as unknown, never zero", () => {
  assert.equal(isHealthWindowCovered(null, NOW, 24 * HOUR), false);
  assert.equal(isHealthWindowCovered(warmCoverage(), NOW, 24 * HOUR), true);
  assert.equal(
    isHealthWindowCovered(warmCoverage({ counters_since: new Date(NOW.getTime() - 2 * HOUR) }), NOW, 24 * HOUR),
    false,
  );
  assert.equal(
    isHealthWindowCovered(warmCoverage({ counters_since: new Date(NOW.getTime() - 2 * HOUR) }), NOW, HOUR),
    true,
  );
  assert.equal(
    isHealthWindowCovered(
      warmCoverage({ last_write_at: new Date(NOW.getTime() - GRANOT_LIFECYCLE_HEALTH_STALE_MS - 1) }),
      NOW,
      HOUR,
    ),
    false,
  );
  assert.equal(
    isHealthWindowCovered(warmCoverage({ gap_at: new Date(NOW.getTime() - 3 * HOUR) }), NOW, 24 * HOUR),
    false,
  );
  assert.equal(
    isHealthWindowCovered(warmCoverage({ gap_at: new Date(NOW.getTime() - 3 * HOUR) }), NOW, HOUR),
    true,
  );

  const empty = summarizeGranotLifecycleHealthCounters({ coverage: null, buckets: [], now: NOW });
  assert.deepEqual(empty, {
    capture_failures_24h: null,
    claim_recoveries_1h: null,
    command_conflicts_24h: null,
  });
  const alerts = evaluateGranotLifecycleAlerts({
    oldest_due_age_ms: null,
    oldest_due_threshold_since: null,
    dead_letter_count: 0,
    capture_503_count_24h: empty.capture_failures_24h,
    claim_recoveries_1h: empty.claim_recoveries_1h,
    capture_to_decision_samples_24h: [],
    ringcentral_lease_held: false,
    ringcentral_lease_age_ms: null,
    source_rates: [],
  }, NOW);
  assert.equal(alerts.find((alert) => alert.code === "capture_unavailable")?.state, "insufficient_data");
  assert.equal(alerts.find((alert) => alert.code === "capture_unavailable")?.observed_value, null);
  assert.equal(alerts.find((alert) => alert.code === "claim_recovery_rate")?.state, "insufficient_data");
});

test("a warm empty window is a real zero and differs from unknown", () => {
  const counters = summarizeGranotLifecycleHealthCounters({ coverage: warmCoverage(), buckets: [], now: NOW });
  assert.deepEqual(counters, {
    capture_failures_24h: 0,
    claim_recoveries_1h: 0,
    command_conflicts_24h: [],
  });
});
