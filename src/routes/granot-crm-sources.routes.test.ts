import assert from "node:assert/strict";
import { test } from "node:test";
import {
  granotCrmSourceLifecycleActivationSchema,
  granotCrmSourceRegistryUpdateSchema,
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

test("[AC-38] Granot CRM source update rejects create_if_missing and client normalized labels", () => {
  assert.throws(
    () =>
      granotCrmSourceRegistryUpdateSchema.parse({
        ...validUpdate,
        lead_created_policy: "create_if_missing",
      }),
    /create_if_missing|Invalid/,
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
