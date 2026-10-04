import assert from "node:assert/strict";
import { mock, test } from "node:test";
import mongoose from "mongoose";
import { logger } from "../../logger";
import {
  GRANOT_LIFECYCLE_HEALTH_STATE_COLLECTION,
  GRANOT_LIFECYCLE_HEALTH_STATE_INDEXES,
  GranotLifecycleHealthState,
  getGranotLifecycleHealthStateModel,
} from "../../models/GranotLifecycleHealthState";
import { evaluateGranotLifecycleAlerts } from "./alerts";
import {
  GRANOT_LIFECYCLE_HEALTH_RETENTION_MS,
  GRANOT_LIFECYCLE_HEALTH_STALE_MS,
  bucketStart,
  incrementGranotLifecycleHealthCounter,
  isHealthWindowCovered,
  resetGranotLifecycleHealthStateMissedWrite,
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

function bucket(metric: "capture_failed" | "claim_recovered" | "owner_command_conflict", minutesAgo: number, count: number, dimension = "all") {
  return {
    metric,
    dimension,
    bucket_start: bucketStart(new Date(NOW.getTime() - minutesAgo * 60 * 1000)),
    count,
  };
}

test("health state collection is bounded: per-minute buckets, 48h TTL and a unique bucket fence", () => {
  assert.equal(GranotLifecycleHealthState.collection.collectionName, GRANOT_LIFECYCLE_HEALTH_STATE_COLLECTION);
  assert.equal(GRANOT_LIFECYCLE_HEALTH_RETENTION_MS, 48 * HOUR);
  assert.equal(bucketStart(NOW).toISOString(), "2026-10-03T12:00:00.000Z");
  const indexes = GranotLifecycleHealthState.schema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>;
  const fence = indexes.find(([, options]) => options.name === "granot_lifecycle_health_bucket_unique");
  assert.deepEqual(fence?.[0], GRANOT_LIFECYCLE_HEALTH_STATE_INDEXES[0].key);
  assert.equal(fence?.[1].unique, true);
  const ttl = indexes.find(([, options]) => options.name === "granot_lifecycle_health_expires_ttl");
  assert.equal(ttl?.[1].expireAfterSeconds, 0);
});

test("health state rejects payload-like fields", () => {
  const row = new GranotLifecycleHealthState({
    _id: "coverage",
    kind: "coverage",
    payload: { email: "owner@example.invalid" },
  } as never);
  assert.equal(JSON.stringify(row.toObject()).includes("owner@example.invalid"), false);
});

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

test("bucket sums respect the 24h and 1h lookbacks and closed conflict codes", () => {
  const counters = summarizeGranotLifecycleHealthCounters({
    coverage: warmCoverage(),
    now: NOW,
    buckets: [
      bucket("capture_failed", 5, 2),
      bucket("capture_failed", 23 * 60, 1),
      bucket("capture_failed", 25 * 60, 9),
      bucket("claim_recovered", 10, 4),
      bucket("claim_recovered", 59, 2),
      bucket("claim_recovered", 61, 7),
      bucket("owner_command_conflict", 30, 1, "GRANOT_CASE_REVISION_CONFLICT"),
      bucket("owner_command_conflict", 31, 2, "GRANOT_CASE_REVISION_CONFLICT"),
      bucket("owner_command_conflict", 90, 1, "DOMAIN_REVISION_CONFLICT"),
      bucket("owner_command_conflict", 26 * 60, 5, "DOMAIN_REVISION_CONFLICT"),
      bucket("capture_failed", -5, 100),
    ],
  });
  assert.equal(counters.capture_failures_24h, 3);
  assert.equal(counters.claim_recoveries_1h, 6);
  assert.deepEqual(counters.command_conflicts_24h, [
    { code: "DOMAIN_REVISION_CONFLICT", count: 1 },
    { code: "GRANOT_CASE_REVISION_CONFLICT", count: 3 },
  ]);
  const alerts = evaluateGranotLifecycleAlerts({
    oldest_due_age_ms: null,
    oldest_due_threshold_since: null,
    dead_letter_count: 0,
    capture_503_count_24h: counters.capture_failures_24h,
    claim_recoveries_1h: counters.claim_recoveries_1h,
    capture_to_decision_samples_24h: [],
    ringcentral_lease_held: false,
    ringcentral_lease_age_ms: null,
    source_rates: [],
  }, NOW);
  assert.equal(alerts.find((alert) => alert.code === "capture_unavailable")?.state, "firing");
  assert.equal(alerts.find((alert) => alert.code === "claim_recovery_rate")?.state, "firing");
});

test("a miss noted while Mongo is unreachable is fenced into coverage.gap_at on the next reconnection", async (t) => {
  resetGranotLifecycleHealthStateMissedWrite();
  const model = getGranotLifecycleHealthStateModel();
  const writes: Array<{ filter: unknown; update: unknown }> = [];
  const updateOne = mock.method(model, "updateOne", (async (filter: unknown, update: unknown) => {
    writes.push({ filter, update });
    return { acknowledged: true };
  }) as never);
  const warn = mock.method(logger, "warn", () => undefined);
  t.after(() => {
    updateOne.mock.restore();
    warn.mock.restore();
    delete (mongoose.connection as unknown as { readyState?: number }).readyState;
    resetGranotLifecycleHealthStateMissedWrite();
  });
  const at = new Date("2026-10-03T12:00:00.000Z");
  // This unit process has no Mongo connection: the capture-failure count is a noted miss, not a write.
  await incrementGranotLifecycleHealthCounter("capture_failed", "all", at);
  assert.equal(writes.length, 0);
  assert.equal(warn.mock.calls.length, 1);
  // The driver reconnects before this process writes health state again: the miss becomes durable.
  Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
  mongoose.connection.emit("reconnected");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [{
    filter: { _id: "coverage" },
    update: { $setOnInsert: { kind: "coverage", counters_since: at }, $max: { gap_at: at } },
  }]);
  // Fenced once: a second reconnection has nothing left to write.
  mongoose.connection.emit("connected");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
});
