import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import {
  CSI_JOB_STAGES,
  CSI_RETIRED_JOB_STAGES,
} from "../../src/config/domain/salesIntelligence";
import {
  defaultStageHandlers,
  dispatchCsiWakeup,
  parseCsiWakeup,
} from "../../src/services/numberActivity/jobDispatch";
import { claimCsiJob, enqueueCsiJob, type JobInput } from "../../src/services/salesIntelligence/jobs";
import { CsiError } from "../../src/services/salesIntelligence/auth";

test("consumer accepts only { job_id }", () => {
  const jobId = String(new mongoose.Types.ObjectId());
  assert.equal(parseCsiWakeup({ job_id: jobId }), jobId);
  assert.equal(parseCsiWakeup({ job_id: jobId, stage: "capture_projection" }), null);
  assert.equal(parseCsiWakeup({ receipt_id: jobId }), null);
});

test("vercel.json registers queue/v2beta topic sales-intelligence-events*", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
  ) as {
    functions: Record<string, { experimentalTriggers?: Array<{ type: string; topic: string }> }>;
  };
  const triggers = manifest.functions["api/queues/sales-intelligence-consumer.ts"]?.experimentalTriggers;
  assert.ok(triggers);
  assert.equal(triggers[0]?.type, "queue/v2beta");
  assert.equal(triggers[0]?.topic, "sales-intelligence-events*");
});

test("only retained stages have a consumer", () => {
  assert.deepEqual(Object.keys(defaultStageHandlers()).sort(),
    ["attachment_refresh", "call_log_refresh", "capture_projection", "nudge_repair", "outreach_lead_change", "rebuild"]);
  for (const stage of CSI_RETIRED_JOB_STAGES) assert.equal((CSI_JOB_STAGES as readonly string[]).includes(stage), false, stage);
});

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

test("a wake-up for an already terminal retired row is still acknowledged without effect", async () => {
  const jobId = String(new mongoose.Types.ObjectId());
  const outcome = await dispatchCsiWakeup({ job_id: jobId }, {
    loadJob: async () => ({ stage: "analysis" }),
    retire: async () => ({ retired: 0, stages: {} }),
    handlers: {},
  });
  assert.deepEqual(outcome, { status: "retired", job_id: jobId, stage: "analysis", retired: 0 });
});

test("a retained stage is dispatched to its handler and never retired", async () => {
  const jobId = String(new mongoose.Types.ObjectId());
  let retireCalls = 0;
  const outcome = await dispatchCsiWakeup({ job_id: jobId }, {
    loadJob: async () => ({ stage: "attachment_refresh" }),
    retire: async () => { retireCalls++; return { retired: 0, stages: {} }; },
    handlers: { attachment_refresh: async (id) => `handled:${id}` },
  });
  assert.deepEqual(outcome, { status: "dispatched", job_id: jobId, stage: "attachment_refresh", outcome: `handled:${jobId}` });
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
