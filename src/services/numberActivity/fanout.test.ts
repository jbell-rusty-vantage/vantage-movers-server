import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { CsiError } from "../salesIntelligence/auth";
import type { ApplyResult } from "./persistInteraction";
import type { SessionObservationResult } from "./observeWebhookEvents";
import { runCaptureProjectionJob, type CaptureProjectionWorkerDeps } from "./captureProjectionWorker";
import { inboundQueueAnsweredDeliveries, at } from "./fixtures";
import { fanOutCaptureProjection, type EnsureCaptureProjectionJobResult } from "./webhookFanout";

const oid = () => new mongoose.Types.ObjectId().toHexString();

test("fan-out: job is durable before publish; publish failure keeps the enqueued job; enqueue failure is bounded", async () => {
  const jobId = oid();
  const order: string[] = [];
  const ensure = async (): Promise<EnsureCaptureProjectionJobResult> => {
    order.push("ensure");
    return { job_id: jobId, dedupe_key: "csi:capture_projection:receipt:u", created: true };
  };
  const published = await fanOutCaptureProjection(
    { receiptId: oid(), uuid: "u", telephonySessionId: "s" },
    {
      flag: () => true,
      ensure,
      publish: async (id) => {
        order.push(`publish:${id}`);
        return { published: false, error_code: "publish_failed" };
      },
    },
  );
  assert.deepEqual(order, ["ensure", `publish:${jobId}`]);
  assert.deepEqual(published, { status: "enqueued", job_id: jobId, dedupe_key: "csi:capture_projection:receipt:u", published: false });

  const existing = await fanOutCaptureProjection(
    { receiptId: oid(), uuid: "u", telephonySessionId: "s" },
    {
      flag: () => true,
      ensure: async () => ({ job_id: jobId, dedupe_key: "k", created: false }),
      publish: async () => ({ published: true, error_code: null }),
    },
  );
  assert.equal(existing.status, "existing");

  const failed = await fanOutCaptureProjection(
    { receiptId: oid(), uuid: "u", telephonySessionId: "s" },
    {
      flag: () => true,
      ensure: async () => {
        throw new Error("synthetic transaction failure: provider body must not leak");
      },
      publish: async () => {
        throw new Error("publish must not run after a failed enqueue");
      },
    },
  );
  assert.deepEqual(failed, { status: "enqueue_failed", error_code: "enqueue_failed" });
});

// ---------------------------------------------------------------------------
// Worker with fakes (database-backed proofs live in scripts/test-csi-fanout.replica.test.ts)
// ---------------------------------------------------------------------------

type FakeJob = { _id: mongoose.Types.ObjectId; lease_epoch: number; input_refs: mongoose.Types.ObjectId[]; stage: string };

function applyResult(overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    interaction_id: oid(),
    contact_number_id: oid(),
    projection_revision: 1,
    noop: false,
    created: true,
    newly_terminal: false,
    newly_settled: false,
    call_log_state: null,
    new_recording_ids: [],
    fenced_party_events: 0,
    stale_call_log: false,
    merged_interaction_ids: [],
    jobs: ["csi:outreach_ensure:interaction:x:1"],
    contact_number_created: true,
    ...overrides,
  };
}

function workerHarness(input: {
  job: FakeJob | null;
  receipt?: { rawBody: unknown; receivedAt: Date; uuid: string | null } | null;
  observe?: (observations: unknown[], deps: { request_id?: string | null }) => Promise<SessionObservationResult[]>;
  completeThrows?: CsiError;
}) {
  const calls: { claim: unknown[]; complete: unknown[]; fail: unknown[]; observeRequestIds: Array<string | null | undefined> } = {
    claim: [],
    complete: [],
    fail: [],
    observeRequestIds: [],
  };
  const receiptId = input.job?.input_refs[0] ? String(input.job.input_refs[0]) : oid();
  const deps: CaptureProjectionWorkerDeps = {
    owner: "worker-a",
    now: () => at(100),
    claim: (async (owner: string, jobId?: string, ttl?: number, stage?: string) => {
      calls.claim.push([owner, jobId, ttl, stage]);
      return input.job;
    }) as never,
    complete: (async (lease: unknown, _mutation: unknown, options: unknown) => {
      calls.complete.push([lease, options]);
      if (input.completeThrows) throw input.completeThrows;
      return undefined;
    }) as never,
    fail: (async (lease: unknown, reason: string, retryAfter: number, options: unknown) => {
      calls.fail.push([lease, reason, retryAfter, options]);
    }) as never,
    loadReceipt: async (id: string) => {
      assert.equal(id, receiptId, "receipt is loaded by the job's input_refs, never a queue payload");
      if (input.receipt === null) return null;
      const receipt = input.receipt ?? { rawBody: inboundQueueAnsweredDeliveries("s-w").ringing, receivedAt: at(1), uuid: "s-w-u1" };
      return { _id: new mongoose.Types.ObjectId(receiptId), provider: "ringcentral" as const, receivedAt: receipt.receivedAt, uuid: receipt.uuid, rawBody: receipt.rawBody };
    },
    observe: (async (observations: unknown[], deps: { request_id?: string | null }) => {
      calls.observeRequestIds.push(deps.request_id);
      if (input.observe) return input.observe(observations, deps);
      return [{ telephony_session_id: "s-w", account_id: "800000000001", ok: true, result: applyResult() }];
    }) as never,
  };
  return { deps, calls };
}

test("worker: deterministic per-session failures (account_unresolved) complete the job with the error visible; retryable ones retry with partial result", async () => {
  const job: FakeJob = { _id: new mongoose.Types.ObjectId(), lease_epoch: 1, input_refs: [new mongoose.Types.ObjectId()], stage: "capture_projection" };
  const deterministic = workerHarness({
    job,
    observe: async () => [
      { telephony_session_id: "s-1", account_id: null, ok: false, error_code: "account_unresolved" },
      { telephony_session_id: "s-2", account_id: "800000000001", ok: true, result: applyResult({ noop: true, created: false }) },
    ],
  });
  const done = await runCaptureProjectionJob(String(job._id), deterministic.deps);
  assert.equal(done.status, "completed");
  assert.ok(done.status === "completed");
  assert.equal(done.result.failed, 1);
  assert.deepEqual(done.result.results[0], { telephony_session_id: "s-1", ok: false, error_code: "account_unresolved" });
  assert.equal(deterministic.calls.fail.length, 0);

  const retryable = workerHarness({
    job,
    observe: async () => [{ telephony_session_id: "s-1", account_id: "800000000001", ok: false, error_code: "persist_failed" }],
  });
  const retry = await runCaptureProjectionJob(String(job._id), retryable.deps);
  assert.equal(retry.status, "failed");
  assert.ok(retry.status === "failed");
  assert.equal(retry.reason, "transient");
  assert.equal(retry.error_code, "session_retryable");
  assert.equal(retryable.calls.complete.length, 0);
  const [, reason, , options] = retryable.calls.fail[0] as [unknown, string, number, { result: { failed: number } }];
  assert.equal(reason, "transient");
  assert.equal(options.result.failed, 1, "partial result stays visible on the retried row");
});

test("worker: missing receipt is schema_invalid (bounded retries), lease loss during completion is reported not retried", async () => {
  const job: FakeJob = { _id: new mongoose.Types.ObjectId(), lease_epoch: 1, input_refs: [new mongoose.Types.ObjectId()], stage: "capture_projection" };
  const missing = workerHarness({ job, receipt: null });
  const outcome = await runCaptureProjectionJob(String(job._id), missing.deps);
  assert.equal(outcome.status, "failed");
  assert.ok(outcome.status === "failed");
  assert.equal(outcome.reason, "schema_invalid");
  assert.equal(outcome.error_code, "receipt_missing");
  const [, missingReason, , missingOptions] = missing.calls.fail[0] as [unknown, string, number, { result: unknown }];
  assert.equal(missingReason, "schema_invalid");
  assert.deepEqual(missingOptions.result, { receipt_id: String(job.input_refs[0]), error_code: "receipt_missing" }, "the dead-lettered row names the missing receipt");

  const noRef = workerHarness({ job: { ...job, input_refs: [] } });
  const noRefOutcome = await runCaptureProjectionJob(String(job._id), noRef.deps);
  assert.ok(noRefOutcome.status === "failed" && noRefOutcome.error_code === "receipt_ref_missing");

  const lost = workerHarness({ job, completeThrows: new CsiError("LEASE_LOST") });
  assert.deepEqual(await runCaptureProjectionJob(String(job._id), lost.deps), { status: "lease_lost", job_id: String(job._id) });
  assert.equal(lost.calls.fail.length, 0, "an expired lease is not failed by the loser");
});
