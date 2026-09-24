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

function harness(records: SubscriptionRecord[], owned: string[], options: { autoCreate?: boolean; failCreate?: boolean } = {}) {
  const calls: string[] = [];
  const events: Array<{ eventKey: string; level: string }> = [];
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
  };
  const store: OwnershipStore = {
    ownedIds: async () => ownedIds,
    record: async (raw) => {
      ownedIds.add((raw as { id: string }).id);
    },
    markStatus: async () => undefined,
  };
  const deps: WebhookSubscriptionMaintenanceDeps = {
    provider,
    store,
    address: ADDRESS,
    now: () => NOW,
    eventFilters: async () => ALL,
    autoCreate: options.autoCreate ?? false,
    recordEvent: (async (event: { eventKey: string; level: string }) => {
      events.push({ eventKey: event.eventKey, level: event.level });
      return null;
    }) as never,
  };
  return { deps, calls, events };
}

test("expiry: the lifecycle requests the longest WebHook lifetime (20 years)", () => {
  assert.equal(MAX_WEBHOOK_EXPIRES_IN_SECONDS, 630_720_000);
  assert.equal(DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS, MAX_WEBHOOK_EXPIRES_IN_SECONDS);
});

test("owned healthy subscription: noop, no provider mutation, no event", async () => {
  const h = harness([record({ id: "owned" })], ["owned"]);
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "noop");
  assert.equal(summary.subscription_id, "owned");
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.events, []);
});

test("owned subscription with under 7 days left is renewed; with more than 7 days it is left alone", async () => {
  const expiring = harness([record({ id: "owned", expirationTime: new Date(NOW.getTime() + 6 * DAY) })], ["owned"]);
  const summary = await runWebhookSubscriptionMaintenance(expiring.deps);
  assert.equal(summary.action, "renewed");
  assert.deepEqual(expiring.calls, ["renew:owned"]);
  assert.deepEqual(expiring.events, [{ eventKey: "sales_intelligence.webhook_subscription.renewed", level: "info" }]);

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
  assert.deepEqual(h.events, [{ eventKey: "sales_intelligence.webhook_subscription.repaired", level: "warn" }]);
});

test("foreign same-address subscription is never touched: warning event; missing owned one is reported, not created, when auto-create is off", async () => {
  const h = harness([record({ id: "foreign", status: "Blacklisted" })], []);
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "missing");
  assert.deepEqual(h.calls, [], "no create, no delete of the foreign one");
  assert.deepEqual(h.events.map((e) => e.eventKey), [
    "sales_intelligence.webhook_subscription.foreign_warning",
    "sales_intelligence.webhook_subscription.missing",
  ]);
});

test("auto-create on: creates the all-direction subscription at max expiry when none owned exists", async () => {
  const h = harness([], [], { autoCreate: true });
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "created");
  assert.equal(summary.subscription_id, "new-1");
  assert.deepEqual(h.calls, [`create:${MAX_WEBHOOK_EXPIRES_IN_SECONDS}`]);
  assert.deepEqual(h.events, [{ eventKey: "sales_intelligence.webhook_subscription.created", level: "info" }]);
});

test("failure emits an error event and rethrows", async () => {
  const h = harness([], [], { autoCreate: true, failCreate: true });
  await assert.rejects(() => runWebhookSubscriptionMaintenance(h.deps), /provider refused/);
  assert.deepEqual(h.events, [{ eventKey: "sales_intelligence.webhook_subscription.failed", level: "error" }]);
});
