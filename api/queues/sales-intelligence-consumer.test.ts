import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import {
  CSI_JOB_STAGES,
  CSI_RETIRED_JOB_STAGES,
} from "../../src/config/domain/salesIntelligence";
import { dispatchCsiWakeup } from "../../src/services/numberActivity/jobDispatch";
import { claimCsiJob, enqueueCsiJob, type JobInput } from "../../src/services/salesIntelligence/jobs";
import { CsiError } from "../../src/services/salesIntelligence/auth";

test("a late wake-up for every retired stage is acknowledged and terminalized, never handled", async () => {
  for (const stage of CSI_RETIRED_JOB_STAGES) {
    const jobId = String(new mongoose.Types.ObjectId());
    const retiredIds: string[] = [];
    let handled = 0;
    const handler = async () => { handled++; return "ran"; };
    const outcome = await dispatchCsiWakeup({ job_id: jobId }, {
      loadJob: async () => ({ stage }),
      retire: async (options = {}) => { retiredIds.push(options.jobId ?? ""); return { retired: 1, stages: { [stage]: 1 } }; },
      // Even a handler registered under the retired name is never reached.
      handlers: Object.fromEntries([...CSI_JOB_STAGES, stage].map((name) => [name, handler])),
    });
    assert.deepEqual(outcome, { status: "retired", job_id: jobId, stage, retired: 1 }, stage);
    assert.deepEqual(retiredIds, [jobId], stage);
    assert.equal(handled, 0, stage);
  }
});

test("a retained stage is dispatched to its handler and never retired", async () => {
  const jobId = String(new mongoose.Types.ObjectId());
  let retireCalls = 0;
  const outcome = await dispatchCsiWakeup({ job_id: jobId }, {
    loadJob: async () => ({ stage: "lead_link" }),
    retire: async () => { retireCalls++; return { retired: 0, stages: {} }; },
    handlers: { lead_link: async (id) => `handled:${id}` },
  });
  assert.deepEqual(outcome, { status: "dispatched", job_id: jobId, stage: "lead_link", outcome: `handled:${jobId}` });
  assert.equal(retireCalls, 0);
});

test("enqueue and claim of a retired stage are refused before any database access", async () => {
  // No transaction and no Mongo: the stage fence is the first check, so nothing is read or written.
  const session = { inTransaction: () => { throw new Error("session must not be consulted"); } } as unknown as ClientSession;
  for (const stage of CSI_RETIRED_JOB_STAGES) {
    const input = { dedupe_key: `retired:${stage}`, stage, subject_key: "number:x", input_revision: 1 } as unknown as JobInput;
    await assert.rejects(enqueueCsiJob(input, session), (error: unknown) =>
      error instanceof CsiError && error.code === "INVALID_INPUT" && error.issues?.[0]?.code === "stage_retired", stage);
    await assert.rejects(claimCsiJob("worker", undefined, 60_000, stage as never), (error: unknown) =>
      error instanceof CsiError && error.code === "INVALID_INPUT", stage);
  }
});
