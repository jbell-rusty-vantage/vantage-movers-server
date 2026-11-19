import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAllDirectionSubscriptionPlan,
  DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
  ensureAllDirectionSubscription,
  planAllDirectionSubscription,
  renewOwnedSubscription,
  SubscriptionOwnershipError,
  SubscriptionOwnershipRecordError,
  DELIVERY_REFUSAL_RECENT_MS,
  type LifecycleDeps,
  type OwnershipStore,
  type StoredSubscriptionMeta,
  type SubscriptionProvider,
  type SubscriptionRecord,
  type SubscriptionWriteInput,
} from "./webhook-subscription-lifecycle";

const ADDRESS = "https://example.test/api/webhooks/ringcentral";
const ALL = ["/restapi/v1.0/account/~/telephony/sessions"];
const NOW = new Date("2026-09-17T14:00:00.000Z");

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

// ---------------------------------------------------------------------------
// C6: an owned `calls` subscription that drifted is updated in place, never duplicated
// ---------------------------------------------------------------------------

const EXTENSION_SESSIONS = ["/restapi/v1.0/account/~/extension/101/telephony/sessions"];

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
  assert.deepEqual(drift.recordedMeta, [{ purpose: "calls" }], "the PUT response is recorded as the owned calls subscription; the stored token is left as it is (CW2)");
});

test("CW2: a drifted owned calls subscription with no stored token plans replace (create with a token, then delete), never a PUT", async () => {
  const drift = driftFakes([record({ id: "owned-calls", address: "https://old.example.test/api/webhooks/ringcentral" })], {
    "owned-calls": { purpose: "calls", verificationToken: null },
  });
  const plan = await planAllDirectionSubscription(drift.deps);
  assert.deepEqual(plan, { action: "replace", subscription_id: "owned-calls", reasons: ["filter_drift", "verification_token_missing"], warnings: [] });
  assert.deepEqual(await applyAllDirectionSubscriptionPlan(plan, drift.deps), { action: "replaced", removed_subscription_id: "owned-calls", subscription_id: "new-1" });
  assert.deepEqual(
    drift.calls,
    [`create:${ALL[0]}:${ADDRESS}:${DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS}`, "delete:owned-calls"],
    "the new subscription exists before the old one is deleted; no PUT",
  );
  assert.deepEqual(drift.statuses, [["owned-calls", "Deleted"]]);
  assert.equal(drift.updates.length, 0);
  const recorded = drift.recordedMeta[0];
  assert.equal(recorded?.purpose, "calls");
  assert.match(recorded?.verificationToken ?? "", /^[0-9a-f]{32}$/, "the token is the one sent on the create");
});

test("CW2: an Active matching subscription whose deliveries the route refuses plans replace [deliveries_refused]; an accepted delivery since, or an old refusal, does not", async () => {
  const refusedAt = new Date(NOW.getTime() - 5 * 60_000);
  const withRefusals = (accepted_since: boolean, at = refusedAt) => {
    const f = driftFakes([record({ id: "owned-calls" })], { "owned-calls": { purpose: "calls", verificationToken: "stored-token" } });
    f.deps.store.deliveryRefusals = async (id) =>
      id === "owned-calls" ? { count: 42, last_refused_at: at, last_reason: "token_missing", accepted_since } : null;
    return f;
  };
  const refused = withRefusals(false);
  const plan = await planAllDirectionSubscription(refused.deps);
  assert.equal(plan.action, "replace");
  assert.deepEqual(plan.action === "replace" ? plan.reasons : null, ["deliveries_refused"]);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0]!, /refused its deliveries \(42 counted/);
  assert.deepEqual(await applyAllDirectionSubscriptionPlan(plan, refused.deps), { action: "replaced", removed_subscription_id: "owned-calls", subscription_id: "new-1" });
  assert.deepEqual(refused.calls.map((c) => c.split(":")[0]), ["create", "delete"]);

  assert.equal((await planAllDirectionSubscription(withRefusals(true).deps)).action, "noop", "a delivery was accepted after the refusal");
  const old = withRefusals(false, new Date(NOW.getTime() - DELIVERY_REFUSAL_RECENT_MS - 60_000));
  assert.equal((await planAllDirectionSubscription(old.deps)).action, "noop", "a refusal older than the window is history");
});

test("CW2: replace refuses a foreign id and deletes nothing when the create fails", async () => {
  const foreign = driftFakes([record({ id: "foreign" })], {});
  await assert.rejects(
    applyAllDirectionSubscriptionPlan({ action: "replace", subscription_id: "foreign", reasons: ["deliveries_refused"], warnings: [] }, foreign.deps),
    SubscriptionOwnershipError,
  );
  assert.deepEqual(foreign.calls, []);
  const failing = driftFakes([record({ id: "owned-calls" })], { "owned-calls": { purpose: "calls", verificationToken: null } });
  failing.deps.provider.create = async () => {
    throw new Error("provider refused");
  };
  await assert.rejects(
    applyAllDirectionSubscriptionPlan({ action: "replace", subscription_id: "owned-calls", reasons: ["verification_token_missing"], warnings: [] }, failing.deps),
    /provider refused/,
  );
  assert.deepEqual(failing.calls, [], "the old subscription is kept");
});
