import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GranotCrmSource } from "./GranotCrmSource";
import {
  validateGranotCrmSourceSemantics,
  type GranotCrmSourceSemanticsInput,
  type LoadedGranularityRef,
} from "./granotCrmSourceSemantics";

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

test("client-supplied normalized labels that disagree with the server fail closed", () => {
  const result = validateGranotCrmSourceSemantics(
    scopedInput({ normalized_granot_label: "best relocation forms" }),
  );
  assert.equal(result.ok, false);
});
