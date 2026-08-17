import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { OperationsRegistryChange } from "../../models/OperationsRegistryChange";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { RegistryError } from "./errors";
import {
  getRegistryCacheInvalidationLogForTests,
  resetRegistryCacheInvalidationForTests,
} from "./cacheInvalidation";
import {
  createOrUpdateGranotCrmSource,
  getRegistryGranotCrmSource,
  resetGranotCrmSourceCachesForTests,
  setGranotCrmSourceLifecycleEnabled,
} from "./granotCrmSources";
import type { RegistryActorContext, TransactionRunner } from "./types";

const companyId = new mongoose.Types.ObjectId();
const localId = new mongoose.Types.ObjectId();
const longId = new mongoose.Types.ObjectId();
const sourceId = new mongoose.Types.ObjectId();

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "admin_owner_1",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_granot_source_1",
};

const ADMIN: RegistryActorContext = {
  ...OWNER,
  actorRole: "admin",
  requestId: "req_granot_source_admin",
};

type MutableModel = Record<string, unknown>;

const Source = getGranotCrmSourceModel();
const Company = getLeadSourceCompanyModel();
const Granularity = getLeadSourceGranularityModel();

const originals = {
  sourceFindById: Source.findById,
  sourceFindOne: Source.findOne,
  sourceCreate: Source.create,
  sourceFindByIdAndUpdate: Source.findByIdAndUpdate,
  companyFindById: Company.findById,
  granularityFindById: Granularity.findById,
};

afterEach(() => {
  (Source as unknown as MutableModel).findById = originals.sourceFindById;
  (Source as unknown as MutableModel).findOne = originals.sourceFindOne;
  (Source as unknown as MutableModel).create = originals.sourceCreate;
  (Source as unknown as MutableModel).findByIdAndUpdate =
    originals.sourceFindByIdAndUpdate;
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Granularity as unknown as MutableModel).findById = originals.granularityFindById;
  resetRegistryCacheInvalidationForTests();
  resetGranotCrmSourceCachesForTests();
});

function ownerCommand(overrides: Record<string, unknown> = {}) {
  return {
    crm_origin: "https://eagle.example.test",
    workspace_slug: "synthetic-bestrelocation-forms",
    granot_label: "BestRelocation Forms",
    default_channel: "form" as const,
    source_company: "not_provided",
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead" as const,
    lead_created_policy: "link_only" as const,
    lead_source_company: String(companyId),
    lifecycle_policy_version: "best-relocation-forms/v1",
    lifecycle_routes: [
      {
        route_key: "form_local",
        lead_model: "FormLead" as const,
        move_type: "local" as const,
        source_granularity_id: String(localId),
      },
      {
        route_key: "form_long",
        lead_model: "FormLead" as const,
        move_type: "long_distance" as const,
        source_granularity_id: String(longId),
      },
    ],
    reason: "Reviewed synthetic Best Relocation Forms policy",
    ...overrides,
  };
}

function createdDoc(overrides: Record<string, unknown> = {}) {
  const command = ownerCommand(overrides);
  return {
    _id: sourceId,
    ...command,
    normalized_granot_label: "bestrelocation forms",
    lead_source_company: companyId,
    lifecycle_routes: command.lifecycle_routes.map((route) => ({
      ...route,
      source_granularity_id:
        route.route_key === "form_local" ? localId : longId,
    })),
    toObject() {
      return { ...this };
    },
  };
}

function leanById(result: unknown) {
  return {
    session() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

function stubActiveDependencies(): void {
  (Company as unknown as MutableModel).findById = () =>
    leanById({ _id: companyId, active: true });
  (Granularity as unknown as MutableModel).findById = (id: unknown) => {
    const value = String(id);
    if (value === String(localId)) {
      return leanById({
        _id: localId,
        source_company: companyId,
        active: true,
        channel: "form",
        local: "local",
      });
    }
    return leanById({
      _id: longId,
      source_company: companyId,
      active: true,
      channel: "form",
      local: "long_distance",
    });
  };
}

test("Admin and missing-reason actors cannot mutate Granot CRM source policy", async () => {
  await assert.rejects(
    () => createOrUpdateGranotCrmSource(ownerCommand(), ADMIN),
    (error: unknown) =>
      error instanceof RegistryError && error.registryCode === "REGISTRY_FORBIDDEN",
  );
  await assert.rejects(
    () =>
      createOrUpdateGranotCrmSource(
        ownerCommand({ reason: "   " }),
        OWNER,
      ),
    /explicit reason/,
  );
});

test("[AC-38] Owner create validates inside the transaction and pairs one sanitized granot_crm_source audit", async () => {
  stubActiveDependencies();
  (Source as unknown as MutableModel).findOne = () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => null,
  });
  (Source as unknown as MutableModel).create = async () => [createdDoc()];

  const order: string[] = [];
  const transaction: TransactionRunner = async (fn) => {
    order.push("transaction-start");
    const result = await fn({} as ClientSession);
    order.push("transaction-commit");
    return result;
  };

  const result = await createOrUpdateGranotCrmSource(ownerCommand(), OWNER, {
    withTransaction: transaction,
    insertAudit: async (_session, input) => {
      order.push("audit");
      assert.equal(input.entityType, "granot_crm_source");
      assert.equal(input.entityId, String(sourceId));
      assert.equal(input.reason, "Reviewed synthetic Best Relocation Forms policy");
      assert.equal(input.actor.requestId, OWNER.requestId);
      assert.equal(input.before, null);
      assert.equal(input.after?.lifecycle_enabled, true);
      assert.equal(input.after?.normalized_granot_label, "bestrelocation forms");
      assert.equal("api_secret" in (input.after ?? {}), false);
      assert.equal("payload" in (input.metadata ?? {}), false);
    },
  });

  assert.equal(result.lifecycle_enabled, true);
  assert.deepEqual(order, ["transaction-start", "audit", "transaction-commit"]);
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), [
    [
      "granot_lifecycle_source_policy",
      "granot_lifecycle_source_list",
      "granot_lifecycle_source_health",
    ],
  ]);
});

test("[AC-38] audit failure rolls back mutation and does not invalidate caches", async () => {
  stubActiveDependencies();
  (Source as unknown as MutableModel).findOne = () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => null,
  });
  let created = false;
  (Source as unknown as MutableModel).create = async () => {
    created = true;
    return [createdDoc()];
  };

  let committed = false;
  await assert.rejects(
    () =>
      createOrUpdateGranotCrmSource(ownerCommand(), OWNER, {
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
          throw new Error("audit insert failed");
        },
      }),
    /audit insert failed/,
  );
  assert.equal(created, true);
  assert.equal(committed, false);
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), []);
});

test("duplicate request IDs remain a stable replay conflict", async () => {
  stubActiveDependencies();
  (Source as unknown as MutableModel).findOne = () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => null,
  });
  (Source as unknown as MutableModel).create = async () => [createdDoc()];

  await assert.rejects(
    () =>
      createOrUpdateGranotCrmSource(ownerCommand(), OWNER, {
        withTransaction: async (fn) => fn({} as ClientSession),
        insertAudit: async () => {
          throw {
            code: 11000,
            keyPattern: { request_id: 1 },
            keyValue: { request_id: OWNER.requestId },
          };
        },
      }),
    (error: unknown) =>
      error instanceof RegistryError &&
      error.registryCode === "REGISTRY_DUPLICATE_IDENTIFIER",
  );
  assert.deepEqual(getRegistryCacheInvalidationLogForTests(), []);
});

test("inactive or mismatched references fail closed and do not write", async () => {
  (Company as unknown as MutableModel).findById = () =>
    leanById({ _id: companyId, active: false });
  (Granularity as unknown as MutableModel).findById = () =>
    leanById({
      _id: localId,
      source_company: companyId,
      active: true,
      channel: "form",
      local: "local",
    });
  let created = false;
  (Source as unknown as MutableModel).create = async () => {
    created = true;
    return [createdDoc()];
  };

  await assert.rejects(
    () =>
      createOrUpdateGranotCrmSource(ownerCommand(), OWNER, {
        withTransaction: async (fn) => fn({} as ClientSession),
        insertAudit: async () => {
          throw new Error("audit should not run");
        },
      }),
    /active Source Company/,
  );
  assert.equal(created, false);
});

test("setGranotCrmSourceLifecycleEnabled reuses the audited Owner command", async () => {
  stubActiveDependencies();
  const existing = createdDoc({ lifecycle_enabled: false });
  (Source as unknown as MutableModel).findById = () => leanById(existing);
  (Source as unknown as MutableModel).findOne = () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => null,
  });
  (Source as unknown as MutableModel).findByIdAndUpdate = () => ({
    orFail: async () => createdDoc({ lifecycle_enabled: false }),
  });

  const result = await setGranotCrmSourceLifecycleEnabled(
    {
      id: String(sourceId),
      lifecycle_enabled: false,
      reason: "Disable synthetic lifecycle effects",
    },
    OWNER,
    {
      withTransaction: async (fn) => fn({} as ClientSession),
      insertAudit: async (_session, input) => {
        assert.equal(input.entityType, "granot_crm_source");
        assert.equal(input.reason, "Disable synthetic lifecycle effects");
      },
    },
  );
  assert.equal(result.lifecycle_enabled, false);
});

test("read-after-write does not return a cached precommit policy projection", async () => {
  const committed = createdDoc();
  (Source as unknown as MutableModel).findById = (id: unknown) => {
    assert.equal(String(id), String(sourceId));
    return leanById(committed);
  };
  resetGranotCrmSourceCachesForTests();
  const read = await getRegistryGranotCrmSource(String(sourceId));
  assert.equal(read.normalized_granot_label, "bestrelocation forms");
  assert.equal(read.lifecycle_enabled, true);
});

test("[AC-38] replica-set create commits mutation and audit together then invalidates caches", async (t) => {
  const session = await connectReplicaSetForTests();
  if (!session.ok) {
    t.skip(session.reason);
    return;
  }

  restoreModelStubs();
  const suffix = Date.now().toString(36);
  const company = await Company.create({
    company_slug: `synthetic_br_${suffix}`,
    name: "Synthetic Best Relocation",
    owner_label: "Synthetic Best Relocation",
    active: true,
    created_from: "unit-05-test",
  });
  const local = await Granularity.create({
    source_company: company._id,
    granularity_key: `synthetic_br_forms_local_${suffix}`,
    channel: "form",
    owner_label: "Synthetic BR Local Forms",
    crm_label: "Synthetic BR Local Forms",
    active: true,
    local: "local",
    created_from: "unit-05-test",
  });
  const longDistance = await Granularity.create({
    source_company: company._id,
    granularity_key: `synthetic_br_forms_long_${suffix}`,
    channel: "form",
    owner_label: "Synthetic BR Long Forms",
    crm_label: "Synthetic BR Long Forms",
    active: true,
    local: "long_distance",
    created_from: "unit-05-test",
  });

  const actor: RegistryActorContext = {
    ...OWNER,
    requestId: `req_granot_source_replica_${suffix}`,
  };
  resetRegistryCacheInvalidationForTests();
  resetGranotCrmSourceCachesForTests();

  try {
    const created = await createOrUpdateGranotCrmSource(
      ownerCommand({
        workspace_slug: `synthetic-bestrelocation-forms-${suffix}`,
        lead_source_company: String(company._id),
        lifecycle_routes: [
          {
            route_key: "form_local",
            lead_model: "FormLead",
            move_type: "local",
            source_granularity_id: String(local._id),
          },
          {
            route_key: "form_long",
            lead_model: "FormLead",
            move_type: "long_distance",
            source_granularity_id: String(longDistance._id),
          },
        ],
      }),
      actor,
    );
    const persisted = await Source.findById(created.id).lean().exec();
    const audit = await OperationsRegistryChange.findOne({
      request_id: actor.requestId,
    })
      .lean()
      .exec();
    assert.equal(persisted?.lifecycle_enabled, true);
    assert.equal(persisted?.normalized_granot_label, "bestrelocation forms");
    assert.equal(audit?.entity_type, "granot_crm_source");
    assert.equal(audit?.entity_id, created.id);
    assert.equal(audit?.reason, "Reviewed synthetic Best Relocation Forms policy");
    assert.deepEqual(getRegistryCacheInvalidationLogForTests(), [
      [
        "granot_lifecycle_source_policy",
        "granot_lifecycle_source_list",
        "granot_lifecycle_source_health",
      ],
    ]);
    const read = await getRegistryGranotCrmSource(created.id);
    assert.equal(read.lifecycle_policy_version, "best-relocation-forms/v1");

    await assert.rejects(
      () =>
        createOrUpdateGranotCrmSource(
          ownerCommand({
            workspace_slug: `synthetic-bestrelocation-forms-dup-${suffix}`,
            lead_source_company: String(company._id),
            lifecycle_routes: [
              {
                route_key: "form_local",
                lead_model: "FormLead",
                move_type: "local",
                source_granularity_id: String(local._id),
              },
              {
                route_key: "form_long",
                lead_model: "FormLead",
                move_type: "long_distance",
                source_granularity_id: String(longDistance._id),
              },
            ],
            reason: "Duplicate normalized label must fail closed",
          }),
          { ...actor, requestId: `req_granot_source_replica_dup_${suffix}` },
        ),
      /already in use/,
    );
  } finally {
    await Source.deleteMany({
      workspace_slug: new RegExp(`^synthetic-bestrelocation-forms`),
    });
    await Granularity.deleteMany({ _id: { $in: [local._id, longDistance._id] } });
    await Company.deleteMany({ _id: company._id });
    await OperationsRegistryChange.deleteMany({
      request_id: new RegExp(`^req_granot_source_replica_`),
    });
    await session.close();
  }
});

function restoreModelStubs(): void {
  (Source as unknown as MutableModel).findById = originals.sourceFindById;
  (Source as unknown as MutableModel).findOne = originals.sourceFindOne;
  (Source as unknown as MutableModel).create = originals.sourceCreate;
  (Source as unknown as MutableModel).findByIdAndUpdate =
    originals.sourceFindByIdAndUpdate;
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Granularity as unknown as MutableModel).findById = originals.granularityFindById;
}

async function connectReplicaSetForTests(): Promise<
  { ok: true; close: () => Promise<void> } | { ok: false; reason: string }
> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    return {
      ok: false,
      reason: "Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.",
    };
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    return {
      ok: false,
      reason: "Replica-set proof requires TEST_MODE=true before process start.",
    };
  }
  if (!process.env.MONGO_URI) {
    try {
      const { config } = await import("dotenv");
      config({ path: ".env" });
    } catch {
      return { ok: false, reason: "MONGO_URI is not set and .env could not be loaded." };
    }
  }
  if (!process.env.MONGO_URI) {
    return { ok: false, reason: "MONGO_URI is not set." };
  }
  try {
    await connectMongo();
    if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
      return {
        ok: false,
        reason: "Refusing replica-set proof against a non-test database.",
      };
    }
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (!hello || hello.setName == null) {
      return { ok: false, reason: "Connected Mongo is not a replica set." };
    }
    return {
      ok: true,
      close: async () => undefined,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Mongo connection failed.",
    };
  }
}
