import assert from "node:assert/strict";
import { test } from "node:test";
import {
  granotCrmSourceLifecycleActivationSchema,
  granotCrmSourceOutboundSmsSchema,
  granotCrmSourceRegistryUpdateSchema,
  ownerGranotNameCreateSchema,
} from "../validation/v1/admin.validation";

const validUpdate = {
  granot_label: "Best Relocation Forms",
  lifecycle_enabled: true,
  lifecycle_disposition: "source_scoped_lead",
  lead_created_policy: "link_only",
  lead_source_company: "aaaaaaaaaaaaaaaaaaaaaaaa",
  lifecycle_routes: [
    {
      route_key: "form_local",
      lead_model: "FormLead",
      move_type: "local",
      source_granularity_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    },
  ],
  lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
  reason: "Reviewed Best Relocation Forms policy after Owner inspection",
};

test("[AC-38] Granot CRM source update accepts create_if_missing and rejects client normalized labels", () => {
  assert.doesNotThrow(() =>
    granotCrmSourceRegistryUpdateSchema.parse({
      ...validUpdate,
      lead_created_policy: "create_if_missing",
    }),
  );
  assert.throws(
    () =>
      granotCrmSourceRegistryUpdateSchema.parse({
        ...validUpdate,
        normalized_granot_label: "best relocation forms",
      }),
    /unrecognized_keys|normalized_granot_label/,
  );
});

test("[AC-38] Granot CRM source mutations require a 10-1000 character reason", () => {
  assert.throws(
    () =>
      granotCrmSourceRegistryUpdateSchema.parse({
        ...validUpdate,
        reason: "short",
      }),
    /reason/,
  );
  assert.doesNotThrow(() =>
    granotCrmSourceRegistryUpdateSchema.parse(validUpdate),
  );
  assert.doesNotThrow(() =>
    granotCrmSourceLifecycleActivationSchema.parse({
      lifecycle_enabled: false,
      reason: "Disable reviewed source after Owner rollback review",
    }),
  );
});

test("[AC-38] Registry projections and update schemas omit payload and contact fields", () => {
  const parsed = granotCrmSourceRegistryUpdateSchema.parse(validUpdate);
  const serialized = JSON.stringify(parsed);
  assert.equal(serialized.includes("payload"), false);
  assert.equal(serialized.includes("phone"), false);
  assert.equal(serialized.includes("email"), false);
  assert.equal("normalized_granot_label" in parsed, false);
});

const validOwnerCreate = {
  name_received_from_granot: "Synthetic TBM Forms Prime",
  handling: "our_lead_source",
  destination: { kind: "one_feed", feed_id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
  when_lead_arrives: "create_if_missing",
  reason: "Owner created this Granot name for a form Feed",
};

test("Owner Granot create schema accepts one_feed intent and rejects unknown keys", () => {
  assert.doesNotThrow(() => ownerGranotNameCreateSchema.parse(validOwnerCreate));
  for (const key of [
    "crm_origin",
    "workspace_slug",
    "source_company",
    "lead_model",
    "route_key",
    "normalized_granot_label",
    "daily_cap",
  ]) {
    assert.throws(
      () =>
        ownerGranotNameCreateSchema.parse({
          ...validOwnerCreate,
          [key]: "must-reject",
        }),
      /unrecognized_keys/,
    );
  }
});

test("Owner Granot create schema rejects a short reason and raw lifecycle fields", () => {
  assert.throws(
    () =>
      ownerGranotNameCreateSchema.parse({
        ...validOwnerCreate,
        reason: "short",
      }),
    /reason/,
  );
  assert.throws(
    () =>
      ownerGranotNameCreateSchema.parse({
        ...validOwnerCreate,
        lifecycle_disposition: "source_scoped_lead",
      }),
    /unrecognized_keys/,
  );
});

test("outbound SMS Owner schema no longer accepts daily_cap", () => {
  assert.doesNotThrow(() =>
    granotCrmSourceOutboundSmsSchema.parse({
      enabled: false,
      body_template: "Hi {first_name}, this is Vantage Movers.",
      consent_basis: "existing_relationship",
      reason: "Updating confirmation text after Owner review",
    }),
  );
  assert.throws(
    () =>
      granotCrmSourceOutboundSmsSchema.parse({
        enabled: false,
        body_template: "Hi {first_name}, this is Vantage Movers.",
        consent_basis: "existing_relationship",
        daily_cap: 10,
        reason: "Updating confirmation text after Owner review",
      }),
    /unrecognized_keys|daily_cap/,
  );
});
