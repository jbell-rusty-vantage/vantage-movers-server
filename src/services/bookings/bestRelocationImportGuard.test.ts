import assert from "node:assert/strict";
import test from "node:test";
import {
  bestRelocationImportLeadFilter,
} from "./bestRelocationImportGuard";

test("Best Relocation call lookup is source-scoped before mutation", () => {
  assert.deepEqual(bestRelocationImportLeadFilter("best_relocation_sheet"), {
    source_company: "best_relocation_leads",
  });
  assert.deepEqual(bestRelocationImportLeadFilter(undefined), {});
});
