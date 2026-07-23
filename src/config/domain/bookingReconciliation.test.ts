import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getBookingReconciliationConfig,
  parseBookingReconciliationReasons,
} from "./bookingReconciliation";

const envKeys = [
  "BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED",
  "BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS",
  "BOOKING_RECONCILIATION_AUTO_REMATCH_DELAYS_MINUTES",
  "BOOKING_RECONCILIATION_AUTO_REMATCH_BATCH_SIZE",
  "EMPLOYEE_BOOKING_PUBLIC_THROTTLE_WINDOW_SECONDS",
  "EMPLOYEE_BOOKING_PUBLIC_THROTTLE_PER_CLIENT_LIMIT",
  "EMPLOYEE_BOOKING_PUBLIC_THROTTLE_GLOBAL_LIMIT",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("parseBookingReconciliationReasons rejects unknown values", () => {
  assert.throws(
    () => parseBookingReconciliationReasons("matching_unavailable,unknown"),
    /Unknown booking reconciliation rematch reason/,
  );
});

test("getBookingReconciliationConfig reads configured delays and limits", () => {
  process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED = "true";
  process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS =
    "matching_unavailable,no_match";
  process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_DELAYS_MINUTES = "5,30";
  process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_BATCH_SIZE = "7";
  process.env.EMPLOYEE_BOOKING_PUBLIC_THROTTLE_WINDOW_SECONDS = "60";
  process.env.EMPLOYEE_BOOKING_PUBLIC_THROTTLE_PER_CLIENT_LIMIT = "4";
  process.env.EMPLOYEE_BOOKING_PUBLIC_THROTTLE_GLOBAL_LIMIT = "50";

  assert.deepEqual(getBookingReconciliationConfig(), {
    autoRematchEnabled: true,
    autoRematchReasons: ["matching_unavailable", "no_match"],
    autoRematchDelaysMinutes: [5, 30],
    autoRematchBatchSize: 7,
    publicThrottleWindowSeconds: 60,
    publicThrottlePerClientLimit: 4,
    publicThrottleGlobalLimit: 50,
  });
});
