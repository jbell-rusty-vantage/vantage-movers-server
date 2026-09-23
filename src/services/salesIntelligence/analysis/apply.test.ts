import assert from "node:assert/strict";
import { test } from "node:test";
import { newlyAnalyzed } from "./apply";

// S1-ROLLUP (data spec §8): the analysed-conversation rollup moves only on the first completed run.
test("newlyAnalyzed: only the null -> run transition on an unpurged conversation with a Number counts", () => {
  const number = "a".repeat(24);
  assert.equal(newlyAnalyzed({ latest_completed_run_id: null, content_purged_at: null, contact_number_id: number }), true);
  assert.equal(newlyAnalyzed({ latest_completed_run_id: "b".repeat(24), content_purged_at: null, contact_number_id: number }), false, "re-analysis");
  assert.equal(newlyAnalyzed({ latest_completed_run_id: null, content_purged_at: new Date(0), contact_number_id: number }), false, "purged");
  assert.equal(newlyAnalyzed({ latest_completed_run_id: null, content_purged_at: null, contact_number_id: null }), false, "no Number (D4)");
});
