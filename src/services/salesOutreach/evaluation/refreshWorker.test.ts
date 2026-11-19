import assert from "node:assert/strict";
import { test } from "node:test";
import { drainSubjectRefreshes } from "./refreshWorker";

test("refresh drain preserves completed work and reserves an uncertain failed claim or retry slot", async () => {
  let now = 0, attempts = 0;
  const result = await drainSubjectRefreshes(3, 100, {
    clock: () => now, preflight: async () => null,
    next: async () => { attempts++; now += 5; if (attempts === 2) throw new Error("database response lost"); return { status: "completed" }; },
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result, { skipped: "failed", outcomes: { completed: 1, failed: 1 }, durations_ms: [5, 5] });
  assert.equal(3 - result.durations_ms.length, 1, "only one shared legacy slot remains");
});
