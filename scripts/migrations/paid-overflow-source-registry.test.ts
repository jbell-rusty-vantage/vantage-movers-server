import assert from "node:assert/strict";
import { test } from "node:test";
import { GRANOT_LIFECYCLE_SOURCE_POLICY_VERSION } from "./granot-lifecycle-source-registry.manifest";
import { planGranotLifecycleSourceRegistry } from "./granot-lifecycle-source-registry.lib";
import { REVIEWED_GRANULARITY_KEYS } from "./granot-lifecycle-source-registry.manifest";
import { PAID_OVERFLOW_SOURCE } from "./paid-overflow-source-registry.lib";

test("Paid Overflow intended documents are exact and have no form/call split", () => {
  assert.equal(PAID_OVERFLOW_SOURCE.company_slug, "paid_overflow");
  assert.equal(PAID_OVERFLOW_SOURCE.name, "Paid Overflow");
  assert.equal(PAID_OVERFLOW_SOURCE.owner_label, "Paid Overflow");
  assert.equal(PAID_OVERFLOW_SOURCE.granularity_key, "paid_overflow");
  assert.equal(PAID_OVERFLOW_SOURCE.granularity_owner_label, "Paid Overflow");
  assert.equal(PAID_OVERFLOW_SOURCE.granularity_crm_label, "Paid Overflow");
  assert.equal(PAID_OVERFLOW_SOURCE.channel, "form");
  assert.equal(PAID_OVERFLOW_SOURCE.granot_label, "Paid Overflow");
  assert.equal(PAID_OVERFLOW_SOURCE.lead_created_policy, "create_if_missing");
  assert.equal(PAID_OVERFLOW_SOURCE.lifecycle_disposition, "source_scoped_lead");
  assert.equal(PAID_OVERFLOW_SOURCE.lifecycle_enabled, true);
  assert.equal(PAID_OVERFLOW_SOURCE.lead_model, "FormLead");
  assert.equal(PAID_OVERFLOW_SOURCE.move_type, "any");
  assert.equal(PAID_OVERFLOW_SOURCE.sms_consent_basis, "customer_submitted_form");
  assert.equal(
    PAID_OVERFLOW_SOURCE.lifecycle_policy_version,
    GRANOT_LIFECYCLE_SOURCE_POLICY_VERSION,
  );
  assert.equal(PAID_OVERFLOW_SOURCE.granularity_key, REVIEWED_GRANULARITY_KEYS.paid_overflow);
});

test("Paid Overflow family classifies one FormLead/any route with create_if_missing", () => {
  const plan = planGranotLifecycleSourceRegistry({
    crm_sources: [
      {
        id: "aaaaaaaaaaaaaaaaaaaaaaa6",
        granot_label: "Paid Overflow",
        normalized_granot_label: "paid overflow",
        enabled: true,
        lifecycle_enabled: false,
        lifecycle_disposition: "deferred",
        lead_created_policy: "observation_only",
        lifecycle_routes: [],
        lifecycle_policy_version: "",
        crm_origin: "https://eagle.example.test",
        workspace_slug: "paid-overflow",
        default_channel: "unknown",
        source_company: "not_provided",
      },
    ],
    automation_sources: [],
    companies: [
      {
        id: "cccccccccccccccccccccc05",
        company_slug: "paid_overflow",
        owner_label: "Paid Overflow",
        active: true,
      },
    ],
    granularities: [
      {
        id: "121212121212121212121212",
        granularity_key: "paid_overflow",
        owner_label: "Paid Overflow",
        source_company_id: "cccccccccccccccccccccc05",
        channel: "form",
        active: true,
      },
    ],
  });
  const overflow = plan.crm_mutations.find((mutation) => mutation.family === "paid_overflow");
  assert.equal(overflow?.refused, false);
  assert.equal(overflow?.action, "classify");
  assert.equal(overflow?.intended.lead_created_policy, "create_if_missing");
  assert.equal(overflow?.intended.lifecycle_enabled, true);
  assert.equal(overflow?.intended.lifecycle_disposition, "source_scoped_lead");
  assert.equal(overflow?.intended.default_channel, "form");
  assert.deepEqual(overflow?.intended.lifecycle_routes, [
    {
      route_key: "form_any",
      lead_model: "FormLead",
      move_type: "any",
      source_granularity_id: "121212121212121212121212",
    },
  ]);
});
