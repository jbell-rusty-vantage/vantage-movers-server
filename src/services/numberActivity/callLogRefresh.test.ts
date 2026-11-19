import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { RingCentralApiError } from "../ringcentral/client";
import {
  CALL_LOG_REFRESH_ISYNC_RETRY_DELAYS_MS,
  CALL_LOG_REFRESH_RETRY_DELAYS_MS,
  drainCallLogRefreshJobs,
  callLogRefreshSubjectKey,
  callLogRefreshDedupeKey,
  runCallLogRefreshJob,
  type CallLogRefreshDeps,
} from "./callLogRefresh";
import { syntheticDirectory } from "./fixtures";
import { type ApplyResult } from "./persistInteraction";

const NOW = new Date("2026-09-23T15:00:00.000Z");

function applyResult(overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    interaction_id: new mongoose.Types.ObjectId().toHexString(),
    contact_number_id: null,
    projection_revision: 2,
    noop: false,
    created: false,
    newly_terminal: false,
    newly_settled: false,
    call_log_state: "settled",
    new_recording_ids: [],
    fenced_party_events: 0,
    stale_call_log: false,
    merged_interaction_ids: [],
    jobs: [],
    contact_number_created: false,
    ...overrides,
  };
}

function harness(input: { attempts?: number; fetch: CallLogRefreshDeps["fetch"]; apply?: CallLogRefreshDeps["apply"] }) {
  const jobId = new mongoose.Types.ObjectId();
  const interactionId = new mongoose.Types.ObjectId();
  const calls = {
    complete: [] as Array<{ result: { state: string; attempt: number; records: number; applied: unknown[]; error_code: string | null } }>,
    fail: [] as Array<{ reason: string; retryAfterMs: number; resumeAt: Date | undefined }>,
    fetch: [] as Array<{ telephonySessionId: string; dateFrom: Date }>,
    apply: [] as Array<{ accountId: string; proof_ref: string; source: string | undefined; request_id: string | null | undefined }>,
  };
  const deps: CallLogRefreshDeps = {
    now: () => NOW,
    owner: "refresh-worker",
    claim: (async () => ({
      _id: jobId,
      lease_epoch: 1,
      attempts: input.attempts ?? 1,
      subject_key: callLogRefreshSubjectKey("s-r"),
      input_refs: [interactionId],
    })) as never,
    complete: (async (_lease: unknown, _mutation: unknown, options: { result: never }) => {
      calls.complete.push(options);
    }) as never,
    fail: (async (_lease: unknown, reason: string, retryAfterMs: number, options: { resumeAt?: Date }) => {
      calls.fail.push({ reason, retryAfterMs, resumeAt: options.resumeAt });
      return { status: "retry", next_attempt_at: options.resumeAt ?? new Date(NOW.getTime() + Math.max(retryAfterMs, 30_000)) };
    }) as never,
    loadState: async () => ({ telephony_session_id: "s-r", started_at: new Date("2026-09-23T14:30:00.000Z"), provider_account_id: "800000000001", account_parties_terminal: true }),
    fetch: async (args) => {
      calls.fetch.push(args);
      return input.fetch!(args);
    },
    apply:
      input.apply ??
      ((async (accountId: string, observation: { proof_ref: string; source?: string }, persist: { request_id?: string | null }) => {
        calls.apply.push({ accountId, proof_ref: observation.proof_ref, source: observation.source, request_id: persist.request_id });
        return applyResult({ interaction_id: interactionId.toHexString() });
      }) as never),
    directory: async () => syntheticDirectory(),
    resolveRoute: () => null,
    configuredAccountId: null,
    publish: { shouldPublish: () => false },
  };
  return { deps, calls, jobId: jobId.toHexString() };
}

test("consumer: no record yet retries at +2, +5, +15 min, then completes not_published", async () => {
  for (const [index, wait] of CALL_LOG_REFRESH_RETRY_DELAYS_MS.entries()) {
    const h = harness({ attempts: index + 1, fetch: async () => [] });
    const outcome = await runCallLogRefreshJob(h.jobId, h.deps);
    assert.equal(outcome.status, "retry");
    assert.equal(h.calls.fail[0]!.resumeAt?.getTime(), NOW.getTime() + wait);
    assert.equal(h.calls.complete.length, 0);
  }
  const last = harness({ attempts: CALL_LOG_REFRESH_RETRY_DELAYS_MS.length + 1, fetch: async () => [] });
  const outcome = await runCallLogRefreshJob(last.jobId, last.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(last.calls.complete[0]!.result.state, "not_published");
  assert.equal(last.calls.fail.length, 0);
});

test("consumer: a 429 is transient (throttled, attempt not spent); other provider errors retry with backoff", async () => {
  const throttled = harness({
    fetch: async () => {
      throw new RingCentralApiError("throttled", 429, "Too Many Requests", "/call-log", "GET", null);
    },
  });
  const outcome = await runCallLogRefreshJob(throttled.jobId, throttled.deps);
  assert.equal(outcome.status, "retry");
  assert.ok(outcome.status === "retry" && outcome.reason === "throttled");
  assert.equal(throttled.calls.fail[0]!.reason, "throttled");
  assert.ok(throttled.calls.fail[0]!.retryAfterMs > 0);

  const broken = harness({
    fetch: async () => {
      throw new RingCentralApiError("down", 503, "Unavailable", "/call-log", "GET", null);
    },
  });
  assert.equal((await runCallLogRefreshJob(broken.jobId, broken.deps)).status, "retry");
  assert.equal(broken.calls.fail[0]!.reason, "transient");
});

test("drain: stops at the first throttle instead of claiming every due job just to defer it", async () => {
  const h = harness({
    fetch: async () => {
      throw new RingCentralApiError("throttled", 429, "Too Many Requests", "/call-log", "GET", null);
    },
  });
  const summary = await drainCallLogRefreshJobs(50, h.deps);
  assert.equal(summary.claimed, 1);
  assert.equal(summary.retried, 1);
  assert.equal(summary.throttled, true);
  assert.equal(h.calls.fetch.length, 1);
});

test("narrowed refresh: with Call Log Sync on, a call ISync already confirmed (provisional) completes already_confirmed without a provider read", async () => {
  const h = harness({ fetch: async () => assert.fail("no provider read for a confirmed row") });
  h.deps.syncMode = "on";
  h.deps.loadState = async () => ({
    telephony_session_id: "s-r",
    started_at: new Date("2026-09-23T14:30:00.000Z"),
    provider_account_id: "800000000001",
    account_parties_terminal: true,
    call_log_state: "provisional",
  });
  const outcome = await runCallLogRefreshJob(h.jobId, h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(h.calls.complete[0]!.result.state, "already_confirmed");
});

test("narrowed refresh: an unconfirmed session with Call Log Sync on retries after 5, then 15 minutes, then completes not_published", async () => {
  for (const [index, wait] of CALL_LOG_REFRESH_ISYNC_RETRY_DELAYS_MS.entries()) {
    const h = harness({ attempts: index + 1, fetch: async () => [] });
    h.deps.syncMode = "on";
    const outcome = await runCallLogRefreshJob(h.jobId, h.deps);
    assert.equal(outcome.status, "retry");
    assert.equal(h.calls.fail[0]!.resumeAt?.getTime(), NOW.getTime() + wait);
  }
  const last = harness({ attempts: CALL_LOG_REFRESH_ISYNC_RETRY_DELAYS_MS.length + 1, fetch: async () => [] });
  last.deps.syncMode = "on";
  await runCallLogRefreshJob(last.jobId, last.deps);
  assert.equal(last.calls.complete[0]!.result.state, "not_published");
});

test("overlapping provider session IDs retain separate refreshes and reject foreign Detailed records", async () => {
  assert.notEqual(callLogRefreshDedupeKey("s-r", "100"), callLogRefreshDedupeKey("s-r", "200"));
  const h = harness({ fetch: async () => [{ id: "shared", uri: "/restapi/v1.0/account/200/call-log/shared" }] });
  const outcome = await runCallLogRefreshJob(h.jobId, h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(h.calls.complete[0]?.result.error_code, "account_mismatch");
  assert.equal(h.calls.apply.length, 0);
});
