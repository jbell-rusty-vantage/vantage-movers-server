import assert from "node:assert/strict";
import { test } from "node:test";
import { RingCentralApiError } from "../ringcentral/client";
import { isSyncTokenExpired, parseCallLogSyncPayload, type CallLogSyncInput, type CallLogSyncPage } from "./callLogClient";
import { QuarantineBook, quarantineErrorCode, failureLogFields } from "./callLogQuarantine";
import { parseCallLogSyncMode, runCallLogSyncStep, type SyncApplyOutcome } from "./callLogSyncDriver";
import { at } from "./fixtures";
import { InteractionPersistenceError } from "./persistInteraction";
import { callLogReconcileConfig } from "./reconcileCallLog";
import { composeCallLogCapture } from "../salesIntelligence/ownerCoverage";
import type { CallLogRecordInput } from "./interactionProjection";

const failure = (id: string) => ({
  call_log_id: id,
  telephony_session_id: `s-${id}`,
  start_time: at(-600),
  error_code: "persist_failed" as const,
  error_name: "StrictModeError",
});

test("CC-01 quarantine lifecycle: counted, quarantined at 3, held, retried on a doubling backoff, released on success", () => {
  const book = new QuarantineBook([], []);
  assert.equal(book.recordFailure(failure("a"), at(0)), "counted");
  assert.equal(book.recordFailure(failure("a"), at(300)), "counted");
  assert.equal(book.isQuarantined("a"), false);
  assert.equal(book.recordFailure(failure("a"), at(600)), "newly_quarantined");
  assert.equal(book.isQuarantined("a"), true);
  let entry = book.snapshot().quarantined_records[0]!;
  assert.equal(entry.failures, 3);
  assert.equal(entry.next_retry_at.toISOString(), at(600 + 3600).toISOString(), "first retry after 60 minutes");
  assert.deepEqual(book.snapshot().record_failures, [], "the pre-quarantine counter moves, it is not duplicated");

  assert.equal(book.isHeld("a", at(900)), true, "held while its backoff runs");
  assert.deepEqual(book.due(at(900), 5, new Set()), []);
  assert.equal(book.due(at(600 + 3600), 5, new Set()).length, 1);
  assert.equal(book.due(at(600 + 3600), 5, new Set(["a"])).length, 0, "already attempted this run");

  assert.equal(book.recordFailure(failure("a"), at(5000)), "quarantined");
  entry = book.snapshot().quarantined_records[0]!;
  assert.equal(entry.next_retry_at.toISOString(), at(5000 + 7200).toISOString(), "delay doubles");
  for (let i = 0; i < 10; i += 1) book.recordFailure(failure("a"), at(10_000));
  entry = book.snapshot().quarantined_records[0]!;
  assert.equal(entry.next_retry_at.toISOString(), at(10_000 + 12 * 3600).toISOString(), "capped at 12 hours");
  assert.equal(entry.first_failed_at.toISOString(), at(600).toISOString());

  assert.equal(book.recordSuccess("a"), "released");
  assert.equal(book.quarantinedCount, 0);
  book.recordFailure(failure("b"), at(0));
  assert.equal(book.recordSuccess("b"), "cleared", "one success resets the consecutive count");
  assert.equal(book.recordSuccess("c"), null);
  assert.equal(book.changed, true);
});

test("CC-01 quarantine is bounded: the oldest entry is evicted into an overflow range, record failures drop the oldest", () => {
  const limits = { quarantineAfter: 1, baseDelayMinutes: 60, maxDelayMinutes: 720, maxQuarantined: 2, maxRecordFailures: 2 };
  const book = new QuarantineBook([], [], limits);
  book.recordFailure({ ...failure("x"), start_time: at(-100) }, at(1));
  book.recordFailure(failure("y"), at(2));
  book.recordFailure(failure("z"), at(3));
  assert.deepEqual(book.snapshot().quarantined_records.map((e) => e.call_log_id), ["y", "z"]);
  assert.deepEqual(book.overflow.map((r) => [r.from.toISOString(), r.to.toISOString()]), [[at(-100).toISOString(), at(-40).toISOString()]]);

  const counter = new QuarantineBook([], [], { ...limits, quarantineAfter: 5 });
  for (const id of ["p", "q", "r"]) counter.recordFailure(failure(id), at(0));
  assert.deepEqual(counter.snapshot().record_failures.map((e) => e.call_log_id), ["q", "r"]);
});

test("CC-01 failure classification and log fields carry the error name and a bounded message", () => {
  assert.equal(quarantineErrorCode(new InteractionPersistenceError("account_mismatch", "x")), "account_mismatch");
  assert.equal(quarantineErrorCode(new InteractionPersistenceError("retry_exhausted", "x")), "retry_exhausted");
  assert.equal(quarantineErrorCode(new InteractionPersistenceError("identity_missing", "x")), "projection_failed");
  const strict = Object.assign(new Error(`Cast to Embedded failed at path "rollups" ${"x".repeat(400)}`), { name: "StrictModeError" });
  assert.equal(quarantineErrorCode(strict), "persist_failed");
  const fields = failureLogFields(strict);
  assert.equal(fields.errorName, "StrictModeError");
  assert.equal(fields.errorMessage.length, 200);
  assert.match(fields.errorMessage, /^Cast to Embedded failed at path "rollups"/);
});

test("CC-03/05 configuration: settle horizon default 240 with a floor of 60; sync mode off | shadow | on", () => {
  const saved = { ...process.env };
  try {
    delete process.env.SALES_INTELLIGENCE_CALL_LOG_SETTLE_HORIZON_MINUTES;
    delete process.env.SALES_INTELLIGENCE_CALL_LOG_SYNC;
    let config = callLogReconcileConfig();
    assert.equal(config.settleHorizonMinutes, 240);
    assert.equal(config.syncMode, "off");
    assert.equal(config.quarantineAfter, 3);
    assert.equal(config.quarantineRetriesPerRun, 5);
    assert.equal(config.sweepLookbackHours, 36);
    process.env.SALES_INTELLIGENCE_CALL_LOG_SETTLE_HORIZON_MINUTES = "30";
    process.env.SALES_INTELLIGENCE_CALL_LOG_SYNC = "shadow";
    config = callLogReconcileConfig();
    assert.equal(config.settleHorizonMinutes, 60, "floor");
    assert.equal(config.syncMode, "shadow");
    assert.equal(parseCallLogSyncMode("on"), "on");
    assert.equal(parseCallLogSyncMode("false"), "off");
    assert.equal(parseCallLogSyncMode("bogus"), "off");
  } finally {
    process.env = saved;
  }
});

const record = (id: string): CallLogRecordInput => ({ id, type: "Voice", startTime: at(-3000).toISOString(), lastModifiedTime: at(-60).toISOString() });

type FakeSync = { calls: CallLogSyncInput[]; fetch: (input: CallLogSyncInput) => Promise<CallLogSyncPage> };
function fakeSync(script: Array<CallLogSyncPage | Error>): FakeSync {
  const calls: CallLogSyncInput[] = [];
  return {
    calls,
    fetch: async (input) => {
      calls.push(input);
      const next = script.shift();
      if (!next) throw new Error("unexpected sync call");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const page = (ids: string[], token: string, type: "FSync" | "ISync", time = at(0)): CallLogSyncPage => ({
  records: ids.map(record),
  syncType: type,
  syncToken: token,
  syncTime: time,
});
const applyAll = async (records: CallLogRecordInput[]): Promise<SyncApplyOutcome & { changed: number }> => ({
  upserts: records.length,
  noops: 0,
  failures: 0,
  quarantined: 0,
  settled: true,
  changed: records.length,
});
const base = {
  mode: "on" as const,
  now: at(0),
  fsyncFrom: at(-240 * 60),
  recordCount: 2,
  budget: 10,
  countChanged: async () => 0,
  apply: applyAll,
};

test("CC-05 FSync bootstraps, pages by token while full, and ISync continues the chain from the stored token", async () => {
  const bootstrap = fakeSync([page(["r1", "r2"], "t1", "FSync"), page(["r3"], "t2", "ISync", at(5))]);
  const first = await runCallLogSyncStep({ ...base, state: null, fetchSync: bootstrap.fetch });
  assert.deepEqual(bootstrap.calls, [
    { syncType: "FSync", dateFrom: at(-240 * 60), recordCount: 2 },
    { syncType: "ISync", syncToken: "t1" },
  ]);
  assert.equal(first.sync_type, "FSync");
  assert.equal(first.records, 3);
  assert.equal(first.applied, 3);
  assert.equal(first.token_stored, true);
  assert.equal(first.next?.token, "t2");
  assert.equal(first.next?.sync_time?.toISOString(), at(5).toISOString());
  assert.equal(first.next?.last_full_sync_at?.toISOString(), at(0).toISOString());

  // Next run: ISync with the stored token; a record modified after the token
  // whose start is long gone is returned and applied.
  const incremental = fakeSync([page(["r1"], "t3", "ISync", at(300))]);
  const second = await runCallLogSyncStep({ ...base, now: at(300), state: first.next, fetchSync: incremental.fetch });
  assert.deepEqual(incremental.calls, [{ syncType: "ISync", syncToken: "t2" }]);
  assert.equal(second.sync_type, "ISync");
  assert.equal(second.next?.token, "t3");
  assert.equal(second.next?.consecutive_expiries, 0);
  assert.equal(second.next?.last_full_sync_at?.toISOString(), at(0).toISOString(), "an ISync keeps the last full sync time");
});

test("CC-05 an expired token (400 / CLG-*) falls back to FSync in the same run", async () => {
  const expired = new RingCentralApiError("bad token", 400, "Bad Request", "/call-log-sync", "GET", { errorCode: "CLG-104" });
  assert.equal(isSyncTokenExpired(expired), true);
  assert.equal(isSyncTokenExpired(new RingCentralApiError("x", 500, "", "", "GET", { errorCode: "CLG-001" })), true);
  assert.equal(isSyncTokenExpired(new RingCentralApiError("x", 500, "", "", "GET", null)), false);
  const sync = fakeSync([expired, page(["r1"], "fresh", "FSync")]);
  const result = await runCallLogSyncStep({
    ...base,
    state: { token: "stale", sync_time: at(-600), last_full_sync_at: at(-7200), consecutive_expiries: 0 },
    fetchSync: sync.fetch,
  });
  assert.deepEqual(sync.calls.map((c) => c.syncType), ["ISync", "FSync"]);
  assert.equal(result.expired, true);
  assert.equal(result.token_stored, true);
  assert.equal(result.next?.token, "fresh");
  assert.equal(result.next?.consecutive_expiries, 1);

  // A token older than 24 hours is not even tried.
  const old = fakeSync([page([], "renewed", "FSync")]);
  await runCallLogSyncStep({ ...base, state: { token: "ancient", sync_time: at(-25 * 3600) }, fetchSync: old.fetch });
  assert.deepEqual(old.calls.map((c) => c.syncType), ["FSync"]);
});

test("CC-05 the token is not stored when a record fails, is dropped when it had expired, and a throttle changes nothing", async () => {
  const stored = { token: "t1", sync_time: at(-300), last_full_sync_at: at(-3600), consecutive_expiries: 0 };
  const failing = fakeSync([page(["r1", "bad"], "t2", "ISync")]);
  const result = await runCallLogSyncStep({
    ...base,
    recordCount: 250,
    state: stored,
    fetchSync: failing.fetch,
    apply: async (records) => ({ upserts: records.length - 1, noops: 0, failures: 1, quarantined: 0, settled: false, changed: records.length }),
  });
  assert.equal(result.token_stored, false);
  assert.equal(result.next, null, "the stored token replays the same changes next run");
  assert.equal(result.error_code, "projection_failed");

  const quarantinedOnly = await runCallLogSyncStep({
    ...base,
    recordCount: 250,
    state: stored,
    fetchSync: fakeSync([page(["r1", "bad"], "t2", "ISync")]).fetch,
    apply: async () => ({ upserts: 1, noops: 0, failures: 1, quarantined: 1, settled: true, changed: 2 }),
  });
  assert.equal(quarantinedOnly.token_stored, true, "a quarantined record does not hold the token");

  const expiredThenFailing = await runCallLogSyncStep({
    ...base,
    recordCount: 250,
    state: stored,
    fetchSync: fakeSync([new RingCentralApiError("x", 400, "", "", "GET", null), page(["bad"], "t9", "FSync")]).fetch,
    apply: async () => ({ upserts: 0, noops: 0, failures: 1, quarantined: 0, settled: false, changed: 1 }),
  });
  assert.equal(expiredThenFailing.next?.token, null, "an expired token is never replayed");
  assert.equal(expiredThenFailing.next?.consecutive_expiries, 1);

  const throttled = await runCallLogSyncStep({
    ...base,
    state: stored,
    fetchSync: fakeSync([new RingCentralApiError("slow down", 429, "", "", "GET", null)]).fetch,
  });
  assert.equal(throttled.error_code, "provider_throttled");
  assert.equal(throttled.next, null);
  assert.equal(throttled.applied, 0);
});

test("CC-05 shadow counts would-change records, applies nothing, and keeps its own token chain moving", async () => {
  let applied = 0;
  const result = await runCallLogSyncStep({
    ...base,
    mode: "shadow",
    recordCount: 250,
    state: { token: "t1", sync_time: at(-300) },
    fetchSync: fakeSync([
      {
        records: [record("r1"), record("r2"), { id: "fax", type: "Fax" }],
        syncType: "ISync",
        syncToken: "t2",
        syncTime: at(0),
      },
    ]).fetch,
    countChanged: async (records) => records.length - 1,
    apply: async (records) => {
      applied += records.length;
      return applyAll(records);
    },
  });
  assert.equal(applied, 0);
  assert.equal(result.records, 2, "non-voice entries are not calls");
  assert.equal(result.changed, 1);
  assert.equal(result.token_stored, true);
  assert.equal(result.next?.token, "t2");
});

test("Call Log Sync payload parsing keeps the documented shape and tolerates junk", () => {
  const parsed = parseCallLogSyncPayload({ records: [{ id: "1" }], syncInfo: { syncType: "ISync", syncToken: "tok", syncTime: "2026-09-23T20:00:00.000Z" } });
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.syncToken, "tok");
  assert.equal(parsed.syncTime?.toISOString(), "2026-09-23T20:00:00.000Z");
  const junk = parseCallLogSyncPayload(null);
  assert.deepEqual(junk, { records: [], syncType: null, syncToken: null, syncTime: null });
});

test("Owner Coverage: quarantined count, oldest quarantine and the last sweep's correction figures", () => {
  assert.deepEqual(composeCallLogCapture(null, null, "off"), {
    quarantined_count: 0,
    oldest_quarantined_at: null,
    sync_mode: "off",
    last_sweep: null,
  });
  const read = composeCallLogCapture(
    { scope: "call_log_all_directions", quarantined_records: [{ first_failed_at: at(-100) }, { first_failed_at: at(-900) }] },
    {
      scope: "call_log_sweep",
      consecutive_drift_runs: 2,
      last_run: { started_at: at(0), error_code: null, from: at(-36 * 3600), to: at(-4 * 3600), provider_records: 900, stored_in_latest_version: 880, applied_changes: 20, missing_before: 5, stale_before: 15, provisional_after_horizon: 0, quarantined: 2 },
    },
    "shadow",
  );
  assert.equal(read.quarantined_count, 2);
  assert.equal(read.oldest_quarantined_at, at(-900).toISOString());
  assert.equal(read.last_sweep?.complete, true);
  assert.deepEqual([read.last_sweep?.provider_records, read.last_sweep?.missing_before, read.last_sweep?.stale_before, read.last_sweep?.consecutive_drift_runs], [900, 5, 15, 2]);
});
