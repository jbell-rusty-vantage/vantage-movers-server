import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
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

test("foreign same-address subscription is never touched; missing owned one is reported, not created, when auto-create is off", async () => {
  const h = harness([record({ id: "foreign", status: "Blacklisted" })], []);
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "missing");
  assert.deepEqual(h.calls, [], "no create, no delete of the foreign one");
  assert.deepEqual(h.outcomes, ["subscription_missing"]);
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

test("C6 drift: an owned rep_sms subscription is never PUT by the calls maintenance; the calls channel is still missing", async () => {
  const h = harness([record({ id: "sms", eventFilters: ["/restapi/v1.0/account/~/extension/101/message-store?type=SMS"] })], ["sms"], { purposes: { sms: "rep_sms" } });
  const summary = await runWebhookSubscriptionMaintenance(h.deps);
  assert.equal(summary.action, "missing");
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.outcomes, ["subscription_missing"]);
});
