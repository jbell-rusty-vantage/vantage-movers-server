import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeGranotSourceIds,
  GranotAutomationSourceValidationError,
  partitionGranotAutomationSources,
  type GranotAutomationSourceItem,
} from "./sourceCatalog";

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

test("source partitioning rejects an empty selected workflow", () => {
  assert.throws(
    () => partitionGranotAutomationSources([sources[0]!], ["call_leads"]),
    (error: unknown) =>
      error instanceof GranotAutomationSourceValidationError &&
      error.issues[0]?.message.includes("call_leads") === true,
  );
});
