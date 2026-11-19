import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

test("calls Active but every delivery refused (incident 2026-10-06): deliveries_refused recorded, no mutation; clears once a delivery is accepted (olr CW2)", async () => {
  const facts = { count: 120, last_refused_at: new Date(NOW.getTime() - 2 * 60_000), last_reason: "token_missing", accepted_since: false };
  const h = harness([callsRecord(), repSmsRecord()]);
  const asked: string[] = [];
  h.deps.store!.deliveryRefusals = async (id) => {
    asked.push(id);
    return id === "calls-1" ? facts : null;
  };
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "deliveries_refused");
  assert.equal(summary.calls.subscription_id, "calls-1");
  assert.equal(summary.calls.warnings, 1);
  assert.equal(outcomeOf(h, SUBSCRIPTION_HEALTH_SCOPE_CALLS)?.error_code, "deliveries_refused");
  assert.equal(summary.rep_sms.health, "ok", "the rep_sms subscription has no refusals");
  assert.deepEqual(asked, ["calls-1", "sms-1"]);
  assert.deepEqual(h.mutations, [], "the health check never replaces");

  const recovered = harness([callsRecord(), repSmsRecord()]);
  recovered.deps.store!.deliveryRefusals = async () => ({ ...facts, accepted_since: true });
  assert.equal((await runSubscriptionHealthCheck(recovered.deps)).calls.health, "ok");
});

test("rep_sms Active but its deliveries refused: deliveries_refused recorded (olr CW2)", async () => {
  const h = harness([callsRecord(), repSmsRecord()]);
  h.deps.store!.deliveryRefusals = async (id) =>
    id === "sms-1" ? { count: 4, last_refused_at: new Date(NOW.getTime() - 60_000), last_reason: "token_mismatch", accepted_since: false } : null;
  const summary = await runSubscriptionHealthCheck(h.deps);
  assert.equal(summary.calls.health, "ok");
  assert.equal(summary.rep_sms.health, "deliveries_refused");
  assert.equal(outcomeOf(h, SUBSCRIPTION_HEALTH_SCOPE_REP_SMS)?.error_code, "deliveries_refused");
  assert.deepEqual(h.mutations, []);
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
