import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeCaptureHealth,
  webhookSilenceWindowStart,
  type CaptureHealthFacts,
} from "./ownerCoverage";
import { ownerCoverageDtoSchema } from "./dto";
import type { Staffing } from "../numberActivity/staffedClock";

// ---------------------------------------------------------------------------
// S5c-HEALTH (C20): `capture_health`, fixed clock, America/New_York staffing
// ---------------------------------------------------------------------------

const staffing: Staffing = {
  timezone: "America/New_York",
  staffed_hours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start_minute: 480, end_minute: 1200 })),
};
const SUBSCRIPTION_ID = "882f9c2b-1a2b-4c3d-9e8f-0123456789ab";
const ALL = "/restapi/v1.0/account/~/telephony/sessions";
const T = (iso: string) => new Date(iso);
// Tue 2026-09-22 11:00 EDT
const NOW = T("2026-09-22T15:00:00.000Z");

function facts(over: Partial<CaptureHealthFacts> = {}): CaptureHealthFacts {
  const now = over.now ?? NOW;
  return {
    now,
    webhook_enabled: true,
    staffing,
    sync_mode: "shadow",
    reconcile: {
      scope: "call_log_all_directions",
      known_complete_through: new Date(+now - 10 * 60_000),
      quarantined_records: [],
      last_run: { started_at: new Date(+now - 4 * 60_000), finished_at: new Date(+now - 3 * 60_000) },
    },
    sweep: null,
    subscriptions: [
      { subscriptionId: SUBSCRIPTION_ID, status: "Active", expirationTime: T("2046-09-17T06:15:00.000Z"), updatedAt: T("2026-09-20T06:15:00.000Z"), eventFilters: [ALL] },
    ],
    latest_receipt_at: new Date(+now - 2 * 60_000),
    receipts_1h: 140,
    renewal_outcome: null,
    call_log_calls_in_window: 6,
    in_progress_calls: 1,
    pending_finalization: 0,
    ...over,
  };
}
const parseHealth = (value: unknown) => ownerCoverageDtoSchema.shape.capture_health.parse(value);

test("C20 degraded: 30 staffed minutes without a receipt while the Call Log shows calls", () => {
  const silent = facts({ latest_receipt_at: T("2026-09-22T14:25:00.000Z"), receipts_1h: 0 });
  const health = composeCaptureHealth(silent);
  parseHealth(health);
  assert.equal(health.webhook.state, "degraded");
  assert.equal(health.status, "attention");
  assert.deepEqual(health.reasons, ["webhook_degraded"]);
  assert.equal(composeCaptureHealth({ ...silent, call_log_calls_in_window: 0 }).webhook.state, "healthy", "no calls in the window: silence is expected");
  assert.equal(composeCaptureHealth({ ...silent, latest_receipt_at: T("2026-09-22T14:31:00.000Z") }).webhook.state, "healthy", "29 staffed minutes");
  assert.equal(composeCaptureHealth({ ...silent, latest_receipt_at: null }).webhook.state, "degraded", "never received while calls exist");
  assert.equal(webhookSilenceWindowStart(NOW, staffing).toISOString(), "2026-09-22T14:30:00.000Z");
});

test("C20 down: expired subscription, provider-terminal status, missing subscription, failed renewal", () => {
  const expired = composeCaptureHealth(facts({
    subscriptions: [{ subscriptionId: SUBSCRIPTION_ID, status: "Active", expirationTime: T("2026-09-22T14:00:00.000Z"), updatedAt: T("2026-09-15T06:15:00.000Z"), eventFilters: [ALL] }],
  }));
  parseHealth(expired);
  assert.equal(expired.webhook.state, "down");
  assert.equal(expired.status, "broken");
  assert.deepEqual(expired.reasons, ["webhook_down"]);
  assert.equal(expired.webhook.subscription_expires_at, "2026-09-22T14:00:00.000Z");

  const blacklisted = composeCaptureHealth(facts({ subscriptions: [{ subscriptionId: SUBSCRIPTION_ID, status: "Blacklisted", expirationTime: T("2046-01-01T00:00:00.000Z"), eventFilters: [ALL] }] }));
  assert.equal(blacklisted.webhook.state, "down");

  const missing = composeCaptureHealth(facts({ subscriptions: [{ subscriptionId: "legacy-inbound-0001", status: "Active", eventFilters: [`${ALL}?direction=Inbound`] }] }));
  assert.equal(missing.webhook.state, "down", "an inbound-only legacy row is not the owned all-direction subscription");
  assert.equal(missing.webhook.subscription_id_suffix, null);

  const failed = composeCaptureHealth(facts({
    renewal_outcome: { finished_at: T("2026-09-22T06:15:05.000Z"), error_code: "SubscriptionOwnershipError" },
  }));
  assert.equal(failed.webhook.state, "down");
  assert.equal(failed.status, "broken");
  assert.equal(failed.webhook.last_renewal_error, "SubscriptionOwnershipError");
  const autoCreateOff = composeCaptureHealth(facts({
    renewal_outcome: { finished_at: T("2026-09-22T06:15:05.000Z"), error_code: "subscription_missing" },
  }));
  assert.equal(autoCreateOff.webhook.last_renewal_error, "subscription_missing");
  assert.equal(autoCreateOff.webhook.state, "healthy", "a cron `missing` outcome is not a failure while this read finds a live owned subscription (production 2026-09-24)");
  assert.equal(autoCreateOff.status, "ok");
  const stale = composeCaptureHealth(facts({
    renewal_outcome: { finished_at: T("2026-09-21T06:15:05.000Z"), error_code: "Error" },
  }));
  assert.equal(stale.webhook.state, "healthy", "a failure older than one cron period (26 h) no longer counts");
  const renewed = composeCaptureHealth(facts({
    renewal_outcome: { finished_at: T("2026-09-22T06:15:05.000Z"), error_code: null },
  }));
  assert.equal(renewed.webhook.state, "healthy");
  assert.equal(renewed.webhook.last_renewal_error, null);
});

test("C20 pending_finalization is attention; reasons list broken ones first", () => {
  const pending = composeCaptureHealth(facts({ in_progress_calls: 3, pending_finalization: 1 }));
  assert.equal(pending.status, "attention");
  assert.deepEqual(pending.reasons, ["pending_finalization"]);
  assert.equal(pending.in_progress_calls, 3);
  const all = composeCaptureHealth(facts({
    subscriptions: [],
    pending_finalization: 2,
    reconcile: { scope: "call_log_all_directions", quarantined_records: [{ first_failed_at: T("2026-09-20T00:00:00.000Z") }] },
  }));
  assert.equal(all.status, "broken");
  assert.deepEqual(all.reasons, ["webhook_down", "quarantine_over_24h", "pending_finalization"]);
});
