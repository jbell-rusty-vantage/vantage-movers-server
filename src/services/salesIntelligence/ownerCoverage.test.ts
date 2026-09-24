import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeBudget,
  composeCallLogCapture,
  composeCaptureHealth,
  composeStage,
  pickOwnedSubscription,
  subscriptionIdSuffix,
  webhookSilenceWindowStart,
  type CaptureHealthFacts,
} from "./ownerCoverage";
import { ownerCoverageDtoSchema } from "./dto";
import type { Staffing } from "./outreach/staffing";

test("budget unknown is distinct from a known zero remaining", () => {
  assert.deepEqual(composeBudget(null, 8000), {
    status: "unknown",
    month: null,
    ceiling_cents: 8000,
    actual_cents: null,
    reserved_cents: null,
    remaining_cents: null,
  });
  assert.deepEqual(
    composeBudget({ month: "2026-09", ceiling_cents: 8000, actual_cents: 1000, reserved_cents: 250 }, 8000),
    {
      status: "known",
      month: "2026-09",
      ceiling_cents: 8000,
      actual_cents: 1000,
      reserved_cents: 250,
      remaining_cents: 6750,
    },
  );
  assert.equal(
    composeBudget({ month: "2026-09", ceiling_cents: 100, actual_cents: 80, reserved_cents: 40 }, 100).remaining_cents,
    0,
  );
});

test("empty stage counts keep oldest queued null instead of a false zero age", () => {
  assert.deepEqual(composeStage({ pending: 0, leased: 0, retry: 0, paused: 0, dead_letter: 0 }, null), {
    pending: 0,
    leased: 0,
    retry: 0,
    paused: 0,
    dead_letter: 0,
    oldest_queued_at: null,
  });
  assert.equal(
    composeStage({ pending: 2, leased: 0, retry: 0, paused: 0, dead_letter: 1 }, new Date("2026-09-19T12:00:00.000Z"))
      .oldest_queued_at,
    "2026-09-19T12:00:00.000Z",
  );
});

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
    renewal_event: null,
    call_log_calls_in_window: 6,
    in_progress_calls: 1,
    pending_finalization: 0,
    ...over,
  };
}
const parseHealth = (value: unknown) => ownerCoverageDtoSchema.shape.capture_health.unwrap().parse(value);

test("C20 healthy: ok, no reasons, and only a suffix of the subscription id", () => {
  const health = composeCaptureHealth(facts());
  parseHealth(health);
  assert.equal(health.status, "ok");
  assert.deepEqual(health.reasons, []);
  assert.equal(health.as_of, NOW.toISOString());
  assert.equal(health.webhook.state, "healthy");
  assert.equal(health.webhook.subscription_id_suffix, "6789ab");
  assert.equal(JSON.stringify(health).includes(SUBSCRIPTION_ID), false, "the full subscription id never leaves the server");
  assert.equal(health.webhook.subscription_expires_at, "2046-09-17T06:15:00.000Z");
  assert.equal(health.webhook.last_renewal_at, "2026-09-20T06:15:00.000Z");
  assert.equal(health.webhook.last_renewal_error, null);
  assert.equal(health.webhook.receipts_1h, 140);
  assert.equal(health.known_complete_through, "2026-09-22T14:50:00.000Z");
  assert.equal(health.call_log.last_reconcile_at, "2026-09-22T14:57:00.000Z");
  assert.equal(health.call_log.sync_mode, "shadow");
  assert.equal(health.in_progress_calls, 1);
  assert.equal(subscriptionIdSuffix("abc"), null);
  assert.equal(subscriptionIdSuffix("abcdefgh"), "efgh");
});

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

test("C20 not degraded when the silence falls in unstaffed hours (overnight, Sunday)", () => {
  // Wed 08:20 EDT; last receipt Tue 19:55 EDT: 5 + 20 = 25 staffed minutes.
  const overnight = facts({ now: T("2026-09-23T12:20:00.000Z"), latest_receipt_at: T("2026-09-22T23:55:00.000Z") });
  assert.equal(composeCaptureHealth(overnight).webhook.state, "healthy");
  assert.equal(composeCaptureHealth({ ...overnight, now: T("2026-09-23T12:25:00.000Z") }).webhook.state, "degraded", "30 staffed minutes at 08:25");
  // Sunday midday; last receipt Saturday 19:59 EDT: 1 staffed minute.
  assert.equal(composeCaptureHealth(facts({ now: T("2026-09-20T18:00:00.000Z"), latest_receipt_at: T("2026-09-19T23:59:00.000Z") })).webhook.state, "healthy");
  // Monday 08:15 EDT; last receipt Saturday 19:50 EDT: 10 + 15 = 25.
  const monday = facts({ now: T("2026-09-21T12:15:00.000Z"), latest_receipt_at: T("2026-09-19T23:50:00.000Z") });
  assert.equal(composeCaptureHealth(monday).webhook.state, "healthy");
  assert.equal(webhookSilenceWindowStart(monday.now, staffing).toISOString(), "2026-09-19T23:45:00.000Z", "the window reaches back across Sunday");
});

test("C20 DST boundary: the staffed clock follows EDT to EST (2026-11-01)", () => {
  // Saturday 2026-10-31 19:50 EDT (23:50Z); Monday 2026-11-02 08:20 EST (13:20Z): 10 + 20 = 30.
  const receipt = T("2026-10-31T23:50:00.000Z");
  assert.equal(composeCaptureHealth(facts({ now: T("2026-11-02T13:20:00.000Z"), latest_receipt_at: receipt })).webhook.state, "degraded");
  assert.equal(composeCaptureHealth(facts({ now: T("2026-11-02T13:15:00.000Z"), latest_receipt_at: receipt })).webhook.state, "healthy", "25 staffed minutes; a fixed -4 h offset would say 75");
  assert.equal(webhookSilenceWindowStart(T("2026-11-02T13:20:00.000Z"), staffing).toISOString(), "2026-10-31T23:50:00.000Z");
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
    renewal_event: { event_key: "sales_intelligence.webhook_subscription.failed", occurred_at: T("2026-09-22T06:15:05.000Z"), error_name: "SubscriptionOwnershipError" },
  }));
  assert.equal(failed.webhook.state, "down");
  assert.equal(failed.status, "broken");
  assert.equal(failed.webhook.last_renewal_error, "SubscriptionOwnershipError");
  const autoCreateOff = composeCaptureHealth(facts({
    renewal_event: { event_key: "sales_intelligence.webhook_subscription.missing", occurred_at: T("2026-09-22T06:15:05.000Z"), error_name: null },
  }));
  assert.equal(autoCreateOff.webhook.last_renewal_error, "subscription_missing");
  const stale = composeCaptureHealth(facts({
    renewal_event: { event_key: "sales_intelligence.webhook_subscription.failed", occurred_at: T("2026-09-21T06:15:05.000Z"), error_name: "Error" },
  }));
  assert.equal(stale.webhook.state, "healthy", "a failure older than one cron period (26 h) was followed by a silent noop run");
  const renewed = composeCaptureHealth(facts({
    renewal_event: { event_key: "sales_intelligence.webhook_subscription.renewed", occurred_at: T("2026-09-22T06:15:05.000Z"), error_name: null },
  }));
  assert.equal(renewed.webhook.state, "healthy");
  assert.equal(renewed.webhook.last_renewal_error, null);
});

test("C20 quarantine: > 24 h is broken, any other quarantine is attention", () => {
  const withQuarantine = (firstFailed: string) => facts({
    reconcile: { scope: "call_log_all_directions", known_complete_through: null, quarantined_records: [{ first_failed_at: T(firstFailed) }, { first_failed_at: T("2026-09-22T14:00:00.000Z") }], last_run: null },
  });
  const old = composeCaptureHealth(withQuarantine("2026-09-21T14:59:00.000Z"));
  parseHealth(old);
  assert.equal(old.status, "broken");
  assert.deepEqual(old.reasons, ["quarantine_over_24h"]);
  assert.equal(old.call_log.quarantined_count, 2);
  assert.equal(old.call_log.oldest_quarantined_at, "2026-09-21T14:59:00.000Z");
  assert.equal(old.known_complete_through, null);
  assert.equal(old.call_log.last_reconcile_at, null);
  const fresh = composeCaptureHealth(withQuarantine("2026-09-22T12:00:00.000Z"));
  assert.equal(fresh.status, "attention");
  assert.deepEqual(fresh.reasons, ["quarantine"]);
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

test("C20 off: the webhook flag off reports state off and hides webhook facts", () => {
  const off = composeCaptureHealth(facts({
    webhook_enabled: false, subscriptions: [], latest_receipt_at: null, receipts_1h: 5,
    renewal_event: { event_key: "sales_intelligence.webhook_subscription.failed", occurred_at: NOW, error_name: "Error" },
  }));
  parseHealth(off);
  assert.equal(off.status, "ok");
  assert.deepEqual(off.webhook, { state: "off", subscription_id_suffix: null, subscription_expires_at: null, last_receipt_at: null, receipts_1h: 0, last_renewal_at: null, last_renewal_error: null });
});

test("C20 last_sweep keeps the call_log_capture shape and adds recovered_calls", () => {
  const sweep = {
    scope: "call_log_sweep",
    consecutive_drift_runs: 1,
    last_run: { started_at: T("2026-09-22T07:40:00.000Z"), error_code: null, from: T("2026-09-20T19:40:00.000Z"), to: T("2026-09-22T03:40:00.000Z"),
      provider_records: 900, stored_in_latest_version: 880, applied_changes: 22, missing_before: 5, stale_before: 15, provisional_after_horizon: 0, quarantined: 0 },
  };
  const health = composeCaptureHealth(facts({ sweep }));
  parseHealth(health);
  const legacy = composeCallLogCapture(facts().reconcile, sweep, "shadow").last_sweep!;
  assert.deepEqual(health.call_log.last_sweep, { ...legacy, recovered_calls: 20 });
  const partial = composeCaptureHealth(facts({ sweep: { ...sweep, last_run: { ...sweep.last_run, applied_changes: 3 } } }));
  assert.equal(partial.call_log.last_sweep?.recovered_calls, 3, "only drift the sweep actually applied");
  assert.equal(composeCaptureHealth(facts()).call_log.last_sweep, null);
});

test("C20 pickOwnedSubscription prefers a live row, then the latest expiry", () => {
  const rows = [
    { subscriptionId: "deleted-000001", status: "Deleted", expirationTime: T("2046-01-01T00:00:00.000Z"), eventFilters: [ALL] },
    { subscriptionId: "older-0000001", status: "Active", expirationTime: T("2026-10-01T00:00:00.000Z"), eventFilters: [ALL] },
    { subscriptionId: "newer-0000002", status: "Active", expirationTime: T("2046-01-01T00:00:00.000Z"), eventFilters: [ALL, "/restapi/v1.0/glip/posts"] },
  ];
  assert.equal(pickOwnedSubscription(rows)?.subscriptionId, "newer-0000002");
  assert.equal(pickOwnedSubscription(rows.slice(0, 1))?.subscriptionId, "deleted-000001");
  assert.equal(pickOwnedSubscription([]), null);
});
