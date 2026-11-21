import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FORM_LEAD_CONTACT_EMAIL_INDEXES, getFormLeadModel } from "./FormLead";

test("the Form Lead contact-email indexes are declared and match the ops build tool", () => {
  const declared = getFormLeadModel().schema.indexes();
  for (const index of FORM_LEAD_CONTACT_EMAIL_INDEXES) {
    const found = declared.find(([, options]: [unknown, { name?: string; sparse?: boolean } | undefined]) => options?.name === index.name);
    assert.ok(found, index.name);
    assert.deepEqual(found[0], index.key);
    assert.equal(found[1]?.sparse, true);
  }
  // The production build tool is plain CommonJS; its TARGETS must carry the same definitions.
  const tool = readFileSync(path.join(__dirname, "../../ops/capacity/form-lead-email-indexes-2026-11-20.cjs"), "utf8");
  for (const index of FORM_LEAD_CONTACT_EMAIL_INDEXES) {
    const field = Object.keys(index.key)[0]!;
    assert.ok(tool.includes(`{ name: "${index.name}", key: { "${field}": 1 }, sparse: true }`), index.name);
  }
});
