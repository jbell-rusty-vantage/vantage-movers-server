import assert from "node:assert/strict";
import test from "node:test";
import {
  bestRelocationImportLeadFilter,
  requireBestRelocationImportSource,
} from "./bestRelocationImportGuard";

test("Best Relocation import capability requires the Best Relocation source", () => {
  assert.equal(
    requireBestRelocationImportSource("best_relocation_sheet", "best_relocation_leads"),
    true,
  );
  assert.throws(
    () => requireBestRelocationImportSource("best_relocation_sheet", "main_site"),
    /restricted to best_relocation_leads/,
  );
});

test("ordinary booking requests do not receive import capability", () => {
  assert.equal(requireBestRelocationImportSource(undefined, "main_site"), false);
});

test("Best Relocation call lookup is source-scoped before mutation", () => {
  assert.deepEqual(bestRelocationImportLeadFilter("best_relocation_sheet"), {
    source_company: "best_relocation_leads",
  });
  assert.deepEqual(bestRelocationImportLeadFilter(undefined), {});
});
