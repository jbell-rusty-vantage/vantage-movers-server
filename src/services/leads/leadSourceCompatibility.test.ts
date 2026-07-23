import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLeadSourceCompatibility } from "./leadSourceCompatibility";

const expected = {
  source_company: "top10",
  lead_source_company: "64c0f47e4d8b0e1111111111",
  source_granularity_key: "top10-forms",
};

test("classifies a different legacy source company as conflict", () => {
  assert.equal(
    classifyLeadSourceCompatibility(
      {
        source_company: "another-company",
      },
      expected,
    ),
    "conflict",
  );
});

test("classifies a genuinely unassigned Lead as unassigned", () => {
  assert.equal(classifyLeadSourceCompatibility({}, expected), "unassigned");
  assert.equal(
    classifyLeadSourceCompatibility(
      { source_company: "not_provided" },
      expected,
    ),
    "unassigned",
  );
});
