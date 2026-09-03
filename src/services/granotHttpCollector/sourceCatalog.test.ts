import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeGranotSourceIds,
  compatibilityOperationsForSource,
  GranotAutomationSourceValidationError,
  partitionGranotAutomationSources,
  type GranotAutomationSourceItem,
} from "./sourceCatalog";
import { evaluateGranotAutomationCompatibility } from "../granotLifecycle/automationCompatibility";

const formId = "507F1F77BCF86CD799439011";
const callId = "507f1f77bcf86cd799439012";
const bothId = "507f1f77bcf86cd799439013";

const sources: GranotAutomationSourceItem[] = [
  {
    id: formId.toLowerCase(),
    label: "Form Source",
    active: true,
    supported_operations: ["form_leads"],
    created_from: "seed",
  },
  {
    id: callId,
    label: "Call Source",
    active: true,
    supported_operations: ["call_leads"],
    created_from: "seed",
  },
  {
    id: bothId,
    label: "Shared Source",
    active: true,
    supported_operations: ["form_leads", "call_leads"],
    created_from: "admin",
  },
];

test("source IDs canonicalize case before lookup and duplicate validation", () => {
  assert.deepEqual(canonicalizeGranotSourceIds([formId]), [
    formId.toLowerCase(),
  ]);
  assert.throws(
    () => canonicalizeGranotSourceIds([formId, formId.toLowerCase()]),
    (error: unknown) =>
      error instanceof GranotAutomationSourceValidationError &&
      error.issues[0]?.message === "Duplicate source IDs are not allowed",
  );
  assert.throws(
    () => canonicalizeGranotSourceIds(["not-an-object-id"]),
    GranotAutomationSourceValidationError,
  );
});

test("source partitioning keeps only compatible IDs in each child snapshot", () => {
  const partitions = partitionGranotAutomationSources(sources, [
    "form_leads",
    "call_leads",
  ]);
  assert.deepEqual(
    partitions.get("form_leads")?.map((source) => source.id),
    [formId.toLowerCase(), bothId],
  );
  assert.deepEqual(
    partitions.get("call_leads")?.map((source) => source.id),
    [callId, bothId],
  );
});

test("[AC-38] unavailable resolve issues keep INVALID_GRANOT_SOURCES and per-source codes", () => {
  const error = new GranotAutomationSourceValidationError(
    "Selected Granot sources are unavailable.",
    [
      {
        path: ["source_ids"],
        message: "This automation source has no Granot CRM source reference.",
        code: "granot_crm_source_reference_missing",
        source_id: formId.toLowerCase(),
      },
    ],
  );
  assert.equal(error.code, "INVALID_GRANOT_SOURCES");
  assert.equal(error.issues[0]?.source_id, formId.toLowerCase());
  assert.equal(error.issues[0]?.code, "granot_crm_source_reference_missing");
});

test("run-group resolve asks each source only for operations its Registry routes permit", () => {
  assert.deepEqual(
    compatibilityOperationsForSource({
      requested_operations: ["form_leads", "call_leads"],
      lifecycle_routes: [{ lead_model: "FormLead" }],
    }),
    ["form_leads"],
  );
  assert.deepEqual(
    compatibilityOperationsForSource({
      requested_operations: ["form_leads", "call_leads"],
      lifecycle_routes: [{ lead_model: "CallLead" }],
    }),
    ["call_leads"],
  );
  const formOnlyReady = evaluateGranotAutomationCompatibility({
    granot_crm_source_id: formId.toLowerCase(),
    requested_operations: compatibilityOperationsForSource({
      requested_operations: ["form_leads", "call_leads"],
      lifecycle_routes: [{ lead_model: "FormLead" }],
    }),
    referenced: {
      id: formId.toLowerCase(),
      enabled: true,
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lifecycle_routes: [{ lead_model: "FormLead" }],
      normalized_granot_label: "form source",
    },
  });
  assert.equal(formOnlyReady.available_for_apply, true);
  assert.equal(formOnlyReady.status, "ready");
});

test("a source with no matching Registry route still fails the asked operation", () => {
  assert.deepEqual(
    compatibilityOperationsForSource({
      requested_operations: ["form_leads"],
      lifecycle_routes: [{ lead_model: "CallLead" }],
    }),
    ["form_leads"],
  );
  const compatibility = evaluateGranotAutomationCompatibility({
    granot_crm_source_id: callId,
    requested_operations: compatibilityOperationsForSource({
      requested_operations: ["form_leads"],
      lifecycle_routes: [{ lead_model: "CallLead" }],
    }),
    referenced: {
      id: callId,
      enabled: true,
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lifecycle_routes: [{ lead_model: "CallLead" }],
      normalized_granot_label: "call source",
    },
  });
  assert.equal(compatibility.available_for_apply, false);
  assert.equal(compatibility.status, "operation_not_permitted");
});

test("[AC-38] resolve never treats label or supported_operations as semantic authority", () => {
  const compatibility = evaluateGranotAutomationCompatibility({
    requested_operations: ["form_leads"],
  });
  assert.equal(compatibility.available_for_apply, false);
  assert.equal(compatibility.status, "missing_reference");
  const readyByLegacyLabel = sources[0];
  assert.equal(readyByLegacyLabel?.supported_operations.includes("form_leads"), true);
  assert.notEqual(compatibility.status, "ready");
});

test("source partitioning rejects an empty selected workflow", () => {
  assert.throws(
    () => partitionGranotAutomationSources([sources[0]!], ["call_leads"]),
    (error: unknown) =>
      error instanceof GranotAutomationSourceValidationError &&
      error.issues[0]?.message.includes("call_leads") === true,
  );
});
