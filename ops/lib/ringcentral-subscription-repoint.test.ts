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
  repairOwnedSubscriptionGuarded,
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
