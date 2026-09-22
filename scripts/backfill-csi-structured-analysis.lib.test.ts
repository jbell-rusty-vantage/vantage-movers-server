import assert from "node:assert/strict";
import { test } from "node:test";
import { continueStructuredAnalysis, runBoundedBackfill } from "./backfill-csi-structured-analysis.lib";

test("manual backfill continues due checkpoint and first timeout using only normal worker claims", async () => {
  const outcomes = [{ status: "retry", reason: "step_checkpoint" }, { status: "retry", reason: "step_timeout" }, { status: "submitted" }];
  let index = 0;
  const result = await continueStructuredAnalysis(async () => outcomes[index++], async () => ({
    status: "retry", next_attempt_at: new Date(100), result: { reason: outcomes[index - 1].reason },
  }), () => 100);
  assert.equal(result.status, "submitted");
  assert.equal(index, 3);
});

test("bounded backfill stops new work on failure and awaits active items", async () => {
  const admitted: number[] = [], completed: number[] = [];
  let release!: () => void;
  const active = new Promise<void>(resolve => { release = resolve; });
  const run = runBoundedBackfill([1, 2, 3, 4], 2, async item => {
    admitted.push(item);
    if (item === 1) { await active; completed.push(item); return true; }
    completed.push(item); return false;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(admitted, [1, 2]);
  assert.deepEqual(completed, [2]);
  release();
  await run;
  assert.deepEqual(completed, [2, 1]);
  assert.deepEqual(admitted, [1, 2]);
  await assert.rejects(() => runBoundedBackfill([], 5, async () => true), /1\.\.4/);
});

test("manual backfill stops at genuine failures, deferred retries and the worker timeout pause", async () => {
  for (const sample of [
    { status: "retry", reason: "analysis_failed", jobStatus: "retry", due: 100 },
    { status: "paused", reason: "step_timeout", jobStatus: "paused", due: 100 },
    { status: "retry", reason: "step_timeout", jobStatus: "retry", due: 101 },
    { status: "retry", reason: "step_checkpoint", jobStatus: "leased", due: 100 },
  ]) {
    let calls = 0;
    const result = await continueStructuredAnalysis(async () => {
      calls++; return { status: sample.status, reason: sample.reason };
    }, async () => ({ status: sample.jobStatus, next_attempt_at: new Date(sample.due), result: { reason: sample.reason } }), () => 100);
    assert.equal(calls, 1);
    assert.equal(result.reason, sample.reason);
  }
});
