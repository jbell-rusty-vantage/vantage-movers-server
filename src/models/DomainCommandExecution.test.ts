import assert from "node:assert/strict";
import test from "node:test";
import { readStoredCanonicalCommandResult } from "./DomainCommandExecution";

test("[AC-21] legacy top-level refs/warnings derive the stored applied result without rewrite", () => {
  const derived = readStoredCanonicalCommandResult({
    entity_refs: [{ model: "CallLead", id: "lead-1" }],
    warnings: ["note"],
  });
  assert.deepEqual(derived, {
    status: "applied",
    entity_refs: [{ model: "CallLead", id: "lead-1" }],
    warnings: ["note"],
  });
  const nested = readStoredCanonicalCommandResult({
    result: {
      status: "applied",
      entity_refs: [{ model: "FormLead", id: "lead-2" }],
      warnings: [],
    },
    entity_refs: [{ model: "legacy", id: "ignored" }],
    warnings: ["ignored"],
  });
  assert.deepEqual(nested, {
    status: "applied",
    entity_refs: [{ model: "FormLead", id: "lead-2" }],
    warnings: [],
  });
});
