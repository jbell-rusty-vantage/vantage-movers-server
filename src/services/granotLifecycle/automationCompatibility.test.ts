import assert from "node:assert/strict";
import { test } from "node:test";
import {
  automationOperationPermittedByRoutes,
  evaluateGranotAutomationCompatibility,
} from "./automationCompatibility";

const formSource = {
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  enabled: true,
  lifecycle_enabled: true,
  lifecycle_disposition: "source_scoped_lead" as const,
  lifecycle_routes: [{ lead_model: "FormLead" as const }],
  normalized_granot_label: "best relocation forms",
};

test("[AC-38] missing automation reference is visible and unavailable for apply", () => {
  const compatibility = evaluateGranotAutomationCompatibility({
    requested_operations: ["form_leads"],
  });
  assert.equal(compatibility.available_for_apply, false);
  assert.equal(compatibility.status, "missing_reference");
  assert.equal(
    compatibility.issues[0]?.code,
    "granot_crm_source_reference_missing",
  );
});

test("[AC-38] invalid referenced Registry row is missing_reference, not a label fallback", () => {
  const compatibility = evaluateGranotAutomationCompatibility({
    granot_crm_source_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    requested_operations: ["form_leads"],
    referenced: null,
  });
  assert.equal(compatibility.status, "missing_reference");
  assert.equal(compatibility.granot_crm_source_id, "bbbbbbbbbbbbbbbbbbbbbbbb");
});

test("[AC-38] multiple normalized Registry matches make the automation source ambiguous", () => {
  const compatibility = evaluateGranotAutomationCompatibility({
    granot_crm_source_id: formSource.id,
    requested_operations: ["form_leads"],
    referenced: formSource,
    normalized_label_match_count: 2,
  });
  assert.equal(compatibility.available_for_apply, false);
  assert.equal(compatibility.status, "source_ambiguous");
  assert.equal(compatibility.issues[0]?.code, "granot_crm_source_ambiguous");
});

test("[AC-38] disabled, lifecycle-disabled, or deferred Registry rows cannot be applied", () => {
  for (const referenced of [
    { ...formSource, enabled: false },
    { ...formSource, lifecycle_enabled: false },
    { ...formSource, lifecycle_disposition: "deferred" as const },
  ]) {
    const compatibility = evaluateGranotAutomationCompatibility({
      granot_crm_source_id: formSource.id,
      requested_operations: ["form_leads"],
      referenced,
    });
    assert.equal(compatibility.status, "source_disabled");
    assert.equal(compatibility.available_for_apply, false);
  }
});

test("[AC-38] Call routes cannot satisfy a form_leads apply selection", () => {
  const compatibility = evaluateGranotAutomationCompatibility({
    granot_crm_source_id: formSource.id,
    requested_operations: ["form_leads"],
    referenced: {
      ...formSource,
      lifecycle_routes: [{ lead_model: "CallLead" }],
    },
  });
  assert.equal(compatibility.status, "operation_not_permitted");
  assert.equal(
    compatibility.issues[0]?.code,
    "granot_crm_source_operation_not_permitted",
  );
  assert.equal(
    automationOperationPermittedByRoutes([{ lead_model: "CallLead" }], "form_leads"),
    false,
  );
});

test("[AC-09] ready Form policy permits form_leads and never uses supported_operations as authority", () => {
  const compatibility = evaluateGranotAutomationCompatibility({
    granot_crm_source_id: formSource.id,
    requested_operations: ["form_leads"],
    referenced: formSource,
    normalized_label_match_count: 1,
  });
  assert.deepEqual(compatibility, {
    granot_crm_source_id: formSource.id,
    available_for_apply: true,
    status: "ready",
    issues: [],
  });
});
