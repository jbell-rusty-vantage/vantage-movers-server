import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { RingCentralApiError } from "../ringcentral/client";
import type { LeaseToken } from "../durableWork/types";
import type { CallLogSyncInput, CallLogSyncPage } from "./callLogClient";
import type { TouchedInteraction } from "./callLogApplier";
import {
  ISYNC_LANE_PAGE_BUDGET,
  isyncLaneMinute,
  isyncLaneSetOf,
  runCallLogIsyncLaneOnce,
  storedTokenUsable,
  type IsyncLaneDeps,
  type IsyncLaneState,
  type IsyncLaneStore,
  type IsyncLaneWrite,
} from "./callLogIsyncLane";
import { inboundConnectedCallLog, outboundMissedCallLog, syntheticDirectory } from "./fixtures";
import { InteractionPersistenceError, type ApplyResult } from "./persistInteraction";
import { acquireWithWait } from "./reconcileCallLog";

const iso = (value: string) => new Date(value);

test("staffed-hours gate: New York [07:45, 20:30), yields on the reconcile minute (UTC minute ≡ 3 mod 5)", () => {
  // 2026-10-05 is EDT (UTC−4).
  assert.deepEqual(isyncLaneMinute(iso("2026-10-05T11:44:00Z")), { run: false, reason: "outside_staffed_hours" }, "07:44");
  assert.deepEqual(isyncLaneMinute(iso("2026-10-05T11:45:00Z")), { run: true }, "07:45 opens");
  assert.deepEqual(isyncLaneMinute(iso("2026-10-06T00:29:59Z")), { run: true }, "20:29:59");
  assert.deepEqual(isyncLaneMinute(iso("2026-10-06T00:30:00Z")), { run: false, reason: "outside_staffed_hours" }, "20:30 closes");
  assert.deepEqual(isyncLaneMinute(iso("2026-10-05T16:03:00Z")), { run: false, reason: "reconcile_minute" }, "12:03 is the reconcile's");
  assert.deepEqual(isyncLaneMinute(iso("2026-10-05T16:08:30Z")), { run: false, reason: "reconcile_minute" });
  assert.deepEqual(isyncLaneMinute(iso("2026-10-05T16:04:00Z")), { run: true });
});

test("staffed-hours gate is DST-safe on both 2026 transitions (wall clock, never a fixed UTC offset)", () => {
  // Spring forward: Sunday 2026-03-08. Saturday 07:45 is EST (12:45Z); Sunday 07:45 is EDT (11:45Z).
  assert.deepEqual(isyncLaneMinute(iso("2026-03-07T11:45:00Z")), { run: false, reason: "outside_staffed_hours" }, "Sat 06:45 EST");
  assert.deepEqual(isyncLaneMinute(iso("2026-03-07T12:45:00Z")), { run: true }, "Sat 07:45 EST");
  assert.deepEqual(isyncLaneMinute(iso("2026-03-08T11:45:00Z")), { run: true }, "Sun 07:45 EDT");
  assert.deepEqual(isyncLaneMinute(iso("2026-03-08T11:44:00Z")), { run: false, reason: "outside_staffed_hours" }, "Sun 07:44 EDT");
  assert.deepEqual(isyncLaneMinute(iso("2026-03-09T00:29:00Z")), { run: true }, "Sun 20:29 EDT");
  assert.deepEqual(isyncLaneMinute(iso("2026-03-09T00:30:00Z")), { run: false, reason: "outside_staffed_hours" }, "Sun 20:30 EDT");
  // Fall back: Sunday 2026-11-01. Saturday 07:45 is EDT (11:45Z); Sunday 07:45 is EST (12:45Z).
  assert.deepEqual(isyncLaneMinute(iso("2026-10-31T11:45:00Z")), { run: true }, "Sat 07:45 EDT");
  assert.deepEqual(isyncLaneMinute(iso("2026-11-01T11:45:00Z")), { run: false, reason: "outside_staffed_hours" }, "Sun 06:45 EST");
  assert.deepEqual(isyncLaneMinute(iso("2026-11-01T12:45:00Z")), { run: true }, "Sun 07:45 EST");
  assert.deepEqual(isyncLaneMinute(iso("2026-11-02T01:29:00Z")), { run: true }, "Sun 20:29 EST");
  assert.deepEqual(isyncLaneMinute(iso("2026-11-02T01:30:00Z")), { run: false, reason: "outside_staffed_hours" }, "Sun 20:30 EST");
  // The repeated 01:00–02:00 hour of fall-back night is outside either way.
  assert.deepEqual(isyncLaneMinute(iso("2026-11-01T05:30:00Z")), { run: false, reason: "outside_staffed_hours" });
  assert.deepEqual(isyncLaneMinute(iso("2026-11-01T06:30:00Z")), { run: false, reason: "outside_staffed_hours" });
});

test("stored token usability: present and younger than 24 h; the lane never bootstraps", () => {
  const now = iso("2026-10-05T14:00:00Z");
  assert.equal(storedTokenUsable(undefined, now), false);
  assert.equal(storedTokenUsable({ token: null, sync_time: now }, now), false);
  assert.equal(storedTokenUsable({ token: "t", sync_time: null }, now), false);
  assert.equal(storedTokenUsable({ token: "t", sync_time: iso("2026-10-04T14:00:00Z") }, now), true);
  assert.equal(storedTokenUsable({ token: "t", sync_time: iso("2026-10-04T13:59:59Z") }, now), false);
});

const STAFFED = iso("2026-10-05T14:01:00Z"); // 10:01 EDT, not a reconcile minute

function applyResult(id: string, overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    interaction_id: id,
    contact_number_id: null,
    projection_revision: 3,
    noop: false,
    created: false,
    newly_terminal: false,
    newly_settled: false,
    call_log_state: "provisional",
    new_recording_ids: [],
    fenced_party_events: 0,
    stale_call_log: false,
    merged_interaction_ids: [],
    jobs: [],
    contact_number_created: false,
    ...overrides,
  };
}

function fakeStore(state: IsyncLaneState, options: { acquire?: boolean; writeOk?: boolean } = {}) {
  const calls = { acquire: 0, release: 0, renew: 0, writes: [] as IsyncLaneWrite[] };
  const token: LeaseToken = { scope: "call_log_all_directions", owner: "lane", epoch: 1, leased_until: new Date(STAFFED.getTime() + 60_000) } as LeaseToken;
  const store: IsyncLaneStore = {
    acquire: async () => {
      calls.acquire += 1;
      return options.acquire === false ? null : token;
    },
    renew: async () => {
      calls.renew += 1;
      return token;
    },
    load: async () => state,
    write: async (_token, update) => {
      calls.writes.push(update);
      return options.writeOk !== false;
    },
    release: async () => {
      calls.release += 1;
    },
  };
  return { store, calls };
}

function laneDeps(input: {
  store: IsyncLaneStore;
  pages: Array<CallLogSyncPage | Error>;
  apply?: IsyncLaneDeps["apply"];
  now?: Date;
}) {
  const requests: CallLogSyncInput[] = [];
  const woken: TouchedInteraction[][] = [];
  const applied: string[] = [];
  const ids = new Map<string, string>();
  const deps: Partial<IsyncLaneDeps> = {
    now: () => input.now ?? STAFFED,
    flagOn: () => true,
    config: { syncMode: "on", perPage: 2, settleHorizonMinutes: 240, quarantineAfter: 3 },
    fetchSync: async (request) => {
      requests.push(request);
      const next = input.pages.shift();
      if (!next) throw new Error("unexpected provider request");
      if (next instanceof Error) throw next;
      return next;
    },
    apply:
      input.apply ??
      ((async (_account: string, observation: { record: { id?: unknown } }) => {
        const callLogId = String(observation.record.id);
        applied.push(callLogId);
        const id = ids.get(callLogId) ?? new mongoose.Types.ObjectId().toHexString();
        ids.set(callLogId, id);
        return applyResult(id);
      }) as never),
    directory: async () => syntheticDirectory(),
    resolveRoute: () => null,
    unchanged: async () => new Set(),
    configuredAccountId: null,
    owner: "csi-call-log-isync:test",
    store: input.store,
    wake: async (touched) => {
      woken.push(touched);
    },
  };
  return { deps, requests, woken, applied, ids };
}

const freshToken = { call_log_sync: { token: "tok-1", sync_time: iso("2026-10-05T14:00:00Z"), last_full_sync_at: null, consecutive_expiries: 0 } };

test("ISync lane: gates first — disabled, sync not on, outside hours, reconcile minute — and never touches the lease", async () => {
  const { store, calls } = fakeStore(freshToken);
  const base = laneDeps({ store, pages: [] }).deps;
  assert.equal((await runCallLogIsyncLaneOnce({ ...base, flagOn: () => false })).skip_reason, "disabled");
  assert.equal((await runCallLogIsyncLaneOnce({ ...base, config: { ...base.config!, syncMode: "shadow" } })).skip_reason, "sync_not_on");
  assert.equal((await runCallLogIsyncLaneOnce({ ...base, now: () => iso("2026-10-05T10:00:00Z") })).skip_reason, "outside_staffed_hours");
  assert.equal((await runCallLogIsyncLaneOnce({ ...base, now: () => iso("2026-10-05T14:03:00Z") })).skip_reason, "reconcile_minute");
  assert.equal(calls.acquire, 0);
});

test("ISync lane: a held lease skips; a missing or stale token yields to the reconcile and releases the lease", async () => {
  const held = fakeStore(freshToken, { acquire: false });
  assert.equal((await runCallLogIsyncLaneOnce(laneDeps({ store: held.store, pages: [] }).deps)).skip_reason, "lease_held");
  const missing = fakeStore({});
  const run = laneDeps({ store: missing.store, pages: [] });
  const summary = await runCallLogIsyncLaneOnce(run.deps);
  assert.equal(summary.skip_reason, "token_missing");
  assert.equal(run.requests.length, 0, "no FSync bootstrap from the lane");
  assert.equal(missing.calls.release, 1);
  assert.equal(missing.calls.writes.length, 0);
});

test("ISync lane: one ISync with the stored token applies every changed record, wakes the desk for those rows, stores the next token", async () => {
  const { store, calls } = fakeStore(freshToken);
  const run = laneDeps({
    store,
    pages: [{ records: [inboundConnectedCallLog("s-1"), { id: "fax-1", type: "Fax" }], syncType: "ISync", syncToken: "tok-2", syncTime: iso("2026-10-05T14:00:50Z") }],
  });
  const summary = await runCallLogIsyncLaneOnce({ ...run.deps, config: { ...run.deps.config!, perPage: 250 } });
  assert.equal(summary.skipped, false);
  assert.equal(summary.error_code, null);
  assert.deepEqual(run.requests, [{ syncType: "ISync", syncToken: "tok-1" }]);
  assert.deepEqual(run.applied, ["cl-s-1"], "non-voice records are not calls");
  assert.equal(summary.applied, 1);
  assert.equal(run.woken.length, 1);
  assert.deepEqual(run.woken[0], [{ interaction_id: run.ids.get("cl-s-1"), projection_revision: 3, merged_into: null }]);
  const write = calls.writes[0]!;
  assert.equal(write.call_log_sync?.token, "tok-2");
  assert.equal(write.isync_lane.last_success_at?.getTime(), STAFFED.getTime());
  assert.equal(write.isync_lane.last_error_code, null);
  assert.equal(write.isync_lane.last_records, 1);
});

test("ISync lane: follows further pages only while a page is full, inside the page budget", async () => {
  const { store, calls } = fakeStore(freshToken);
  const full = { records: [inboundConnectedCallLog("s-1"), outboundMissedCallLog("s-2")], syncType: "ISync" as const, syncToken: "tok-2", syncTime: STAFFED };
  const run = laneDeps({
    store,
    pages: [full, { ...full, records: [inboundConnectedCallLog("s-3"), inboundConnectedCallLog("s-4")], syncToken: "tok-3" }, { records: [], syncType: "ISync", syncToken: "tok-4", syncTime: STAFFED }],
  });
  const summary = await runCallLogIsyncLaneOnce(run.deps);
  assert.equal(summary.requests, ISYNC_LANE_PAGE_BUDGET);
  assert.deepEqual(run.requests.map((r) => (r.syncType === "ISync" ? r.syncToken : "F")), ["tok-1", "tok-2", "tok-3"]);
  assert.equal(calls.writes[0]!.call_log_sync?.token, "tok-4");
  assert.equal(run.applied.length, 4);

  const partial = fakeStore(freshToken);
  const once = laneDeps({ store: partial.store, pages: [{ ...full, records: [inboundConnectedCallLog("s-9")] }] });
  assert.equal((await runCallLogIsyncLaneOnce(once.deps)).requests, 1, "a partial page ends the chain");
});

test("ISync lane: a throttle stores nothing new and reports it; the shared gate keeps the next minute honest", async () => {
  const { store, calls } = fakeStore(freshToken);
  const throttle = new RingCentralApiError("throttled", 429, "Too Many Requests", "/call-log-sync", "GET", null, { retryAfterMs: 60_000 });
  const run = laneDeps({ store, pages: [throttle] });
  const summary = await runCallLogIsyncLaneOnce(run.deps);
  assert.equal(summary.error_code, "provider_throttled");
  assert.equal(calls.writes[0]!.call_log_sync, null, "the stored token is left as it was");
  assert.equal(calls.writes[0]!.isync_lane.last_success_at, null);
  assert.equal(run.woken.length, 0);
});

test("A3: a run that stores no token keeps the previous last_success_at (sticky, never set to null)", async () => {
  const { store, calls } = fakeStore(freshToken);
  const throttle = new RingCentralApiError("throttled", 429, "Too Many Requests", "/call-log-sync", "GET", null, { retryAfterMs: 60_000 });
  await runCallLogIsyncLaneOnce(laneDeps({ store, pages: [throttle] }).deps);
  const write = calls.writes[0]!;
  assert.equal(write.isync_lane.last_success_at, null, "the run itself had no success");
  const set = isyncLaneSetOf(write, STAFFED);
  assert.equal("isync_lane.last_success_at" in set, false, "no last_success_at key in the $set: the stored instant stays");
  assert.equal("isync_lane" in set, false, "the subdocument is never replaced whole");
  assert.equal(set["isync_lane.last_run_at"], STAFFED);
  assert.equal(set["isync_lane.last_error_code"], "provider_throttled");
  assert.equal(set["isync_lane.last_records"], 0);
  assert.equal("call_log_sync" in set, false, "the stored token is left as it was");
  assert.equal(set.lease_owner, null);
});

test("A3: a successful run sets last_success_at through a dotted $set", async () => {
  const { store, calls } = fakeStore(freshToken);
  await runCallLogIsyncLaneOnce(laneDeps({ store, pages: [{ records: [], syncType: "ISync", syncToken: "tok-2", syncTime: STAFFED }] }).deps);
  const set = isyncLaneSetOf(calls.writes[0]!, STAFFED);
  assert.equal((set["isync_lane.last_success_at"] as Date).getTime(), STAFFED.getTime());
  assert.equal((set.call_log_sync as { token: string }).token, "tok-2");
  assert.deepEqual(
    Object.keys(set).filter((key) => key.startsWith("isync_lane")).sort(),
    ["isync_lane.last_applied", "isync_lane.last_error_code", "isync_lane.last_records", "isync_lane.last_run_at", "isync_lane.last_success_at"],
  );
});

test("ISync lane: a failing record is counted toward quarantine and holds the token (replayed next minute)", async () => {
  const { store, calls } = fakeStore(freshToken);
  const run = laneDeps({
    store,
    pages: [{ records: [inboundConnectedCallLog("s-1")], syncType: "ISync", syncToken: "tok-2", syncTime: STAFFED }],
    apply: (async () => {
      throw new InteractionPersistenceError("projection_failed", "synthetic");
    }) as never,
  });
  const summary = await runCallLogIsyncLaneOnce(run.deps);
  assert.equal(summary.error_code, "projection_failed");
  assert.equal(calls.writes[0]!.call_log_sync, null);
  assert.deepEqual(calls.writes[0]!.record_failures.map((f) => f.call_log_id), ["cl-s-1"]);
});

test("ISync lane: losing the lease before the fenced write reports lease_lost", async () => {
  const { store } = fakeStore(freshToken, { writeOk: false });
  const run = laneDeps({ store, pages: [{ records: [], syncType: "ISync", syncToken: "tok-2", syncTime: STAFFED }] });
  assert.equal((await runCallLogIsyncLaneOnce(run.deps)).error_code, "lease_lost");
});

test("reconcile lease: polls a briefly held lease (the minute lane) and gives up after the wait", async () => {
  let clock = 0;
  const sleeps: number[] = [];
  let freeAfter = 2;
  const leases = {
    acquire: async () => (freeAfter-- <= 0 ? ({ owner: "r" } as LeaseToken) : null),
  };
  const deps = {
    scope: "s",
    owner: "r",
    ttl_ms: 300_000,
    now: () => new Date(clock),
    waitMs: 20_000,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
  };
  assert.ok(await acquireWithWait(leases as never, deps));
  assert.deepEqual(sleeps, [2_000, 2_000]);

  clock = 0;
  sleeps.length = 0;
  const never = { acquire: async () => null };
  assert.equal(await acquireWithWait(never as never, deps), null);
  assert.ok(clock <= 20_000, "never waits past the bound");
  assert.equal(await acquireWithWait(never as never, { ...deps, waitMs: 0 }), null);
});
