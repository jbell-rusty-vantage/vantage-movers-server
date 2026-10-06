import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import ringCentralWebhookRoutes from "../../routes/ringcentral-webhook.routes";
import { buildRingCentralTelephonyEventFilters } from "./webhook-subscriptions";
import {
  applyAllDirectionSubscriptionPlan,
  classifySubscriptions,
  sameFilterSet,
  DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
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
  type StoredSubscriptionMeta,
  type SubscriptionProvider,
  type SubscriptionRecord,
  type SubscriptionWriteInput,
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
    expirationTime: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000),
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

test("classification: a filter echoed with the literal account id matches the ~ form the app builds", () => {
  const echoed = ALL.map((f) => f.replace("/account/~/", "/account/62948571023/"));
  assert.notDeepEqual(echoed, ALL, "the fixture must exercise the account-id spelling");
  assert.equal(sameFilterSet(echoed, ALL), true);
  assert.equal(sameFilterSet([...echoed, "/restapi/v1.0/account/~/extension/1/message-store?type=SMS"], ALL), false);
  const classified = classifySubscriptions({ records: [record({ id: "owned-echoed", eventFilters: echoed })], ownedIds: new Set(["owned-echoed"]), address: ADDRESS, eventFilters: ALL, now: NOW });
  assert.deepEqual(classified.owned_matching.map((m) => m.record.id), ["owned-echoed"]);
  assert.deepEqual(classified.owned_other, []);
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
  assert.deepEqual(none.calls, [`create:${ALL[0]}:${ADDRESS}:${DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS}`], "creates only the all-direction subscription; the inbound one is untouched");
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
  assert.deepEqual(black.calls, ["delete:owned-black", `create:${ALL[0]}:${ADDRESS}:${DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS}`]);
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
  assert.deepEqual(foreignOnly.calls, [`create:${ALL[0]}:${ADDRESS}:${DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS}`]);
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
  assert.deepEqual(broken.calls, [`create:${ALL[0]}:${ADDRESS}:${DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS}`], "one create, loudly unrecorded; never silently foreign");

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

// ---------------------------------------------------------------------------
// C6: an owned `calls` subscription that drifted is updated in place, never duplicated
// ---------------------------------------------------------------------------

const EXTENSION_SESSIONS = ["/restapi/v1.0/account/~/extension/101/telephony/sessions"];
const SMS_FILTERS = ["/restapi/v1.0/account/~/extension/101/message-store?type=SMS"];

/** `fakes` plus stored purposes and a provider `update`, as the Mongo store and the RingCentral adapter have. */
function driftFakes(records: SubscriptionRecord[], meta: Record<string, StoredSubscriptionMeta>) {
  const f = fakes(records, Object.keys(meta));
  const updates: Array<{ id: string; input: SubscriptionWriteInput }> = [];
  const recordedMeta: Array<Partial<StoredSubscriptionMeta> | undefined> = [];
  f.deps.provider.update = async (id, input) => {
    f.calls.push(`update:${id}`);
    updates.push({ id, input });
    return { id, eventFilters: input.eventFilters, deliveryMode: { transportType: "WebHook", address: input.address }, status: "Active" };
  };
  f.deps.store.meta = async () => new Map(Object.entries(meta));
  const recordOwned = f.deps.store.record;
  f.deps.store.record = async (raw, m) => {
    recordedMeta.push(m);
    await recordOwned(raw, m);
  };
  return { ...f, updates, recordedMeta };
}

test("C6 drift: an owned calls subscription with other filters plans update [filter_drift]; apply PUTs the owned id with the wanted filters and address, never creates", async () => {
  const drift = driftFakes([record({ id: "owned-calls", eventFilters: EXTENSION_SESSIONS })], {
    "owned-calls": { purpose: "calls", verificationToken: "stored-token" },
  });
  const plan = await planAllDirectionSubscription(drift.deps);
  assert.deepEqual(plan, { action: "update", subscription_id: "owned-calls", reasons: ["filter_drift"], warnings: [] });
  assert.deepEqual(await applyAllDirectionSubscriptionPlan(plan, drift.deps), { action: "updated", subscription_id: "owned-calls" });
  assert.deepEqual(drift.calls, ["update:owned-calls"], "one PUT, no create, no delete");
  assert.deepEqual(drift.updates, [
    { id: "owned-calls", input: { eventFilters: ALL, address: ADDRESS, expiresIn: DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS, verificationToken: "stored-token" } },
  ]);
  assert.deepEqual(drift.recordedMeta, [{ purpose: "calls", verificationToken: "stored-token" }], "the PUT response is recorded as the owned calls subscription");
});

test("C6 drift: an owned calls subscription delivering to another address plans update, and the PUT carries the current address", async () => {
  const drift = driftFakes([record({ id: "owned-calls", address: "https://old.example.test/api/webhooks/ringcentral" })], {
    "owned-calls": { purpose: "calls", verificationToken: null },
  });
  const plan = await planAllDirectionSubscription(drift.deps);
  assert.deepEqual(plan, { action: "update", subscription_id: "owned-calls", reasons: ["filter_drift"], warnings: [] });
  await applyAllDirectionSubscriptionPlan(plan, drift.deps);
  assert.deepEqual(drift.calls, ["update:owned-calls"]);
  assert.equal(drift.updates[0]!.input.address, ADDRESS);
  assert.match(drift.updates[0]!.input.verificationToken ?? "", /^[0-9a-f]{32}$/, "a missing token is generated on the same PUT");
});

test("C6 drift: an owned rep_sms subscription alone is not the calls channel; the plan is still create", async () => {
  const sms = driftFakes([record({ id: "owned-sms", eventFilters: SMS_FILTERS })], { "owned-sms": { purpose: "rep_sms", verificationToken: "t" } });
  assert.deepEqual(await planAllDirectionSubscription(sms.deps), { action: "create", warnings: [] });
  // Purpose decides: even a rep_sms record carrying telephony filters is never taken over by the calls plan.
  const odd = driftFakes([record({ id: "owned-sms", eventFilters: EXTENSION_SESSIONS })], { "owned-sms": { purpose: "rep_sms", verificationToken: "t" } });
  assert.equal((await planAllDirectionSubscription(odd.deps)).action, "create");
});

test("C6 drift: a legacy owned row without a purpose is the calls channel only when it carries telephony-session filters", async () => {
  const echoed = EXTENSION_SESSIONS.map((f) => f.replace("/account/~/", "/account/62948571023/"));
  const legacy = driftFakes([record({ id: "owned-legacy", eventFilters: echoed })], { "owned-legacy": { purpose: null, verificationToken: null } });
  assert.deepEqual(await planAllDirectionSubscription(legacy.deps), { action: "update", subscription_id: "owned-legacy", reasons: ["filter_drift"], warnings: [] });

  // A store without meta (purpose unknown): the same filter rule decides.
  const noMeta = fakes([record({ id: "owned-legacy", eventFilters: EXTENSION_SESSIONS })], ["owned-legacy"]);
  assert.equal((await planAllDirectionSubscription(noMeta.deps)).action, "update");

  // Legacy inbound-only (`?direction=Inbound`) and message-store rows are not taken over.
  const inbound = driftFakes([record({ id: "owned-inbound", eventFilters: INBOUND })], { "owned-inbound": { purpose: null, verificationToken: null } });
  assert.equal((await planAllDirectionSubscription(inbound.deps)).action, "create");
  const sms = driftFakes([record({ id: "owned-legacy-sms", eventFilters: SMS_FILTERS })], { "owned-legacy-sms": { purpose: null, verificationToken: null } });
  assert.equal((await planAllDirectionSubscription(sms.deps)).action, "create");
});

test("C6 drift: a drifted owned calls subscription the provider reports blacklisted plans repair", async () => {
  const black = driftFakes([record({ id: "owned-calls", eventFilters: EXTENSION_SESSIONS, status: "Blacklisted" })], {
    "owned-calls": { purpose: "calls", verificationToken: "t" },
  });
  assert.deepEqual(await planAllDirectionSubscription(black.deps), { action: "repair", subscription_id: "owned-calls", health: "blacklisted", warnings: [] });
});

test("C6 drift: two drifted owned calls subscriptions warn and the healthiest is managed; a foreign same-address one stays untouched", async () => {
  const two = driftFakes(
    [
      record({ id: "owned-black", eventFilters: EXTENSION_SESSIONS, status: "Blacklisted" }),
      record({ id: "owned-expiring", eventFilters: EXTENSION_SESSIONS, expirationTime: new Date(NOW.getTime() + 60 * 60_000) }),
      record({ id: "foreign-same", eventFilters: EXTENSION_SESSIONS }),
    ],
    { "owned-black": { purpose: "calls", verificationToken: "t" }, "owned-expiring": { purpose: "calls", verificationToken: "t" } },
  );
  const plan = await planAllDirectionSubscription(two.deps);
  assert.equal(plan.action, "update");
  assert.equal(plan.action === "update" ? plan.subscription_id : null, "owned-expiring");
  assert.deepEqual(plan.warnings, [
    "foreign subscription foreign-same delivers to this address and is not managed here",
    "2 owned calls subscriptions drifted; only the healthiest is managed",
  ]);
  await applyAllDirectionSubscriptionPlan(plan, two.deps);
  assert.deepEqual(two.calls, ["update:owned-expiring"], "only the managed owned id is touched");
});

test("C6 drift: an owned matching subscription still wins over a drifted one", async () => {
  const both = driftFakes([record({ id: "owned-all" }), record({ id: "owned-drifted", eventFilters: EXTENSION_SESSIONS })], {
    "owned-all": { purpose: "calls", verificationToken: "t" },
    "owned-drifted": { purpose: "calls", verificationToken: "t" },
  });
  assert.equal((await planAllDirectionSubscription(both.deps)).action, "noop");
  assert.deepEqual(both.calls, []);
});
