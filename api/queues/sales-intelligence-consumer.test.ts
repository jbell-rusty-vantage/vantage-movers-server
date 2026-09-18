import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import mongoose from "mongoose";
import { parseCsiWakeup } from "../../src/services/numberActivity/jobDispatch";

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
