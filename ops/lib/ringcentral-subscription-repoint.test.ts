import assert from "node:assert/strict";
import test from "node:test";
import type {
  LifecycleDeps,
  OwnershipStore,
  StoredSubscriptionMeta,
  SubscriptionProvider,
  SubscriptionRecord,
} from "../../src/services/ringcentral/webhook-subscription-lifecycle";
import {
  ensureAllDirectionSubscriptionGuarded,
  planRepointRefusal,
  planTarget,
  repairOwnedSubscriptionGuarded,
  repointRefusal,
  SubscriptionRepointRefusedError,
} from "./ringcentral-subscription-repoint";

const PRODUCTION = "https://api.example.test/api/webhooks/ringcentral";
const TUNNEL = "https://dev-tunnel.example.test/api/webhooks/ringcentral";
const OLD_TUNNEL = "https://old-tunnel.example.test/api/webhooks/ringcentral";
const ALL = ["/restapi/v1.0/account/~/telephony/sessions"];
const NOW = new Date("2026-10-06T14:00:00.000Z");

function record(partial: Partial<SubscriptionRecord> & { id: string }): SubscriptionRecord {
  return {
    eventFilters: ALL,
    transportType: "WebHook",
    address: PRODUCTION,
    status: "Active",
    expiresIn: 315_360_000,
    expirationTime: new Date(NOW.getTime() + 365 * 24 * 60 * 60_000),
    raw: { id: partial.id },
    ...partial,
  };
}

/** Fake provider + ownership store; every provider mutation is recorded in `calls`. */
function fakes(records: SubscriptionRecord[], owned: Record<string, Partial<StoredSubscriptionMeta>>, address: string) {
  const calls: string[] = [];
  const ownedIds = new Set(Object.keys(owned));
  const echo = (id: string, input: { eventFilters: string[]; address: string }) => ({
    id,
    eventFilters: input.eventFilters,
    deliveryMode: { transportType: "WebHook", address: input.address },
    status: "Active",
    expiresIn: 315_360_000,
  });
  const provider: SubscriptionProvider = {
    list: async () => records,
    create: async (input) => {
      calls.push(`create:${input.address}`);
      return echo("new-1", input);
    },
    renew: async (id) => {
      calls.push(`renew:${id}`);
      return echo(id, { eventFilters: ALL, address: PRODUCTION });
    },
    remove: async (id) => {
      calls.push(`delete:${id}`);
    },
    update: async (id, input) => {
      calls.push(`update:${id}:${input.address}`);
      return echo(id, input);
    },
  };
  const store: OwnershipStore = {
    ownedIds: async () => ownedIds,
    record: async (raw) => {
      const id = (raw as { id?: string }).id;
      if (id) ownedIds.add(id);
    },
    markStatus: async () => {},
    meta: async () =>
      new Map(
        Object.entries(owned).map(([id, meta]) => [id, { purpose: "calls", verificationToken: "token", ...meta } as StoredSubscriptionMeta]),
      ),
  };
  const deps: LifecycleDeps = { provider, store, address, now: () => NOW, eventFilters: async () => ALL };
  return { deps, calls };
}

test("repointRefusal: only an owned subscription on the production address moving elsewhere is refused", () => {
  const records = [record({ id: "prod" }), record({ id: "dev", address: OLD_TUNNEL }), record({ id: "bare", address: null })];
  const check = (subscriptionId: string | null, address: string, productionAddress: string | null = PRODUCTION) =>
    repointRefusal({ subscriptionId, records, address, productionAddress });
  assert.match(check("prod", TUNNEL) ?? "", /Refusing to re-point the production calls subscription prod .* RINGCENTRAL_NGROK_WEBHOOK_URL/);
  assert.equal(check(null, TUNNEL), null, "no target (create / noop / renew)");
  assert.equal(check("prod", PRODUCTION), null, "already delivering here");
  assert.equal(check("dev", PRODUCTION), null, "onto the production address: the C6 drift repair");
  assert.equal(check("dev", TUNNEL), null, "a developer subscription moving between tunnels");
  assert.equal(check("gone", TUNNEL), null, "not visible: nothing to re-point");
  assert.equal(check("bare", TUNNEL), null, "no recorded address: nothing to re-point");
  // Without RINGCENTRAL_WEBHOOK_URL the command cannot tell production apart: every re-point is refused.
  assert.match(check("dev", TUNNEL, null) ?? "", /RINGCENTRAL_WEBHOOK_URL is not set/);
  assert.equal(check("prod", PRODUCTION, null), null, "not a re-point");
});

test("planTarget: update and repair move a subscription; create, noop and renew do not", () => {
  assert.equal(planTarget({ action: "update", subscription_id: "a", reasons: ["filter_drift"], warnings: [] }), "a");
  assert.equal(planTarget({ action: "repair", subscription_id: "b", health: "blacklisted", warnings: [] }), "b");
  assert.equal(planTarget({ action: "create", warnings: [] }), null);
  assert.equal(planTarget({ action: "noop", subscription_id: "c", expiration_time: null, warnings: [] }), null);
  assert.equal(planTarget({ action: "renew", subscription_id: "d", expiration_time: null, warnings: [] }), null);
});

test("ensure with a tunnel address: the owned production calls subscription is never PUT onto the tunnel", async () => {
  const { deps, calls } = fakes([record({ id: "prod" })], { prod: {} }, TUNNEL);
  await assert.rejects(
    ensureAllDirectionSubscriptionGuarded(deps, PRODUCTION),
    (error: unknown) => error instanceof SubscriptionRepointRefusedError && /production calls subscription prod/.test(error.message),
  );
  assert.deepEqual(calls, [], "no update, create or delete reached the provider");
  // `plan` stays read-only and reports the same refusal as a note.
  const note = await planRepointRefusal({ action: "update", subscription_id: "prod", reasons: ["filter_drift"], warnings: [] }, deps, PRODUCTION);
  assert.match(note ?? "", /unset RINGCENTRAL_NGROK_WEBHOOK_URL/);
});

test("ensure with a tunnel address: a blacklisted production subscription is not deleted and recreated on the tunnel", async () => {
  const { deps, calls } = fakes([record({ id: "prod", status: "Blacklisted", eventFilters: ["/restapi/v1.0/account/~/extension/~/telephony/sessions"] })], { prod: {} }, TUNNEL);
  await assert.rejects(ensureAllDirectionSubscriptionGuarded(deps, PRODUCTION), SubscriptionRepointRefusedError);
  assert.deepEqual(calls, []);
});

test("ensure on the production address still repairs a drifted production subscription in place (C6)", async () => {
  const { deps, calls } = fakes([record({ id: "prod", eventFilters: ["/restapi/v1.0/account/~/extension/~/telephony/sessions"] })], { prod: {} }, PRODUCTION);
  const { plan, result } = await ensureAllDirectionSubscriptionGuarded(deps, PRODUCTION);
  assert.equal(plan.action, "update");
  assert.deepEqual(result, { action: "updated", subscription_id: "prod" });
  assert.deepEqual(calls, [`update:prod:${PRODUCTION}`]);
});

test("ensure with a tunnel address against a store that does not own production creates a separate subscription (pre-C6 behaviour)", async () => {
  const { deps, calls } = fakes([record({ id: "prod" })], {}, TUNNEL);
  const { plan, result } = await ensureAllDirectionSubscriptionGuarded(deps, PRODUCTION);
  assert.equal(plan.action, "create");
  assert.deepEqual(result, { action: "created", subscription_id: "new-1" });
  assert.deepEqual(calls, [`create:${TUNNEL}`]);
});

test("ensure with a tunnel address may move an owned developer subscription from an old tunnel", async () => {
  const { deps, calls } = fakes([record({ id: "prod" }), record({ id: "dev", address: OLD_TUNNEL })], { dev: {} }, TUNNEL);
  const { plan } = await ensureAllDirectionSubscriptionGuarded(deps, PRODUCTION);
  assert.deepEqual([plan.action, planTarget(plan)], ["update", "dev"]);
  assert.deepEqual(calls, [`update:dev:${TUNNEL}`]);
});

test("ensure without RINGCENTRAL_WEBHOOK_URL refuses any re-point of an owned subscription", async () => {
  const { deps, calls } = fakes([record({ id: "dev", address: OLD_TUNNEL })], { dev: {} }, TUNNEL);
  await assert.rejects(ensureAllDirectionSubscriptionGuarded(deps, null), /RINGCENTRAL_WEBHOOK_URL is not set/);
  assert.deepEqual(calls, []);
});

test("repair --id: refused for the production subscription with a tunnel address; allowed on the production address", async () => {
  const tunnel = fakes([record({ id: "prod", status: "Blacklisted" })], { prod: {} }, TUNNEL);
  await assert.rejects(repairOwnedSubscriptionGuarded("prod", tunnel.deps, PRODUCTION), SubscriptionRepointRefusedError);
  assert.deepEqual(tunnel.calls, [], "the production subscription is not deleted");

  const production = fakes([record({ id: "prod", status: "Blacklisted" })], { prod: {} }, PRODUCTION);
  const result = await repairOwnedSubscriptionGuarded("prod", production.deps, PRODUCTION);
  assert.deepEqual(result, { action: "repaired", removed_subscription_id: "prod", subscription_id: "new-1" });
  assert.deepEqual(production.calls, ["delete:prod", `create:${PRODUCTION}`]);
});
