import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callsHealthFromPlan,
  REP_SMS_NOT_CONNECTED,
  runSubscriptionHealthCheck,
  SUBSCRIPTION_HEALTH_CHECK_FAILED,
  SUBSCRIPTION_HEALTH_SCOPE_CALLS,
  SUBSCRIPTION_HEALTH_SCOPE_REP_SMS,
  type SubscriptionHealthDeps,
} from "./subscriptionHealth";
import {
  repSmsEventFilters,
  type OwnershipStore,
  type StoredSubscriptionMeta,
  type SubscriptionProvider,
  type SubscriptionRecord,
} from "./webhook-subscription-lifecycle";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const ADDRESS = "https://example.test/api/webhooks/ringcentral";
const CALLS_FILTERS = ["/restapi/v1.0/account/~/telephony/sessions"];
const MAILBOXES = ["101", "102"];
const DAY = 24 * 60 * 60_000;
const FAR = new Date(NOW.getTime() + 365 * DAY).toISOString();

function record(partial: Partial<SubscriptionRecord> & { id: string }): SubscriptionRecord {
  return {
    eventFilters: CALLS_FILTERS,
    transportType: "WebHook",
    address: ADDRESS,
    status: "Active",
    expiresIn: null,
    expirationTime: new Date(FAR),
    raw: { id: partial.id },
    ...partial,
  };
}

const callsRecord = (partial: Partial<SubscriptionRecord> = {}) => record({ id: "calls-1", ...partial });
const repSmsRecord = (partial: Partial<SubscriptionRecord> = {}) =>
  record({ id: "sms-1", eventFilters: repSmsEventFilters(MAILBOXES), ...partial });

const META: Record<string, StoredSubscriptionMeta> = {
  "calls-1": { purpose: "calls", verificationToken: "t1" },
  "sms-1": { purpose: "rep_sms", verificationToken: "t2" },
};

function harness(
  records: SubscriptionRecord[],
  options: { meta?: Record<string, StoredSubscriptionMeta>; enabled?: boolean; mailboxes?: string[]; listThrows?: boolean } = {},
) {
  const mutations: string[] = [];
  let lists = 0;
  const provider: SubscriptionProvider = {
    list: async () => {
      lists += 1;
      if (options.listThrows) throw new RangeError('{"errorCode":"CMN-301","message":"provider body must not leak"}');
      return records;
    },
    create: async () => mutations.push("create"),
    renew: async (id) => mutations.push(`renew:${id}`),
    remove: async (id) => {
      mutations.push(`delete:${id}`);
    },
    update: async (id) => mutations.push(`update:${id}`),
  };
  const stored = new Map(Object.entries(options.meta ?? META));
  const store: OwnershipStore = {
    ownedIds: async () => new Set(stored.keys()),
    record: async () => {
      mutations.push("record");
    },
    markStatus: async (id, status) => {
      mutations.push(`mark:${id}:${status}`);
    },
    meta: async () => new Map(stored),
  };
  const outcomes: Array<{ scope: string; error_code: string | null }> = [];
  const deps: SubscriptionHealthDeps = {
    provider,
    store,
    address: ADDRESS,
    now: () => NOW,
    eventFilters: async () => CALLS_FILTERS,
    enabled: async () => options.enabled ?? true,
    mailboxes: async () => options.mailboxes ?? MAILBOXES,
    recordOutcome: async (scope, outcome) => {
      assert.equal(outcome.started_at, NOW);
      outcomes.push({ scope, error_code: outcome.error_code });
    },
  };
  return { deps, mutations, outcomes, lists: () => lists };
}

const outcomeOf = (h: ReturnType<typeof harness>, scope: string) => h.outcomes.find((o) => o.scope === scope);

test("healthy both channels: ok, ok; one list(); two rows with a null error_code; no mutation", async () => {
  const h = harness([callsRecord(), repSmsRecord()]);
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.deepEqual(summary, {
    started_at: NOW.toISOString(),
    calls: { health: "ok", error_name: null, subscription_id: "calls-1", expires_at: FAR, warnings: 0 },
    rep_sms: { health: "ok", error_name: null, subscription_id: "sms-1", expires_at: FAR, mailboxes: 2, warnings: 0 },
  });
  assert.equal(h.lists(), 1, "both channels share one GET /subscription");
  assert.deepEqual(h.mutations, []);
  assert.deepEqual(h.outcomes, [
    { scope: SUBSCRIPTION_HEALTH_SCOPE_CALLS, error_code: null },
    { scope: SUBSCRIPTION_HEALTH_SCOPE_REP_SMS, error_code: null },
  ]);
});

test("calls expiring soon is still ok (the daily cron renews) and reports expires_at", async () => {
  const soon = new Date(NOW.getTime() + 2 * DAY);
  const h = harness([callsRecord({ expirationTime: soon }), repSmsRecord()]);
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "ok");
  assert.equal(summary.calls.expires_at, soon.toISOString());
  assert.deepEqual(h.mutations, []);
});

test("calls missing: subscription_missing recorded; a foreign same-address subscription is counted, never touched", async () => {
  const h = harness([record({ id: "foreign-1" }), repSmsRecord()]);
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "subscription_missing");
  assert.equal(summary.calls.subscription_id, null);
  assert.equal(summary.calls.warnings, 1);
  assert.equal(summary.rep_sms.health, "ok");
  assert.equal(outcomeOf(h, SUBSCRIPTION_HEALTH_SCOPE_CALLS)?.error_code, "subscription_missing");
  assert.deepEqual(h.mutations, [], "no create for the missing channel");
  assert.equal(h.lists(), 1);
});

test("calls blacklisted: blacklisted recorded; the health check never repairs", async () => {
  const h = harness([callsRecord({ status: "Blacklisted" }), repSmsRecord()]);
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "blacklisted");
  assert.equal(summary.calls.subscription_id, "calls-1");
  assert.equal(outcomeOf(h, SUBSCRIPTION_HEALTH_SCOPE_CALLS)?.error_code, "blacklisted");
  assert.deepEqual(h.mutations, []);
});

test("calls filter drift: the owned subscription no longer matches the all-direction filter", async () => {
  // An owned subscription carrying other filters is not a match for the `calls` plan, so the channel
  // reports what the plan reports: no matching owned subscription (classified `owned_other`).
  const h = harness([callsRecord({ eventFilters: ["/restapi/v1.0/account/~/extension/101/telephony/sessions"] }), repSmsRecord()]);
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "subscription_missing");
  assert.deepEqual(h.mutations, []);
});

test("calls plan mapping (pure): every plan action has one channel health", () => {
  const warnings: string[] = [];
  assert.equal(callsHealthFromPlan({ action: "noop", subscription_id: "a", expiration_time: null, warnings }), "ok");
  assert.equal(callsHealthFromPlan({ action: "renew", subscription_id: "a", expiration_time: null, warnings }), "ok");
  assert.equal(callsHealthFromPlan({ action: "create", warnings }), "subscription_missing");
  assert.equal(callsHealthFromPlan({ action: "repair", subscription_id: "a", health: "blacklisted", warnings }), "blacklisted");
  assert.equal(callsHealthFromPlan({ action: "repair", subscription_id: "a", health: "unknown", warnings }), "expired");
  assert.equal(callsHealthFromPlan({ action: "update", subscription_id: "a", reasons: ["filter_drift"], warnings }), "filter_drift");
  assert.equal(callsHealthFromPlan({ action: "update", subscription_id: "a", reasons: ["verification_token_missing"], warnings }), "token_missing");
});

test("rep_sms disabled: not_connected, skipped but still recorded; calls still evaluated", async () => {
  const h = harness([callsRecord(), repSmsRecord()], { enabled: false });
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "ok");
  assert.deepEqual(summary.rep_sms, {
    health: REP_SMS_NOT_CONNECTED,
    error_name: null,
    subscription_id: null,
    expires_at: null,
    mailboxes: 0,
    warnings: 0,
  });
  assert.equal(outcomeOf(h, SUBSCRIPTION_HEALTH_SCOPE_REP_SMS)?.error_code, REP_SMS_NOT_CONNECTED);
  assert.equal(h.lists(), 1);
});

test("rep_sms filter drift: the reviewed mailbox set changed; filter_drift recorded, no PUT", async () => {
  const h = harness([callsRecord(), repSmsRecord()], { mailboxes: ["101", "102", "103"] });
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.rep_sms.health, "filter_drift");
  assert.equal(summary.rep_sms.subscription_id, "sms-1");
  assert.equal(summary.rep_sms.mailboxes, 3);
  assert.equal(outcomeOf(h, SUBSCRIPTION_HEALTH_SCOPE_REP_SMS)?.error_code, "filter_drift");
  assert.deepEqual(h.mutations, []);
});

test("rep_sms missing and expired: the plan's health is taken as is", async () => {
  const missing = await runSubscriptionHealthCheck(harness([callsRecord()]).deps);
  assert.equal(missing.rep_sms.health, "subscription_missing");
  const unknown = await runSubscriptionHealthCheck(harness([callsRecord(), repSmsRecord({ status: "Pending" })]).deps);
  assert.equal(unknown.rep_sms.health, "expired");
});

test("provider throws: both rows record the error class name, list() ran once, the run does not throw", async () => {
  const h = harness([], { listThrows: true });
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.deepEqual(summary.calls, { health: SUBSCRIPTION_HEALTH_CHECK_FAILED, error_name: "RangeError", subscription_id: null, expires_at: null, warnings: 0 });
  assert.equal(summary.rep_sms.health, SUBSCRIPTION_HEALTH_CHECK_FAILED);
  assert.equal(summary.rep_sms.error_name, "RangeError");
  assert.equal(h.lists(), 1, "a rejected list() is shared too");
  assert.deepEqual(h.outcomes, [
    { scope: SUBSCRIPTION_HEALTH_SCOPE_CALLS, error_code: "RangeError" },
    { scope: SUBSCRIPTION_HEALTH_SCOPE_REP_SMS, error_code: "RangeError" },
  ]);
  assert.equal(JSON.stringify(summary).includes("CMN-301"), false, "no provider body in the summary");
});

test("outcome store failure is swallowed: the summary still reports the provider outcome", async () => {
  const h = harness([callsRecord(), repSmsRecord()]);
  h.deps.recordOutcome = async () => {
    throw new Error("store down");
  };
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "ok");
  assert.equal(summary.rep_sms.health, "ok");
});
