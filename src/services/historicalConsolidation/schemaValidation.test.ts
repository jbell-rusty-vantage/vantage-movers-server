import assert from "node:assert/strict";
import test from "node:test";
import { validateManifestOperations } from "./schemaValidation";
import type { HistoricalOperation } from "./types";

function update(set: Record<string, unknown>): HistoricalOperation {
  return {
    operation_id: "operation-id",
    migration_key: "booking:fixture",
    order: 40,
    action: "update",
    model: "BookedLead",
    collection: "booked_leads",
    target_id: "507f1f77bcf86cd799439011",
    provenance: [],
    set,
    before: {},
    after: {},
    precondition: {},
  };
}

test("update validation accepts a production nested object path", () => {
  assert.doesNotThrow(() =>
    validateManifestOperations([
      update({ auto_match: { enabled_rules_snapshot: [] } }),
    ]),
  );
});

test("update validation rejects an unknown nested object path", () => {
  assert.throws(
    () => validateManifestOperations([update({ unknown_nested: { value: true } })]),
    /unknown production field unknown_nested/,
  );
});
