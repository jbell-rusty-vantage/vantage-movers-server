import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { RingCentralApiError } from "../ringcentral/client";
import {
  CALL_LOG_REFRESH_RETRY_DELAYS_MS,
  callLogRefreshDedupeKey,
  callLogRefreshSubjectKey,
  deliveryCarriesTerminalStatus,
  fetchCallLogRecordsBySession,
  runCallLogRefreshJob,
  sessionsNeedingRefresh,
  telephonySessionFromSubjectKey,
  type CallLogRefreshDeps,
} from "./callLogRefresh";
import { at, inboundConnectedCallLog, inboundQueueAnsweredDeliveries, syntheticDirectory } from "./fixtures";
import { normalizeWebhookPartyObservations } from "./observeWebhookEvents";
import { InteractionPersistenceError, type ApplyResult } from "./persistInteraction";

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

test("keys: one refresh per telephony session; the subject key round-trips the session id", () => {
  assert.equal(callLogRefreshDedupeKey("s-1"), "csi:call_log_refresh:session:s-1:1");
  assert.equal(telephonySessionFromSubjectKey(callLogRefreshSubjectKey("s-1")), "s-1");
  assert.equal(telephonySessionFromSubjectKey("webhook_receipt:x"), null);
  assert.equal(telephonySessionFromSubjectKey(null), null);
});

test("provider read: GET call-log by telephonySessionId, Detailed view, dateFrom; records of another session are dropped", async () => {
  const calls: Array<[string, string]> = [];
  const records = await fetchCallLogRecordsBySession(
    { telephonySessionId: "s-1", dateFrom: new Date("2026-09-23T13:00:00.000Z") },
    (async (method: string, endpoint: string) => {
      calls.push([method, endpoint]);
      return { records: [{ id: "a", telephonySessionId: "s-1" }, { id: "b", telephonySessionId: "s-2" }, { id: "c" }, "junk"] };
    }) as never,
  );
  assert.deepEqual(calls, [
    ["GET", "/restapi/v1.0/account/~/call-log?telephonySessionId=s-1&view=Detailed&dateFrom=2026-09-23T13%3A00%3A00.000Z"],
  ]);
  assert.deepEqual(records.map((r) => r.id), ["a", "c"]);
});

test("hang-up detection: needs a terminal status in this delivery AND every account party terminal", async () => {
  const life = inboundQueueAnsweredDeliveries("s-h");
  const ringing = normalizeWebhookPartyObservations(life.ringing, at(1));
  const disconnected = normalizeWebhookPartyObservations(life.disconnected, at(96));
  assert.equal(deliveryCarriesTerminalStatus(ringing, "s-h"), false);
  assert.equal(deliveryCarriesTerminalStatus(disconnected, "s-h"), true);
  assert.equal(deliveryCarriesTerminalStatus(disconnected, "other"), false);

  const loads: string[] = [];
  const terminalState = async (id: string) => {
    loads.push(id);
    return { telephony_session_id: "s-h", started_at: at(0), provider_account_id: "800000000001", account_parties_terminal: true };
  };
  const newly = applyResult({ newly_terminal: true });
  assert.deepEqual(
    await sessionsNeedingRefresh(disconnected, [{ telephony_session_id: "s-h", ok: true, result: newly }], terminalState),
    [{ telephony_session_id: "s-h", interaction_id: newly.interaction_id }],
  );
  assert.deepEqual(loads, [], "newly_terminal needs no row read");

  const already = applyResult({ noop: true });
  assert.equal((await sessionsNeedingRefresh(disconnected, [{ telephony_session_id: "s-h", ok: true, result: already }], terminalState)).length, 1);
  assert.equal(
    (await sessionsNeedingRefresh(disconnected, [{ telephony_session_id: "s-h", ok: true, result: already }], async () => ({
      telephony_session_id: "s-h",
      started_at: at(0),
      provider_account_id: "800000000001",
      account_parties_terminal: false,
    }))).length,
    0,
    "one party still live: no refresh",
  );
  assert.equal((await sessionsNeedingRefresh(ringing, [{ telephony_session_id: "s-h", ok: true, result: newly }], terminalState)).length, 0);
  assert.equal((await sessionsNeedingRefresh(disconnected, [{ telephony_session_id: "s-h", ok: false }], terminalState)).length, 0);
});

type Harness = ReturnType<typeof harness>;

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
    recordEvent: (async () => null) as never,
    publish: { shouldPublish: () => false },
  };
  return { deps, calls, jobId: jobId.toHexString() };
}

test("consumer: applies each fetched record as a Call Log observation (source call_log_reconcile, proof call_log_refresh:<id>) and completes", async () => {
  const h: Harness = harness({ fetch: async () => [inboundConnectedCallLog("s-r")] });
  const outcome = await runCallLogRefreshJob(h.jobId, h.deps);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(h.calls.fetch, [{ telephonySessionId: "s-r", dateFrom: new Date("2026-09-23T13:30:00.000Z") }], "dateFrom = started_at − 1 h");
  assert.deepEqual(h.calls.apply, [{ accountId: "800000000001", proof_ref: "call_log_refresh:cl-s-r", source: "call_log_reconcile", request_id: h.jobId }]);
  assert.equal(h.calls.complete[0]!.result.state, "applied");
  assert.equal(h.calls.fail.length, 0);
});

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

test("consumer: a deterministic projection failure completes with the code visible; a retryable one retries", async () => {
  const deterministic = harness({
    fetch: async () => [inboundConnectedCallLog("s-r")],
    apply: (async () => {
      throw new InteractionPersistenceError("projection_failed", "bad");
    }) as never,
  });
  const done = await runCallLogRefreshJob(deterministic.jobId, deterministic.deps);
  assert.equal(done.status, "completed");
  assert.equal(deterministic.calls.complete[0]!.result.error_code, "projection_failed");

  const retryable = harness({
    fetch: async () => [inboundConnectedCallLog("s-r")],
    apply: (async () => {
      throw new InteractionPersistenceError("retry_exhausted", "busy");
    }) as never,
  });
  assert.equal((await runCallLogRefreshJob(retryable.jobId, retryable.deps)).status, "retry");
});

test("consumer: unclaimable id does nothing", async () => {
  const h = harness({ fetch: async () => [] });
  h.deps.claim = (async () => null) as never;
  assert.deepEqual(await runCallLogRefreshJob(h.jobId, h.deps), { status: "not_claimable", job_id: h.jobId });
  assert.deepEqual(await runCallLogRefreshJob("nope", h.deps), { status: "not_claimable", job_id: "nope" });
  assert.equal(h.calls.fetch.length, 0);
});
