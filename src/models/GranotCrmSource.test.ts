import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  GRANOT_CRM_SOURCE_COLLECTION,
  GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES,
  GRANOT_CRM_SOURCE_MODEL_NAME,
  GranotCrmSource,
  getGranotCrmSourceModel,
} from "./GranotCrmSource";
import {
  validateGranotCrmSourceSemantics,
  type GranotCrmSourceSemanticsInput,
  type LoadedGranularityRef,
} from "./granotCrmSourceSemantics";
import { normalizeGranotSourceLabel } from "../services/granotLifecycle/sourceLabel";

const companyId = new mongoose.Types.ObjectId();
const formLocalId = new mongoose.Types.ObjectId();
const formLongId = new mongoose.Types.ObjectId();
const callAnyId = new mongoose.Types.ObjectId();

function source(overrides: Record<string, unknown> = {}) {
  return new GranotCrmSource({
    crm_origin: "https://eagle.example.test",
    workspace_slug: "synthetic-deferred",
    granot_label: "Synthetic Deferred",
    ...overrides,
  });
}

function scopedInput(
  overrides: Partial<GranotCrmSourceSemanticsInput> = {},
): GranotCrmSourceSemanticsInput {
  return {
    granot_label: "BestRelocation Forms",
    enabled: true,
    lifecycle_enabled: false,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: String(companyId),
    lifecycle_routes: [
      {
        route_key: "form_local",
        lead_model: "FormLead",
        move_type: "local",
        source_granularity_id: String(formLocalId),
      },
      {
        route_key: "form_long",
        lead_model: "FormLead",
        move_type: "long_distance",
        source_granularity_id: String(formLongId),
      },
    ],
    lifecycle_policy_version: "",
    ...overrides,
  };
}

function granularity(
  id: mongoose.Types.ObjectId,
  channel: "form" | "call",
  local?: "local" | "long_distance",
  active = true,
): LoadedGranularityRef {
  return {
    id: String(id),
    source_company_id: String(companyId),
    active,
    channel,
    local,
  };
}

test("GranotCrmSource keeps the operational CSV collection and model name", () => {
  assert.equal(GranotCrmSource.modelName, GRANOT_CRM_SOURCE_MODEL_NAME);
  assert.equal(GranotCrmSource.collection.collectionName, GRANOT_CRM_SOURCE_COLLECTION);
  assert.equal(getGranotCrmSourceModel().modelName, GRANOT_CRM_SOURCE_MODEL_NAME);
});

test("legacy and new rows default to disabled deferred observation-only policy", async () => {
  const document = source();
  await document.validate();
  assert.equal(document.enabled, true);
  assert.equal(document.lifecycle_enabled, false);
  assert.equal(document.lifecycle_disposition, "deferred");
  assert.equal(document.lead_created_policy, "observation_only");
  assert.deepEqual(document.lifecycle_routes, []);
  assert.equal(document.lifecycle_policy_version, "");
  assert.equal(document.normalized_granot_label, undefined);
  assert.equal(document.lead_source_company, undefined);
  assert.equal(document.source_company, "not_provided");
});

test("declares the three named lifecycle indexes without removing CSV uniqueness", () => {
  const indexes = GranotCrmSource.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;
  const originWorkspace = indexes.find(
    ([key]) => key.crm_origin === 1 && key.workspace_slug === 1,
  );
  assert.equal(originWorkspace?.[1].unique, true);

  for (const expected of GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES) {
    const declared = indexes.find(([, options]) => options.name === expected.name);
    assert.ok(declared, expected.name);
    assert.deepEqual(declared?.[0], expected.key);
    if ("unique" in expected) {
      assert.equal(declared?.[1].unique, true);
    } else {
      assert.notEqual(declared?.[1].unique, true);
    }
  }
  assert.equal(GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES[0]?.name, "granot_crm_source_normalized_label_unique");
});

test("normalized labels use NFKC, trim, collapse, lowercase, and reject empty/control/bidi", () => {
  assert.equal(
    normalizeGranotSourceLabel("  BestRelocation\u00A0Forms  "),
    "bestrelocation forms",
  );
  assert.equal(normalizeGranotSourceLabel("   "), undefined);
  assert.equal(normalizeGranotSourceLabel("Paid\u0007Overflow"), undefined);
  assert.equal(normalizeGranotSourceLabel("Auto\u202E"), undefined);
});

test("model writes reject illegal Call/Form/mixed/ambiguous routes", async () => {
  await assert.rejects(
    source({
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      lead_source_company: companyId,
      lifecycle_routes: [
        {
          route_key: "call_any",
          lead_model: "CallLead",
          move_type: "any",
          source_granularity_id: callAnyId,
        },
        {
          route_key: "form_any",
          lead_model: "FormLead",
          move_type: "any",
          source_granularity_id: formLocalId,
        },
      ],
    }).validate(),
    /mixed|Call and Form/,
  );
  await assert.rejects(
    source({
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      lead_source_company: companyId,
      lifecycle_routes: [
        {
          route_key: "call_local",
          lead_model: "CallLead",
          move_type: "local",
          source_granularity_id: callAnyId,
        },
      ],
    }).validate(),
    /Call routing/,
  );
  await assert.rejects(
    source({
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      lead_source_company: companyId,
      lifecycle_routes: [
        {
          route_key: "form_local",
          lead_model: "FormLead",
          move_type: "local",
          source_granularity_id: formLocalId,
        },
        {
          route_key: "form_local_dup",
          lead_model: "FormLead",
          move_type: "local",
          source_granularity_id: formLongId,
        },
      ],
    }).validate(),
    /Form routing|duplicate/,
  );
  await assert.rejects(
    source({
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      lead_source_company: companyId,
      lifecycle_routes: [
        {
          route_key: "same",
          lead_model: "FormLead",
          move_type: "local",
          source_granularity_id: formLocalId,
        },
        {
          route_key: "same",
          lead_model: "FormLead",
          move_type: "long_distance",
          source_granularity_id: formLongId,
        },
      ],
    }).validate(),
    /route_key/,
  );
});

test("referral_booking and deferred reject Lead routes and non-observation policies", async () => {
  await assert.rejects(
    source({
      lifecycle_disposition: "deferred",
      lead_created_policy: "link_only",
    }).validate(),
    /observation_only/,
  );
  await assert.rejects(
    source({
      lifecycle_disposition: "referral_booking",
      lead_created_policy: "observation_only",
      lifecycle_routes: [
        {
          route_key: "form_any",
          lead_model: "FormLead",
          move_type: "any",
          source_granularity_id: formLocalId,
        },
      ],
    }).validate(),
    /must not have Lead routes/,
  );
  await assert.rejects(
    source({
      lifecycle_disposition: "deferred",
      lead_created_policy: "create_if_missing",
    }).validate(),
    /create_if_missing/,
  );
});

test("enabled source_scoped_lead requires active same-company matching-channel refs and policy version", () => {
  const refs = {
    company: { id: String(companyId), active: true },
    granularities: new Map([
      [String(formLocalId), granularity(formLocalId, "form", "local")],
      [String(formLongId), granularity(formLongId, "form", "long_distance")],
    ]),
  };
  const missingVersion = validateGranotCrmSourceSemantics(
    scopedInput({ lifecycle_enabled: true, lifecycle_policy_version: "" }),
    refs,
  );
  assert.equal(missingVersion.ok, false);

  const inactiveCompany = validateGranotCrmSourceSemantics(
    scopedInput({
      lifecycle_enabled: true,
      lifecycle_policy_version: "v1",
    }),
    { ...refs, company: { id: String(companyId), active: false } },
  );
  assert.equal(inactiveCompany.ok, false);

  const wrongChannel = validateGranotCrmSourceSemantics(
    scopedInput({
      lifecycle_enabled: true,
      lifecycle_policy_version: "v1",
    }),
    {
      company: { id: String(companyId), active: true },
      granularities: new Map([
        [String(formLocalId), granularity(formLocalId, "call")],
        [String(formLongId), granularity(formLongId, "form", "long_distance")],
      ]),
    },
  );
  assert.equal(wrongChannel.ok, false);

  const ok = validateGranotCrmSourceSemantics(
    scopedInput({
      lifecycle_enabled: true,
      lifecycle_policy_version: "best-relocation-forms/v1",
    }),
    refs,
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.normalized_granot_label, "bestrelocation forms");
  }
});

test("disabled rows may keep reviewed policy but still reject structurally illegal routes", () => {
  const refs = {
    company: { id: String(companyId), active: false },
    granularities: new Map([
      [String(formLocalId), granularity(formLocalId, "form", "local", false)],
      [String(formLongId), granularity(formLongId, "form", "long_distance", false)],
    ]),
  };
  const preserved = validateGranotCrmSourceSemantics(scopedInput(), refs);
  assert.equal(preserved.ok, true);

  const illegal = validateGranotCrmSourceSemantics(
    scopedInput({
      lifecycle_routes: [
        {
          route_key: "form_any",
          lead_model: "FormLead",
          move_type: "any",
          source_granularity_id: String(formLocalId),
        },
        {
          route_key: "form_local",
          lead_model: "FormLead",
          move_type: "local",
          source_granularity_id: String(formLongId),
        },
      ],
    }),
    refs,
  );
  assert.equal(illegal.ok, false);
});

test("client-supplied normalized labels that disagree with the server fail closed", () => {
  const result = validateGranotCrmSourceSemantics(
    scopedInput({ normalized_granot_label: "best relocation forms" }),
  );
  assert.equal(result.ok, false);
});
