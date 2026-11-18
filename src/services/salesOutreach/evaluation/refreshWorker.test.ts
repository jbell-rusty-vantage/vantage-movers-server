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

test("refresh preflight consumes the same deadline before the first claim", async () => {
  let now = 0, attempts = 0;
  const result = await drainSubjectRefreshes(3, 100, {
    clock: () => now, preflight: async () => { now = 100; return null; },
    next: async () => { attempts++; return { status: "completed" }; },
  });
  assert.equal(attempts, 0); assert.deepEqual(result.durations_ms, []);
});

test("refresh drain bounds successful work by count and stops after the time budget", async () => {
  for (const [max, budget, expected] of [[2, 100, 2], [10, 9, 3]]) {
    let now = 0, attempts = 0;
    const result = await drainSubjectRefreshes(max, budget, {
      clock: () => now, preflight: async () => null,
      next: async () => { attempts++; now += 3; return { status: "completed" }; },
    });
    assert.equal(attempts, expected); assert.equal(result.durations_ms.length, expected);
  }
});

test("refresh empty queue and disabled preflight consume no work slots", async () => {
  const empty = await drainSubjectRefreshes(1, 100, { preflight: async () => null, next: async () => null });
  assert.deepEqual(empty.durations_ms, []);
  const disabled = await drainSubjectRefreshes(1, 100, { preflight: async () => "disabled", next: async () => { throw new Error("must not claim"); } });
  assert.equal(disabled.skipped, "disabled"); assert.deepEqual(disabled.durations_ms, []);
});
