import assert from "node:assert/strict";
import test from "node:test";
import {
  DomainCommandExecution,
  readStoredCanonicalCommandResult,
} from "./DomainCommandExecution";

test("[AC-21] command execution model keeps unique origin/idempotency and command_id indexes", () => {
  const indexes = DomainCommandExecution.schema.indexes();
  const originKey = indexes.find((entry: unknown) => {
    const [fields, options] = entry as [
      Record<string, unknown>,
      { unique?: boolean; name?: string },
    ];
    return (
      fields.origin === 1 &&
      fields.idempotency_key === 1 &&
      options.unique === true
    );
  });
  assert.ok(originKey);
  const commandId = indexes.find((entry: unknown) => {
    const [fields, options] = entry as [Record<string, unknown>, { unique?: boolean; name?: string }];
    return fields.command_id === 1 && options.unique === true && options.name === "domain_command_command_id_unique";
  });
  assert.ok(commandId);
});

test("[AC-32] origin enum accepts the four command origins and nested applied result", () => {
  const origin = DomainCommandExecution.schema.path("origin");
  assert.deepEqual(origin?.options.enum, [
    "external_sheet_ingestion",
    "vantage_admin",
    "granot_lifecycle",
    "ringcentral",
  ]);
  const resultStatus = DomainCommandExecution.schema.path("result.status");
  assert.deepEqual(resultStatus?.options.enum, ["applied"]);
});

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
