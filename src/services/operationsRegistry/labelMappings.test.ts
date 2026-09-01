import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { LeadSourceLabelMapping } from "../../models/LeadSourceLabelMapping";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getLeadSourceLabelMappingModel } from "../../models/LeadSourceLabelMapping";
import { RegistryError } from "./errors";
import {
  resetRegistryCacheInvalidationForTests,
} from "./cacheInvalidation";
import {
  consultStaticSourceLabelMap,
  createLabelMapping,
  getStaticSourceLabelMapConsultCount,
  listLabelMappings,
  normalizeSourceLabel,
  resetStaticSourceLabelMapConsultsForTests,
  resolveLabelToFeed,
  resolveSheetOrLegacyLabel,
  setLabelMappingActivation,
} from "./labelMappings";
import type { RegistryActorContext, TransactionRunner } from "./types";

const companyId = new mongoose.Types.ObjectId();
const otherCompanyId = new mongoose.Types.ObjectId();
const feedId = new mongoose.Types.ObjectId();
const mappingId = new mongoose.Types.ObjectId();
const replacementId = new mongoose.Types.ObjectId();

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "admin_owner_1",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_label_mapping_1",
};

type MutableModel = Record<string, unknown>;

const Mapping = getLeadSourceLabelMappingModel();
const Company = getLeadSourceCompanyModel();
const Granularity = getLeadSourceGranularityModel();

const originals = {
  mappingFind: Mapping.find,
  mappingFindOne: Mapping.findOne,
  mappingFindById: Mapping.findById,
  mappingCreate: Mapping.create,
  mappingFindByIdAndUpdate: Mapping.findByIdAndUpdate,
  companyFindById: Company.findById,
  granularityFindById: Granularity.findById,
};

afterEach(() => {
  (Mapping as unknown as MutableModel).find = originals.mappingFind;
  (Mapping as unknown as MutableModel).findOne = originals.mappingFindOne;
  (Mapping as unknown as MutableModel).findById = originals.mappingFindById;
  (Mapping as unknown as MutableModel).create = originals.mappingCreate;
  (Mapping as unknown as MutableModel).findByIdAndUpdate =
    originals.mappingFindByIdAndUpdate;
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Granularity as unknown as MutableModel).findById = originals.granularityFindById;
  resetRegistryCacheInvalidationForTests();
  resetStaticSourceLabelMapConsultsForTests();
});

const passthroughTransaction: TransactionRunner = async (fn) =>
  fn({} as ClientSession);

function lean(result: unknown) {
  return {
    session() {
      return this;
    },
    select() {
      return this;
    },
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    label: "Best Relocation Forms",
    namespace: "sheet_lead_source" as const,
    source_company: String(companyId),
    source_granularity: String(feedId),
    change_reason: "Map the sheet Source Company spelling to this Feed",
    ...overrides,
  };
}

function mappingDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: mappingId,
    label: "Best Relocation Forms",
    normalized_label: "best relocation forms",
    namespace: "sheet_lead_source",
    source_company: companyId,
    source_granularity: feedId,
    active: true,
    created_by: {
      actor_type: "owner",
      actor_id: OWNER.actorId,
      actor_label: OWNER.actorLabel,
      actor_role: "owner",
      request_id: OWNER.requestId,
    },
    change_reason: "Map the sheet Source Company spelling to this Feed",
    toObject() {
      return { ...this };
    },
    ...overrides,
  };
}

function stubActiveDestination(options: {
  feedActive?: boolean;
  companyActive?: boolean;
  feedCompanyId?: mongoose.Types.ObjectId;
} = {}) {
  (Company as unknown as MutableModel).findById = () =>
    lean({
      _id: companyId,
      active: options.companyActive !== false,
      company_slug: "best_relocation_leads",
      owner_label: "Best Relocation Leads",
      name: "Best Relocation Leads",
    });
  (Granularity as unknown as MutableModel).findById = () =>
    lean({
      _id: feedId,
      source_company: options.feedCompanyId ?? companyId,
      active: options.feedActive !== false,
      granularity_key: "best_relocation_leads_form",
      owner_label: "Best Relocation Forms",
      crm_label: "Best Relocation Forms",
    });
}

test("normalizeSourceLabel applies NFKC", () => {
  assert.equal(normalizeSourceLabel("Cafe\u0301"), "café");
});

test("normalizeSourceLabel collapses internal whitespace", () => {
  assert.equal(normalizeSourceLabel("Best   Relocation   Forms"), "best relocation forms");
});

test("normalizeSourceLabel trims", () => {
  assert.equal(normalizeSourceLabel("  Best Relocation Forms  "), "best relocation forms");
});

test("normalizeSourceLabel lowercases", () => {
  assert.equal(normalizeSourceLabel("Best Relocation Forms"), "best relocation forms");
});

test("normalizeSourceLabel folds full-width characters", () => {
  assert.equal(normalizeSourceLabel("Ｂｅｓｔ Relocation Forms"), "best relocation forms");
});

test("normalizeSourceLabel collapses a non-breaking space", () => {
  assert.equal(
    normalizeSourceLabel("Best\u00A0Relocation Forms"),
    "best relocation forms",
  );
});

test("create rejects a client-supplied normalized_label", async () => {
  await assert.rejects(
    () =>
      createLabelMapping(
        command({ normalized_label: "best relocation forms" }),
        OWNER,
        { withTransaction: passthroughTransaction, insertAudit: async () => undefined },
      ),
    (error: unknown) =>
      error instanceof RegistryError &&
      /normalized_label is server-derived/.test(error.message),
  );
});

test("create rejects a change_reason shorter than 10 or longer than 1000", async () => {
  await assert.rejects(
    () =>
      createLabelMapping(command({ change_reason: "too short" }), OWNER, {
        withTransaction: passthroughTransaction,
        insertAudit: async () => undefined,
      }),
    /change_reason must be between 10 and 1000/,
  );
  await assert.rejects(
    () =>
      createLabelMapping(command({ change_reason: "x".repeat(1001) }), OWNER, {
        withTransaction: passthroughTransaction,
        insertAudit: async () => undefined,
      }),
    /change_reason must be between 10 and 1000/,
  );
});

test("create validation order: Feed exists, belongs to Lead Source, is active, then collision", async () => {
  const seen: string[] = [];
  (Granularity as unknown as MutableModel).findById = () => {
    seen.push("feed");
    return lean(null);
  };
  await assert.rejects(
    () =>
      createLabelMapping(command(), OWNER, {
        withTransaction: passthroughTransaction,
        insertAudit: async () => undefined,
      }),
    /Feed not found/,
  );
  assert.deepEqual(seen, ["feed"]);

  stubActiveDestination({ feedCompanyId: otherCompanyId });
  (Company as unknown as MutableModel).findById = () => {
    seen.push("company");
    return lean({
      _id: companyId,
      active: true,
      company_slug: "best_relocation_leads",
    });
  };
  await assert.rejects(
    () =>
      createLabelMapping(command(), OWNER, {
        withTransaction: passthroughTransaction,
        insertAudit: async () => undefined,
      }),
    (error: unknown) =>
      error instanceof RegistryError &&
      error.message.includes(String(feedId)) &&
      error.message.includes(String(otherCompanyId)) &&
      error.message.includes(String(companyId)),
  );

  stubActiveDestination({ feedActive: false });
  await assert.rejects(
    () =>
      createLabelMapping(command(), OWNER, {
        withTransaction: passthroughTransaction,
        insertAudit: async () => undefined,
      }),
    /Feed must be active/,
  );

  stubActiveDestination();
  (Mapping as unknown as MutableModel).findOne = () => lean({ _id: mappingId });
  await assert.rejects(
    () =>
      createLabelMapping(command(), OWNER, {
        withTransaction: passthroughTransaction,
        insertAudit: async () => undefined,
      }),
    (error: unknown) =>
      error instanceof RegistryError &&
      error.registryCode === "REGISTRY_DUPLICATE_IDENTIFIER",
  );
});

test("unique index is defined separately from the service collision check", () => {
  const indexes = LeadSourceLabelMapping.schema.indexes();
  const unique = (
    indexes as Array<
      [{ namespace?: number; normalized_label?: number }, { unique?: boolean }]
    >
  ).find(
    ([fields, options]) =>
      fields.namespace === 1 &&
      fields.normalized_label === 1 &&
      options.unique === true,
  );
  assert.ok(unique, "partial unique index on { namespace, normalized_label }");
  assert.deepEqual(
    (unique?.[1] as { partialFilterExpression?: unknown }).partialFilterExpression,
    { active: true },
  );
});

test("create writes through the registry audit trail", async () => {
  stubActiveDestination();
  (Mapping as unknown as MutableModel).findOne = () => lean(null);
  (Mapping as unknown as MutableModel).create = async () => [mappingDoc()];
  let audited = false;
  const result = await createLabelMapping(command(), OWNER, {
    withTransaction: passthroughTransaction,
    insertAudit: async (_session, input) => {
      audited = true;
      assert.equal(input.entityType, "source_label_mapping");
      assert.equal(input.action, "create");
      assert.equal(input.reason, command().change_reason);
      assert.equal(input.actor.actorId, OWNER.actorId);
      assert.equal(input.after?.normalized_label, "best relocation forms");
    },
  });
  assert.equal(result.normalized_label, "best relocation forms");
  assert.equal(audited, true);
});

test("there is no in-place destination edit; correction is deactivate then create", async () => {
  stubActiveDestination();
  const archived = mappingDoc({
    active: false,
    archived_at: new Date("2026-09-01T12:00:00.000Z"),
  });
  (Mapping as unknown as MutableModel).findById = () => lean(archived);
  (Mapping as unknown as MutableModel).findByIdAndUpdate = () => ({
    orFail: async () => ({
      toObject: () => archived,
    }),
  });
  const deactivated = await setLabelMappingActivation(
    String(mappingId),
    false,
    "Retire the misspelled mapping before replacing it",
    OWNER,
    {
      withTransaction: passthroughTransaction,
      insertAudit: async (_session, input) => {
        assert.equal(input.action, "deactivate");
        assert.equal(input.entityType, "source_label_mapping");
      },
    },
  );
  assert.equal(deactivated.active, false);
  assert.ok(deactivated.archived_at);

  (Mapping as unknown as MutableModel).findOne = () => lean(null);
  (Mapping as unknown as MutableModel).create = async () => [
    mappingDoc({ _id: replacementId, label: "BestRelocation Forms" }),
  ];
  const replacement = await createLabelMapping(
    command({ label: "BestRelocation Forms" }),
    OWNER,
    {
      withTransaction: passthroughTransaction,
      insertAudit: async () => undefined,
    },
  );
  assert.equal(replacement.id, String(replacementId));
  assert.notEqual(replacement.id, deactivated.id);
});

test("schema validation rejects a mismatched normalized_label", async () => {
  const document = new LeadSourceLabelMapping({
    label: "Best Relocation Forms",
    normalized_label: "wrong",
    namespace: "sheet_lead_source",
    source_company: companyId,
    source_granularity: feedId,
    active: true,
    created_by: {
      actor_type: "owner",
      actor_id: "owner-1",
      actor_label: "owner@example.test",
      actor_role: "owner",
      request_id: "req-1",
    },
    change_reason: "Seed a mapping with a derived normalized label",
  });
  await assert.rejects(() => document.validate(), /normalized_label must equal/);
});

test("schema validation rejects post-create changes to destination fields", async () => {
  const document = new LeadSourceLabelMapping({
    label: "Best Relocation Forms",
    normalized_label: "best relocation forms",
    namespace: "sheet_lead_source",
    source_company: companyId,
    source_granularity: feedId,
    active: true,
    created_by: {
      actor_type: "owner",
      actor_id: "owner-1",
      actor_label: "owner@example.test",
      actor_role: "owner",
      request_id: "req-1",
    },
    change_reason: "Seed a mapping for immutability proof",
  });
  await document.validate();
  document.isNew = false;
  const original = String(document.source_granularity);
  document.set("source_granularity", otherCompanyId);
  try {
    await document.validate();
  } catch (error) {
    assert.match(String(error), /immutable/);
    return;
  }
  assert.equal(
    String(document.source_granularity),
    original,
    "immutable destination field must not change in place",
  );
});

test("resolveLabelToFeed returns not_found without throwing", async () => {
  (Mapping as unknown as MutableModel).find = () => lean([]);
  const result = await resolveLabelToFeed(
    "sheet_lead_source",
    "Unknown Sheet Label",
  );
  assert.equal(result.status, "not_found");
});

test("resolveLabelToFeed returns ambiguous when two active mappings collide", async () => {
  (Mapping as unknown as MutableModel).find = () =>
    lean([
      mappingDoc(),
      mappingDoc({ _id: replacementId, source_company: otherCompanyId }),
    ]);
  const result = await resolveLabelToFeed(
    "sheet_lead_source",
    "Best Relocation Forms",
  );
  assert.equal(result.status, "ambiguous");
  if (result.status === "ambiguous") {
    assert.equal(result.candidates.length, 2);
  }
});

test("listLabelMappings filters by Feed, Lead Source, and namespace", async () => {
  (Mapping as unknown as MutableModel).find = () => lean([mappingDoc()]);
  const rows = await listLabelMappings({
    source_company: String(companyId),
    source_granularity: String(feedId),
    namespace: "sheet_lead_source",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.source_granularity, String(feedId));
});

test("consultStaticSourceLabelMap increments the instrumented counter", () => {
  resetStaticSourceLabelMapConsultsForTests();
  assert.equal(consultStaticSourceLabelMap("Best Relocation Forms"), "best_relocation_leads");
  assert.equal(getStaticSourceLabelMapConsultCount(), 1);
});
