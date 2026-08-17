import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ClientSession } from "mongoose";
import {
  getRegistryCacheInvalidationLogForTests,
  invalidateRegistryCaches,
  onRegistryCacheInvalidation,
  resetRegistryCacheInvalidationForTests,
} from "./cacheInvalidation";
import { withRegistryMutation } from "./registryAudit";
import type { RegistryActorContext, TransactionRunner } from "./types";

const ACTOR: RegistryActorContext = {
  actorType: "owner",
  actorId: "admin_123",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_audit_1",
};

afterEach(() => {
  resetRegistryCacheInvalidationForTests();
});

test("withRegistryMutation rolls back when audit insert fails", async () => {
  let mutationAttempted = false;
  let transactionCommitted = false;

  const failingTransaction: TransactionRunner = async (fn) => {
    const session = {} as ClientSession;
    try {
      const result = await fn(session);
      transactionCommitted = true;
      return result;
    } catch (error) {
      transactionCommitted = false;
      throw error;
    }
  };

  await assert.rejects(
    () =>
      withRegistryMutation(
        {
          actor: ACTOR,
          audit: {
            entityType: "agent",
            entityId: "507f1f77bcf86cd799439011",
            action: "update",
            before: { name: "Before" },
            after: { name: "After", api_secret: "hidden" },
          },
          mutate: async () => {
            mutationAttempted = true;
            return { ok: true };
          },
          invalidateKeys: ["agents"],
        },
        {
          withTransaction: failingTransaction,
          insertAudit: async () => {
            throw new Error("audit insert failed");
          },
        },
      ),
    /audit insert failed/,
  );

  assert.equal(mutationAttempted, true);
  assert.equal(transactionCommitted, false);
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), []);
});

test("withRegistryMutation invalidates caches only after commit", async () => {
  const committed: string[] = [];

  const okTransaction: TransactionRunner = async (fn) => fn({} as ClientSession);

  const result = await withRegistryMutation(
    {
      actor: ACTOR,
      audit: {
        entityType: "merchant",
        entityId: "507f1f77bcf86cd799439012",
        action: "create",
        after: { name: "Acme" },
        metadata: { request_id: ACTOR.requestId },
      },
      mutate: async () => {
        committed.push("mutated");
        return { id: "507f1f77bcf86cd799439012" };
      },
      invalidateKeys: ["merchants", "registry-overview"],
    },
    {
      withTransaction: okTransaction,
      insertAudit: async () => {
        committed.push("audited");
      },
    },
  );

  assert.deepEqual(committed, ["mutated", "audited"]);
  assert.equal(result.id, "507f1f77bcf86cd799439012");
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), [
    ["merchants", "registry-overview"],
  ]);
});

test("duplicate mutation request IDs fail as a stable replay conflict", async () => {
  await assert.rejects(
    () =>
      withRegistryMutation(
        {
          actor: ACTOR,
          audit: {
            entityType: "agent",
            entityId: "507f1f77bcf86cd799439011",
            action: "update",
          },
          mutate: async () => ({ ok: true }),
        },
        {
          withTransaction: async (fn) => fn({} as ClientSession),
          insertAudit: async () => {
            throw {
              code: 11000,
              keyPattern: { request_id: 1 },
              keyValue: { request_id: ACTOR.requestId },
            };
          },
        },
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "This registry request was already processed." &&
      "registryCode" in error &&
      error.registryCode === "REGISTRY_DUPLICATE_IDENTIFIER",
  );
});

test("granot_crm_source audit failure still rolls back and skips cache invalidation", async () => {
  let committed = false;
  await assert.rejects(
    () =>
      withRegistryMutation(
        {
          actor: ACTOR,
          audit: {
            entityType: "granot_crm_source",
            entityId: "507f1f77bcf86cd799439099",
            action: "update",
            reason: "synthetic policy change",
            before: { lifecycle_enabled: false },
            after: { lifecycle_enabled: true, authorization: "should-redact" },
          },
          mutate: async () => ({ ok: true }),
          invalidateKeys: ["granot_lifecycle_source_policy"],
        },
        {
          withTransaction: async (fn) => {
            try {
              const result = await fn({} as ClientSession);
              committed = true;
              return result;
            } catch (error) {
              committed = false;
              throw error;
            }
          },
          insertAudit: async () => {
            throw new Error("granot_crm_source audit insert failed");
          },
        },
      ),
    /granot_crm_source audit insert failed/,
  );
  assert.equal(committed, false);
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), []);
});

test("invalidateRegistryCaches deduplicates keys for listeners", () => {
  const seen: string[][] = [];
  onRegistryCacheInvalidation((keys) => {
    seen.push([...keys]);
  });

  invalidateRegistryCaches(["agents", "agents", "health"]);
  assert.deepEqual(seen, [["agents", "health"]]);
});
