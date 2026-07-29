import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRegistryRuntimeTelemetry,
  mergeDurableCompatibilityTelemetry,
  recordCompatibilityRead,
  recordDurableCompatibilityRead,
  recordRegistryResolverAttempt,
  recordRegistryResolverFailure,
  recordRegistryResolverSuccess,
  recordRegistryResolverStaleServe,
  resetRegistryRuntimeTelemetryForTests,
} from "./runtimeTelemetry";

test("runtime telemetry exposes bounded resolver health and compatibility counters", () => {
  resetRegistryRuntimeTelemetryForTests();
  const loadedAt = new Date("2026-07-29T12:00:00.000Z");
  const now = new Date("2026-07-29T12:01:00.000Z");

  recordRegistryResolverAttempt("ringcentral");
  recordRegistryResolverSuccess("ringcentral", {
    loadedAt,
    maxAgeMs: 300_000,
  });
  recordRegistryResolverFailure("ringcentral", "snapshot_refresh_failed");
  recordRegistryResolverStaleServe("ringcentral");
  recordCompatibilityRead("legacy_cpl_rates", "admin_list", loadedAt);

  const telemetry = getRegistryRuntimeTelemetry(now);
  assert.deepEqual(telemetry.resolvers.ringcentral, {
    mode: "snapshot",
    last_success_at: loadedAt.toISOString(),
    age_ms: 60_000,
    max_age_ms: 300_000,
    refresh_attempts: 1,
    refresh_failures: 1,
    last_error_code: "snapshot_refresh_failed",
    serving_stale: true,
  });
  assert.deepEqual(telemetry.compatibility_reads, [
    {
      path: "legacy_cpl_rates",
      consumer_category: "admin_list",
      count: 1,
      last_used_at: loadedAt.toISOString(),
    },
  ]);
});

test("durable compatibility recording falls back locally when persistence is unavailable", async () => {
  resetRegistryRuntimeTelemetryForTests();
  const usedAt = new Date("2026-07-29T12:00:00.000Z");

  await recordDurableCompatibilityRead(
    "legacy_cpl_rates",
    "admin_list",
    usedAt,
  );

  assert.deepEqual(
    getRegistryRuntimeTelemetry(usedAt).compatibility_reads,
    [
      {
        path: "legacy_cpl_rates",
        consumer_category: "admin_list",
        count: 1,
        last_used_at: usedAt.toISOString(),
      },
    ],
  );
});

test("durable compatibility events merge across process-local telemetry", () => {
  resetRegistryRuntimeTelemetryForTests();
  const telemetry = mergeDurableCompatibilityTelemetry(
    getRegistryRuntimeTelemetry(new Date("2026-07-29T12:02:00.000Z")),
    [
      {
        path: "legacy_cpl_rates",
        consumer_category: "admin_list",
        occurred_at: new Date("2026-07-29T12:01:00.000Z"),
      },
      {
        path: "legacy_cpl_rates",
        consumer_category: "admin_list",
        occurred_at: new Date("2026-07-29T12:02:00.000Z"),
      },
    ],
  );

  assert.deepEqual(telemetry.compatibility_reads, [
    {
      path: "legacy_cpl_rates",
      consumer_category: "admin_list",
      count: 2,
      last_used_at: "2026-07-29T12:02:00.000Z",
    },
  ]);
});
