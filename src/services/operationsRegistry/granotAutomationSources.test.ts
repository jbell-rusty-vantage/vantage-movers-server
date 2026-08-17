import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { GranotAutomationSource } from "../../models/GranotAutomationSource";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import {
  getRegistryCacheInvalidationLogForTests,
  resetRegistryCacheInvalidationForTests,
} from "./cacheInvalidation";
import { RegistryError } from "./errors";
import { setGranotAutomationSourceReference } from "./granotAutomationSources";
import type { RegistryActorContext } from "./types";

const automationId = new mongoose.Types.ObjectId();
const crmId = new mongoose.Types.ObjectId();

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "granot-lifecycle-source-registry",
  actorLabel: "granot-lifecycle-source-registry",
  actorRole: "owner",
  requestId: "req_granot_automation_ref_1",
};

type MutableModel = Record<string, unknown>;

const Crm = getGranotCrmSourceModel();
const originals = {
  automationFindById: GranotAutomationSource.findById,
  automationUpdateOne: GranotAutomationSource.updateOne,
  crmFindById: Crm.findById,
};

afterEach(() => {
  (GranotAutomationSource as unknown as MutableModel).findById =
    originals.automationFindById;
  (GranotAutomationSource as unknown as MutableModel).updateOne =
    originals.automationUpdateOne;
  (Crm as unknown as MutableModel).findById = originals.crmFindById;
  resetRegistryCacheInvalidationForTests();
});

function leanById(result: unknown) {
  return {
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

test("[AC-38] automation reference write is audited and invalidates caches only after commit", async () => {
  (GranotAutomationSource as unknown as MutableModel).findById = () =>
    leanById({ _id: automationId, granot_crm_source: null });
  (Crm as unknown as MutableModel).findById = () => leanById({ _id: crmId });
  let updated = false;
  (GranotAutomationSource as unknown as MutableModel).updateOne = () => ({
    exec: async () => {
      updated = true;
      return { modifiedCount: 1 };
    },
  });

  const order: string[] = [];
  const result = await setGranotAutomationSourceReference(
    {
      id: String(automationId),
      granot_crm_source: String(crmId),
      reason: "Unit 06 reviewed Granot source Registry classification apply",
    },
    OWNER,
    {
      withTransaction: async (fn) => {
        order.push("transaction-start");
        const value = await fn({} as ClientSession);
        order.push("transaction-commit");
        return value;
      },
      insertAudit: async (_session, input) => {
        order.push("audit");
        assert.equal(input.entityType, "granot_automation_source");
        assert.equal(input.entityId, String(automationId));
        assert.equal(input.after?.granot_crm_source, String(crmId));
        assert.equal("payload" in (input.metadata ?? {}), false);
      },
    },
  );

  assert.equal(result.granot_crm_source, String(crmId));
  assert.equal(updated, true);
  assert.deepEqual(order, ["transaction-start", "audit", "transaction-commit"]);
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), [
    [
      "granot_lifecycle_source_policy",
      "granot_lifecycle_source_list",
      "granot_lifecycle_source_health",
    ],
  ]);
});

test("[AC-38] replay of the same automation reference is a no-op write", async () => {
  (GranotAutomationSource as unknown as MutableModel).findById = () =>
    leanById({ _id: automationId, granot_crm_source: crmId });
  (Crm as unknown as MutableModel).findById = () => leanById({ _id: crmId });
  let updated = false;
  (GranotAutomationSource as unknown as MutableModel).updateOne = () => ({
    exec: async () => {
      updated = true;
      return { modifiedCount: 1 };
    },
  });

  const result = await setGranotAutomationSourceReference(
    {
      id: String(automationId),
      granot_crm_source: String(crmId),
      reason: "Unit 06 reviewed Granot source Registry classification apply",
    },
    OWNER,
    {
      withTransaction: async (fn) => fn({} as ClientSession),
      insertAudit: async (_session, input) => {
        assert.equal(input.before?.granot_crm_source, String(crmId));
        assert.equal(input.after?.granot_crm_source, String(crmId));
      },
    },
  );
  assert.equal(result.granot_crm_source, String(crmId));
  assert.equal(updated, false);
});

test("[AC-38] audit failure leaves the automation reference unapplied", async () => {
  (GranotAutomationSource as unknown as MutableModel).findById = () =>
    leanById({ _id: automationId, granot_crm_source: null });
  (Crm as unknown as MutableModel).findById = () => leanById({ _id: crmId });
  (GranotAutomationSource as unknown as MutableModel).updateOne = () => ({
    exec: async () => ({ modifiedCount: 1 }),
  });

  let committed = false;
  await assert.rejects(
    () =>
      setGranotAutomationSourceReference(
        {
          id: String(automationId),
          granot_crm_source: String(crmId),
          reason: "Unit 06 reviewed Granot source Registry classification apply",
        },
        OWNER,
        {
          withTransaction: async (fn) => {
            try {
              const value = await fn({} as ClientSession);
              committed = true;
              return value;
            } catch (error) {
              committed = false;
              throw error;
            }
          },
          insertAudit: async () => {
            throw new Error("audit insert failed");
          },
        },
      ),
    /audit insert failed/,
  );
  assert.equal(committed, false);
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), []);
});

test("Admin actors cannot write automation references", async () => {
  await assert.rejects(
    () =>
      setGranotAutomationSourceReference(
        {
          id: String(automationId),
          granot_crm_source: String(crmId),
          reason: "Unit 06 reviewed Granot source Registry classification apply",
        },
        { ...OWNER, actorRole: "admin" },
      ),
    (error: unknown) =>
      error instanceof RegistryError && error.registryCode === "REGISTRY_FORBIDDEN",
  );
});
