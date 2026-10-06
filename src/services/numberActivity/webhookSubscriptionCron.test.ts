import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
  MAX_WEBHOOK_EXPIRES_IN_SECONDS,
  type OwnershipStore,
  type SubscriptionProvider,
  type SubscriptionRecord,
} from "../ringcentral/webhook-subscription-lifecycle";
import { runWebhookSubscriptionMaintenance, type WebhookSubscriptionMaintenanceDeps } from "./webhookSubscriptionCron";

const NOW = new Date("2026-09-23T06:15:00.000Z");
const ADDRESS = "https://example.test/api/webhooks/ringcentral";
const ALL = ["/restapi/v1.0/account/~/telephony/sessions"];
const DAY = 24 * 60 * 60_000;

function record(partial: Partial<SubscriptionRecord> & { id: string }): SubscriptionRecord {
  return {
    eventFilters: ALL,
    transportType: "WebHook",
    address: ADDRESS,
    status: "Active",
    expiresIn: null,
    expirationTime: new Date(NOW.getTime() + 365 * DAY),
    raw: { id: partial.id },
    ...partial,
  };
}

function harness(
  records: SubscriptionRecord[],
  owned: string[],
  options: { autoCreate?: boolean; failCreate?: boolean; purposes?: Record<string, "calls" | "rep_sms">; refusedIds?: string[]; tokenless?: string[] } = {},
) {
  const calls: string[] = [];
  const outcomes: Array<string | null> = [];
  const ownedIds = new Set(owned);
  const provider: SubscriptionProvider = {
    list: async () => records,
    create: async (input) => {
      calls.push(`create:${input.expiresIn}`);
      if (options.failCreate) throw new Error("provider refused");
      return { id: "new-1", status: "Active", expiresIn: input.expiresIn };
    },
    renew: async (id) => {
      calls.push(`renew:${id}`);
      return { id, status: "Active" };
    },
    remove: async (id) => {
      calls.push(`delete:${id}`);
    },
    update: async (id, input) => {
      calls.push(`update:${id}:${input.eventFilters.join("|")}:${input.address}`);
      return { id, status: "Active" };
    },
  };
  const store: OwnershipStore = {
    ownedIds: async () => ownedIds,
    record: async (raw) => {
      ownedIds.add((raw as { id: string }).id);
    },
    markStatus: async () => undefined,
    meta: async () =>
      new Map([...ownedIds].map((id) => [id, { purpose: options.purposes?.[id] ?? "calls", verificationToken: options.tokenless?.includes(id) ? null : "t" }])),
    deliveryRefusals: async (id) =>
      options.refusedIds?.includes(id)
        ? { count: 10, last_refused_at: new Date(NOW.getTime() - 60_000), last_reason: "token_missing", accepted_since: false }
        : null,
  };
  const deps: WebhookSubscriptionMaintenanceDeps = {
    provider,
    store,
    address: ADDRESS,
    now: () => NOW,
    eventFilters: async () => ALL,
    autoCreate: options.autoCreate ?? false,
    recordOutcome: async (outcome) => {
      outcomes.push(outcome.error_code);
    },
  };
  return { deps, calls, outcomes };
}

test("expiry: the lifecycle requests the longest documented WebHook lifetime (10 years, RINGCENTRAL-CAPTURE §2)", () => {
  assert.equal(MAX_WEBHOOK_EXPIRES_IN_SECONDS, 315_360_000);
  assert.equal(DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS, MAX_WEBHOOK_EXPIRES_IN_SECONDS);
});

test("owned healthy subscription: noop, no provider mutation, no event", async () => {
  const h = harness([record({ id: "owned" })], ["owned"]);
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "noop");
  assert.equal(summary.subscription_id, "owned");
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.outcomes, [null], "a healthy run is stored as the newest successful outcome");
});

test("owned subscription with under 7 days left is renewed; with more than 7 days it is left alone", async () => {
  const expiring = harness([record({ id: "owned", expirationTime: new Date(NOW.getTime() + 6 * DAY) })], ["owned"]);
  const summary = await runWebhookSubscriptionMaintenance(expiring.deps);
  assert.equal(summary.action, "renewed");
  assert.deepEqual(expiring.calls, ["renew:owned"]);
  assert.deepEqual(expiring.outcomes, [null]);

  const fine = harness([record({ id: "owned", expirationTime: new Date(NOW.getTime() + 8 * DAY) })], ["owned"]);
  assert.equal((await runWebhookSubscriptionMaintenance(fine.deps)).action, "noop");
  assert.deepEqual(fine.calls, []);
});

test("blacklisted owned subscription is repaired (delete + recreate at max expiry)", async () => {
  const h = harness([record({ id: "owned", status: "Blacklisted" })], ["owned"]);
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "repaired");
  assert.equal(summary.removed_subscription_id, "owned");
  assert.deepEqual(h.calls, ["delete:owned", `create:${MAX_WEBHOOK_EXPIRES_IN_SECONDS}`]);
  assert.deepEqual(h.outcomes, [null]);
});

test("foreign same-address subscription is never touched; missing owned one is reported, not created, when auto-create is off", async () => {
  const h = harness([record({ id: "foreign", status: "Blacklisted" })], []);
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "missing");
  assert.deepEqual(h.calls, [], "no create, no delete of the foreign one");
  assert.deepEqual(h.outcomes, ["subscription_missing"]);
});

test("auto-create on: creates the all-direction subscription at max expiry when none owned exists", async () => {
  const h = harness([], [], { autoCreate: true });
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "created");
  assert.equal(summary.subscription_id, "new-1");
  assert.deepEqual(h.calls, [`create:${MAX_WEBHOOK_EXPIRES_IN_SECONDS}`]);
  assert.deepEqual(h.outcomes, [null]);
});

test("failure stores the error class name as the newest outcome and rethrows", async () => {
  const h = harness([], [], { autoCreate: true, failCreate: true });
  await assert.rejects(() => runWebhookSubscriptionMaintenance(h.deps), /provider refused/);
  assert.deepEqual(h.outcomes, ["Error"]);
});

test("an unavailable outcome store never changes the provider outcome", async () => {
  const h = harness([record({ id: "owned", expirationTime: new Date(NOW.getTime() + 6 * DAY) })], ["owned"]);
  const summary = await runWebhookSubscriptionMaintenance({ ...h.deps, recordOutcome: async () => { throw new Error("mongo down"); } });
  assert.equal(summary.action, "renewed");
  assert.deepEqual(h.calls, ["renew:owned"]);
});

test("C6 drift: an owned calls subscription with drifted filters or address is PUT in place once, never created, even with auto-create on", async () => {
  const filters = harness([record({ id: "owned", eventFilters: ["/restapi/v1.0/account/~/extension/101/telephony/sessions"] })], ["owned"], { autoCreate: true });
  const summary = await runWebhookSubscriptionMaintenance(filters.deps);
  assert.equal(summary.plan, "update");
  assert.equal(summary.action, "updated");
  assert.equal(summary.subscription_id, "owned");
  assert.deepEqual(filters.calls, [`update:owned:${ALL[0]}:${ADDRESS}`], "one PUT with the wanted filters and address; no create");
  assert.deepEqual(filters.outcomes, [null], "the outcome row error_code is null");

  const address = harness([record({ id: "owned", address: "https://old.example.test/api/webhooks/ringcentral" })], ["owned"]);
  const moved = await runWebhookSubscriptionMaintenance(address.deps);
  assert.equal(moved.action, "updated");
  assert.deepEqual(address.calls, [`update:owned:${ALL[0]}:${ADDRESS}`]);
  assert.deepEqual(address.outcomes, [null]);
});

test("CW2: an owned calls subscription whose deliveries are refused is replaced (create, then delete), even with auto-create off", async () => {
  const h = harness([record({ id: "owned" })], ["owned"], { refusedIds: ["owned"] });
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.plan, "replace");
  assert.equal(summary.action, "replaced");
  assert.equal(summary.subscription_id, "new-1");
  assert.equal(summary.removed_subscription_id, "owned");
  assert.deepEqual(h.calls, [`create:${DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS}`, "delete:owned"], "the new one exists before the old one goes");
  assert.deepEqual(h.outcomes, [null]);
});

test("CW2: a drifted owned calls subscription with no stored token is replaced, never PUT (a PUT cannot add a token)", async () => {
  const h = harness([record({ id: "owned", address: "https://old.example.test/api/webhooks/ringcentral" })], ["owned"], { tokenless: ["owned"] });
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.plan, "replace");
  assert.equal(summary.action, "replaced");
  assert.deepEqual(h.calls, [`create:${DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS}`, "delete:owned"]);
  assert.equal(h.calls.some((c) => c.startsWith("update:")), false);
});

test("C6 drift: an owned rep_sms subscription is never PUT by the calls maintenance; the calls channel is still missing", async () => {
  const h = harness([record({ id: "sms", eventFilters: ["/restapi/v1.0/account/~/extension/101/message-store?type=SMS"] })], ["sms"], { purposes: { sms: "rep_sms" } });
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "missing");
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.outcomes, ["subscription_missing"]);
});
