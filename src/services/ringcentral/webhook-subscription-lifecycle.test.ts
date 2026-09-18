import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import ringCentralWebhookRoutes from "../../routes/ringcentral-webhook.routes";
import { buildRingCentralTelephonyEventFilters } from "./webhook-subscriptions";
import {
  applyAllDirectionSubscriptionPlan,
  classifySubscriptions,
  ensureAllDirectionSubscription,
  parseSubscriptionRecord,
  planAllDirectionSubscription,
  renewOwnedSubscription,
  repairOwnedSubscription,
  ringCentralSubscriptionProvider,
  subscriptionHealth,
  SubscriptionOwnershipError,
  SubscriptionOwnershipRecordError,
  validationEchoHeaders,
  type LifecycleDeps,
  type OwnershipStore,
  type SubscriptionProvider,
  type SubscriptionRecord,
} from "./webhook-subscription-lifecycle";

const ADDRESS = "https://example.test/api/webhooks/ringcentral";
const ALL = ["/restapi/v1.0/account/~/telephony/sessions"];
const INBOUND = ["/restapi/v1.0/account/~/telephony/sessions?direction=Inbound"];
const NOW = new Date("2026-09-17T14:00:00.000Z");

test("builder: mode all is the account telephony path with no direction filter and no withRecordings; inbound builder is byte-for-byte unchanged", async () => {
  assert.deepEqual(await buildRingCentralTelephonyEventFilters("all"), ALL);
  assert.deepEqual(await buildRingCentralTelephonyEventFilters("account"), INBOUND);
  assert.deepEqual(await buildRingCentralTelephonyEventFilters(), INBOUND, "default mode is still the qualified inbound builder");
  assert.equal(ALL[0]!.includes("direction"), false);
  assert.equal(ALL[0]!.includes("withRecordings"), false);
});

function record(partial: Partial<SubscriptionRecord> & { id: string }): SubscriptionRecord {
  return {
    eventFilters: ALL,
    transportType: "WebHook",
    address: ADDRESS,
    status: "Active",
    expiresIn: 604_800,
    expirationTime: new Date(NOW.getTime() + 6 * 24 * 60 * 60_000),
    raw: { id: partial.id },
    ...partial,
  };
}

function fakes(records: SubscriptionRecord[], owned: string[]) {
  const calls: string[] = [];
  const stored: unknown[] = [];
  const statuses: Array<[string, string]> = [];
  const ownedIds = new Set(owned);
  let created = 0;
  const provider: SubscriptionProvider = {
    list: async () => records,
    create: async (input) => {
      calls.push(`create:${input.eventFilters.join("|")}:${input.address}:${input.expiresIn}`);
      created += 1;
      return { id: `new-${created}`, eventFilters: input.eventFilters, deliveryMode: { transportType: "WebHook", address: input.address }, status: "Active", expiresIn: input.expiresIn };
    },
    renew: async (id) => {
      calls.push(`renew:${id}`);
      return { id, eventFilters: ALL, deliveryMode: { transportType: "WebHook", address: ADDRESS }, status: "Active", expiresIn: 604_800 };
    },
    remove: async (id) => {
      calls.push(`delete:${id}`);
    },
  };
  const store: OwnershipStore = {
    ownedIds: async () => ownedIds,
    record: async (raw) => {
      stored.push(raw);
      const id = (raw as { id?: string }).id;
      if (id) ownedIds.add(id);
    },
    markStatus: async (id, status) => {
      statuses.push([id, status]);
    },
  };
  const deps: LifecycleDeps = { provider, store, address: ADDRESS, now: () => NOW, eventFilters: async () => ALL };
  return { deps, calls, stored, statuses };
}

test("classification: owned+matching managed by health; owned inbound-only and foreign same-address subscriptions are never managed", () => {
  const records = [
    record({ id: "owned-all" }),
    record({ id: "owned-inbound", eventFilters: INBOUND }),
    record({ id: "foreign-same" }),
    record({ id: "foreign-other", address: "https://other.test/hook" }),
    record({ id: "owned-expiring", expirationTime: new Date(NOW.getTime() + 60 * 60_000) }),
    record({ id: "owned-black", status: "Blacklisted" }),
  ];
  const classified = classifySubscriptions({ records, ownedIds: new Set(["owned-all", "owned-inbound", "owned-expiring", "owned-black"]), address: ADDRESS, eventFilters: ALL, now: NOW });
  assert.deepEqual(
    classified.owned_matching.map((m) => [m.record.id, m.health]),
    [["owned-all", "active"], ["owned-expiring", "expiring"], ["owned-black", "blacklisted"]],
  );
  assert.deepEqual(classified.owned_other.map((r) => r.id), ["owned-inbound"]);
  assert.deepEqual(classified.foreign_same_address.map((r) => r.id), ["foreign-same"]);
  assert.deepEqual(classified.foreign_other.map((r) => r.id), ["foreign-other"]);
});

test("plan/apply: noop when healthy, create when none owned, foreign same-address subscription is reported and untouched", async () => {
  const healthy = fakes([record({ id: "owned-all" }), record({ id: "foreign-same" })], ["owned-all"]);
  const plan = await planAllDirectionSubscription(healthy.deps);
  assert.equal(plan.action, "noop");
  assert.deepEqual(plan.warnings, ["foreign subscription foreign-same delivers to this address and is not managed here"]);
  assert.deepEqual(await applyAllDirectionSubscriptionPlan(plan, healthy.deps), { action: "noop", subscription_id: "owned-all" });
  assert.deepEqual(healthy.calls, []);

  const none = fakes([record({ id: "foreign-same" }), record({ id: "owned-inbound", eventFilters: INBOUND })], ["owned-inbound"]);
  const ensured = await ensureAllDirectionSubscription(none.deps);
  assert.equal(ensured.plan.action, "create");
  assert.deepEqual(ensured.result, { action: "created", subscription_id: "new-1" });
  assert.deepEqual(none.calls, [`create:${ALL[0]}:${ADDRESS}:604800`], "creates only the all-direction subscription; the inbound one is untouched");
  assert.equal(none.stored.length, 1, "created subscription metadata is recorded as owned");
});

test("renewal: expiring owned subscription is renewed; renewing a foreign id is refused before any provider call", async () => {
  const expiring = fakes([record({ id: "owned-expiring", expirationTime: new Date(NOW.getTime() + 60 * 60_000) }), record({ id: "foreign-same" })], ["owned-expiring"]);
  const plan = await planAllDirectionSubscription(expiring.deps);
  assert.equal(plan.action, "renew");
  assert.deepEqual(await applyAllDirectionSubscriptionPlan(plan, expiring.deps), { action: "renewed", subscription_id: "owned-expiring" });
  assert.deepEqual(expiring.calls, ["renew:owned-expiring"]);

  await assert.rejects(
    () => renewOwnedSubscription("foreign-same", expiring.deps),
    (e: unknown) => e instanceof SubscriptionOwnershipError && e.operation === "renew" && e.subscriptionId === "foreign-same",
  );
  assert.deepEqual(expiring.calls, ["renew:owned-expiring"], "no provider call for the refused renewal");
});

test("repair: blacklisted owned subscription is deleted, marked and recreated; a foreign id is never deleted or replaced", async () => {
  const black = fakes([record({ id: "owned-black", status: "Blacklisted" }), record({ id: "foreign-same", status: "Blacklisted" })], ["owned-black"]);
  const plan = await planAllDirectionSubscription(black.deps);
  assert.equal(plan.action, "repair");
  assert.deepEqual(await applyAllDirectionSubscriptionPlan(plan, black.deps), { action: "repaired", removed_subscription_id: "owned-black", subscription_id: "new-1" });
  assert.deepEqual(black.calls, ["delete:owned-black", `create:${ALL[0]}:${ADDRESS}:604800`]);
  assert.deepEqual(black.statuses, [["owned-black", "Deleted"]]);

  await assert.rejects(
    () => repairOwnedSubscription("foreign-same", black.deps),
    (e: unknown) => e instanceof SubscriptionOwnershipError && e.operation === "repair",
  );
  assert.equal(black.calls.filter((c) => c.startsWith("delete:")).length, 1, "only the owned subscription was ever deleted");

  // Same-address foreign subscription with a blacklisted status still only yields a create, never a delete.
  const foreignOnly = fakes([record({ id: "foreign-same", status: "Blacklisted" })], []);
  const ensured = await ensureAllDirectionSubscription(foreignOnly.deps);
  assert.equal(ensured.plan.action, "create");
  assert.deepEqual(foreignOnly.calls, [`create:${ALL[0]}:${ADDRESS}:604800`]);
});

test("health edges: unknown expiry is renew-due; unknown or missing status is reported and never repaired (review finding 6)", async () => {
  assert.equal(subscriptionHealth(record({ id: "a", expirationTime: null, expiresIn: null }), NOW, 60_000), "expiring");
  assert.equal(subscriptionHealth(record({ id: "a", status: " active " }), NOW, 60_000), "active");
  assert.equal(subscriptionHealth(record({ id: "a", status: "Suspended" }), NOW, 60_000), "blacklisted");
  assert.equal(subscriptionHealth(record({ id: "a", status: "Pending" }), NOW, 60_000), "unknown");
  assert.equal(subscriptionHealth(record({ id: "a", status: null }), NOW, 60_000), "unknown");

  const noExpiry = fakes([record({ id: "owned-noexp", expirationTime: null, expiresIn: null })], ["owned-noexp"]);
  assert.equal((await planAllDirectionSubscription(noExpiry.deps)).action, "renew");

  const odd = fakes([record({ id: "owned-odd", status: "Pending" })], ["owned-odd"]);
  const plan = await planAllDirectionSubscription(odd.deps);
  assert.equal(plan.action, "noop");
  assert.match(plan.warnings.join("\n"), /owned-odd reports status Pending; not repaired automatically/);
  await applyAllDirectionSubscriptionPlan(plan, odd.deps);
  assert.deepEqual(odd.calls, [], "an unrecognized status never triggers a delete");
});

test("ownership evidence fails closed: create without a recordable store surfaces the created id instead of orphaning it (review finding 7)", async () => {
  const broken = fakes([], []);
  broken.deps.store.record = async () => {
    throw new Error("metadata write did not land in Mongo");
  };
  await assert.rejects(
    () => ensureAllDirectionSubscription(broken.deps),
    (e: unknown) => e instanceof SubscriptionOwnershipRecordError && e.subscriptionId === "new-1",
  );
  assert.deepEqual(broken.calls, [`create:${ALL[0]}:${ADDRESS}:604800`], "one create, loudly unrecorded; never silently foreign");

  const unavailable = fakes([], []);
  unavailable.deps.store.ownedIds = async () => {
    throw new Error("ownership store unavailable");
  };
  await assert.rejects(() => planAllDirectionSubscription(unavailable.deps), /ownership store unavailable/);
  await assert.rejects(() => applyAllDirectionSubscriptionPlan({ action: "create", warnings: [] }, unavailable.deps), /ownership store unavailable/);
  assert.deepEqual(unavailable.calls, [], "no provider mutation without ownership evidence");
});

test("provider adapter builds the exact RingCentral subscription requests over the shared client", async () => {
  const requests: Array<[string, string, unknown]> = [];
  const provider = ringCentralSubscriptionProvider((async (method: string, endpoint: string, body?: unknown) => {
    requests.push([method, endpoint, body]);
    if (method === "GET") return { records: [{ id: "a", eventFilters: ALL, deliveryMode: { transportType: "WebHook", address: ADDRESS }, status: "Active", expiresIn: 100 }, { noId: true }] };
    if (method === "DELETE") return null;
    return { id: "a" };
  }) as never);
  const listed = await provider.list();
  assert.equal(listed.length, 1, "records without an id are ignored");
  assert.equal(listed[0]!.expirationTime?.getTime(), listed[0]!.expirationTime!.getTime());
  await provider.create({ eventFilters: ALL, address: ADDRESS, expiresIn: 604_800 });
  await provider.renew("a b");
  await provider.remove("a b");
  assert.deepEqual(requests.map(([m, e]) => `${m} ${e}`), [
    "GET /restapi/v1.0/subscription",
    "POST /restapi/v1.0/subscription",
    "POST /restapi/v1.0/subscription/a%20b/renew",
    "DELETE /restapi/v1.0/subscription/a%20b",
  ]);
  assert.deepEqual(requests[1]![2], { eventFilters: ALL, deliveryMode: { transportType: "WebHook", address: ADDRESS }, expiresIn: 604_800 });
  assert.equal(parseSubscriptionRecord({ id: 5, expirationTime: "2026-09-18T00:00:00.000Z" }, NOW)?.expirationTime?.toISOString(), "2026-09-18T00:00:00.000Z");
});

test("validation echo: the route echoes Validation-Token on a 200 and fans out only a durable receipt", async () => {
  assert.deepEqual(validationEchoHeaders(" tok "), { "Validation-Token": "tok" });
  assert.deepEqual(validationEchoHeaders(null), {});
  const saved = { ...process.env };
  delete process.env.MONGO_URI; // capture cannot persist: receipt is not durable, nothing is fanned out
  process.env.RINGCENTRAL_WEBHOOK_ENABLED = "false"; // qualification processing off; the echo and fan-out decision do not depend on it
  process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "true";
  const app = express();
  app.use(express.json());
  app.use(ringCentralWebhookRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/ringcentral`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "Validation-Token": "synthetic-validation" },
      body: JSON.stringify({ uuid: "echo-1", event: "/restapi/v1.0/account/~/telephony/sessions", body: {} }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("validation-token"), "synthetic-validation");
    const body = (await response.json()) as { storedRawEvent: boolean; captureProjection: unknown };
    assert.equal(body.storedRawEvent, false);
    assert.deepEqual(body.captureProjection, { status: "skipped", reason: "receipt_not_durable" });

    process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "false";
    const off = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uuid: "echo-2", body: {} }),
      signal: AbortSignal.timeout(5000),
    });
    assert.deepEqual(((await off.json()) as { captureProjection: unknown }).captureProjection, { status: "skipped", reason: "flag_off" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = saved;
  }
});
