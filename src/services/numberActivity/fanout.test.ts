import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { CsiError } from "../salesIntelligence/auth";
import type { ApplyResult } from "./persistInteraction";
import type { SessionObservationResult } from "./observeWebhookEvents";
import {
  runCaptureProjectionJob,
  type CaptureProjectionWorkerDeps,
} from "./captureProjectionWorker";
import { csiWakeupSchema, parseCsiWakeup } from "./jobDispatch";
import { inboundQueueAnsweredDeliveries, at } from "./fixtures";
import {
  captureProjectionDedupeKey,
  captureProjectionSubjectKey,
  fanOutCaptureProjection,
  publishCaptureProjectionWakeup,
  salesIntelligenceQueueTopic,
  type EnsureCaptureProjectionJobResult,
} from "./webhookFanout";

const oid = () => new mongoose.Types.ObjectId().toHexString();

test("capture-projection dedupe key is the provider uuid, falling back to the receipt id only when the uuid is absent", () => {
  const receiptId = oid();
  assert.equal(captureProjectionDedupeKey({ receiptId, uuid: "u-1" }), "csi:capture_projection:receipt:u-1");
  assert.equal(captureProjectionDedupeKey({ receiptId, uuid: null }), `csi:capture_projection:receipt_id:${receiptId}`);
  assert.equal(captureProjectionSubjectKey({ receiptId, uuid: "u-1" }), "webhook_receipt:u-1");
  assert.equal(captureProjectionSubjectKey({ receiptId, uuid: null }), `webhook_receipt:${receiptId}`);
});

test("queue topic is env-scoped and never published from a test runner", () => {
  const saved = { ...process.env };
  try {
    delete process.env.SALES_INTELLIGENCE_QUEUE_TOPIC;
    process.env.VERCEL_ENV = "preview";
    assert.equal(salesIntelligenceQueueTopic(), "sales-intelligence-events-dev");
    process.env.VERCEL_ENV = "production";
    assert.equal(salesIntelligenceQueueTopic(), "sales-intelligence-events");
    process.env.SALES_INTELLIGENCE_QUEUE_TOPIC = "explicit-topic";
    assert.equal(salesIntelligenceQueueTopic(), "explicit-topic");
  } finally {
    process.env = saved;
  }
});

test("fan-out: flag off means no job and no publish; a non-durable receipt is skipped honestly", async () => {
  let ensured = 0;
  const deps = {
    ensure: async () => {
      ensured += 1;
      return { job_id: oid(), dedupe_key: "k", created: true };
    },
    publish: async () => ({ published: true, error_code: null }),
  };
  assert.deepEqual(
    await fanOutCaptureProjection({ receiptId: oid(), uuid: "u", telephonySessionId: "s" }, { ...deps, flag: () => false }),
    { status: "skipped", reason: "flag_off" },
  );
  assert.deepEqual(
    await fanOutCaptureProjection({ receiptId: null, uuid: "u", telephonySessionId: "s" }, { ...deps, flag: () => true }),
    { status: "skipped", reason: "receipt_not_durable" },
  );
  assert.deepEqual(
    await fanOutCaptureProjection({ receiptId: oid(), uuid: "u", telephonySessionId: null }, { ...deps, flag: () => true }),
    { status: "skipped", reason: "no_telephony_session" },
    "validation handshakes and non-telephony bodies carry no party evidence",
  );
  assert.equal(ensured, 0);
});

test("fan-out: the acknowledgement waits a bounded time for the job transaction; a slow transaction is reported, not awaited forever", async () => {
  const events: string[] = [];
  let resolveSlow: (() => void) | null = null;
  const slow = new Promise<EnsureCaptureProjectionJobResult>((resolve) => {
    resolveSlow = () => resolve({ job_id: oid(), dedupe_key: "k", created: true });
  });
  const outcome = await fanOutCaptureProjection(
    { receiptId: oid(), uuid: "u", telephonySessionId: "s" },
    {
      flag: () => true,
      ensure: () => slow,
      publish: async () => assert.fail("no publish after a timeout"),
      ackTimeoutMs: 20,
      recordEvent: (async (input: { eventKey: string }) => {
        events.push(input.eventKey);
      }) as never,
    },
  );
  assert.deepEqual(outcome, { status: "enqueue_timeout", error_code: "enqueue_timeout", timeout_ms: 20 });
  assert.deepEqual(events, ["sales_intelligence.capture.fanout.enqueue_timeout"]);
  resolveSlow!();
});

test("fan-out: job is durable before publish; publish failure keeps the enqueued job; enqueue failure is bounded", async () => {
  const jobId = oid();
  const order: string[] = [];
  const events: string[] = [];
  const ensure = async (): Promise<EnsureCaptureProjectionJobResult> => {
    order.push("ensure");
    return { job_id: jobId, dedupe_key: "csi:capture_projection:receipt:u", created: true };
  };
  const recordEvent = (async (input: { eventKey: string }) => {
    events.push(input.eventKey);
  }) as never;

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
      recordEvent,
    },
  );
  assert.deepEqual(failed, { status: "enqueue_failed", error_code: "enqueue_failed" });
  assert.deepEqual(events, ["sales_intelligence.capture.fanout.enqueue_failed"]);
});

test("publish wake-up: gated, best-effort, never throws", async () => {
  assert.deepEqual(
    await publishCaptureProjectionWakeup(oid(), { shouldPublish: () => false, send: async () => assert.fail("must not send") }),
    { published: false, error_code: null },
  );
  const sent: Array<[string, { job_id: string }]> = [];
  const jobId = oid();
  assert.deepEqual(
    await publishCaptureProjectionWakeup(jobId, {
      shouldPublish: () => true,
      send: async (topic, payload) => {
        sent.push([topic, payload]);
      },
    }),
    { published: true, error_code: null },
  );
  assert.deepEqual(sent[0]?.[1], { job_id: jobId });
  const events: string[] = [];
  assert.deepEqual(
    await publishCaptureProjectionWakeup(jobId, {
      shouldPublish: () => true,
      send: async () => {
        throw new Error("queue down");
      },
      recordEvent: (async (input: { eventKey: string }) => {
        events.push(input.eventKey);
      }) as never,
    }),
    { published: false, error_code: "publish_failed" },
  );
  assert.deepEqual(events, ["sales_intelligence.queue.publish_failed"]);
});

test("wake-up payload is exactly { job_id } with a 24-hex id", () => {
  const id = oid();
  assert.equal(parseCsiWakeup({ job_id: id }), id);
  assert.equal(parseCsiWakeup({ job_id: id, stage: "capture_projection" }), null, "stage in the payload is untrusted and rejected");
  assert.equal(parseCsiWakeup({ job_id: "not-hex" }), null);
  assert.equal(parseCsiWakeup(null), null);
  assert.equal(csiWakeupSchema.safeParse({ job_id: id }).success, true);
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
  const calls: { claim: unknown[]; complete: unknown[]; fail: unknown[]; observeRequestIds: Array<string | null | undefined>; events: string[] } = {
    claim: [],
    complete: [],
    fail: [],
    observeRequestIds: [],
    events: [],
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
    recordEvent: (async (event: { eventKey: string }) => {
      calls.events.push(event.eventKey);
    }) as never,
  };
  return { deps, calls };
}

test("worker: unclaimable job (completed, leased elsewhere, foreign stage) does nothing", async () => {
  const { deps, calls } = workerHarness({ job: null });
  const id = oid();
  assert.deepEqual(await runCaptureProjectionJob(id, deps), { status: "not_claimable", job_id: id });
  assert.deepEqual(calls.claim, [["worker-a", id, 300_000, "capture_projection"]], "claims only the capture_projection stage");
  assert.equal(calls.complete.length, 0);
  assert.deepEqual(await runCaptureProjectionJob("nope", deps), { status: "not_claimable", job_id: "nope" });
});

test("worker: loads the stored receipt, passes the job id as request_id, completes with a bounded per-session result", async () => {
  const job: FakeJob = { _id: new mongoose.Types.ObjectId(), lease_epoch: 3, input_refs: [new mongoose.Types.ObjectId()], stage: "capture_projection" };
  const { deps, calls } = workerHarness({ job });
  const outcome = await runCaptureProjectionJob(String(job._id), deps);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(calls.observeRequestIds, [String(job._id)]);
  const [lease, options] = calls.complete[0] as [{ job_id: string; owner: string; epoch: number }, { result: { sessions: number; ok: number; failed: number; receipt_uuid: string | null } }];
  assert.deepEqual(lease, { job_id: String(job._id), owner: "worker-a", epoch: 3 });
  assert.equal(options.result.sessions, 1);
  assert.equal(options.result.ok, 1);
  assert.equal(options.result.failed, 0);
  assert.equal(options.result.receipt_uuid, "s-w-u1");
  assert.equal(calls.fail.length, 0);
});

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
  assert.deepEqual(deterministic.calls.events, ["sales_intelligence.capture.projection.sessions_failed"]);
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
