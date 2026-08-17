import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRANOT_AUTOMATION_SOURCE_INDEXES,
  GranotAutomationSource,
} from "./GranotAutomationSource";

test("[AC-38] GranotAutomationSource declares an optional CRM reference and non-unique lookup index", () => {
  const referencePath = GranotAutomationSource.schema.path("granot_crm_source");
  assert.ok(referencePath);
  assert.notEqual(referencePath?.isRequired, true);
  assert.ok(
    GRANOT_AUTOMATION_SOURCE_INDEXES.some(
      (index) =>
        index.name === "granot_automation_source_crm_source_active" &&
        index.key.granot_crm_source === 1 &&
        index.key.active === 1 &&
        !("unique" in index),
    ),
  );
  assert.ok(
    GranotAutomationSource.schema
      .indexes()
      .some(
        (entry: [Record<string, number>, { name?: string }]) =>
          entry[1].name === "granot_automation_source_crm_source_active",
      ),
  );
});
