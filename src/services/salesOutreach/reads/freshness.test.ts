import assert from "node:assert/strict";
import { test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { salesOutreachFreshnessSchema } from "../../../validation/v1/salesOutreachReads";
import { deskTimingOf, type DeskTiming } from "../config/timing";
import { readFreshness } from "./common";
import {
  callsCoverageForDay,
  composeFreshness,
  inStaffedCaptureWindow,
  mergeRowCoverage,
  staffedCaptureWindowStart,
  type CaptureSyncRow,
} from "./freshness";
import { toCallsCaptureRow, toSmsCaptureRow } from "./store";
import { activeInspection, MemoryReadStore } from "./testing";

/** 11:00 New York (EDT): inside the staffed capture window [07:45, 20:30). */
const NOW = new Date("2026-10-05T15:00:00Z");
/** 22:00 New York (EDT): outside the staffed capture window. */
const NIGHT = new Date("2026-10-06T02:00:00Z");
const DEFAULTS = deskTimingOf(null);
const ago = (now: Date, seconds: number) => new Date(now.getTime() - seconds * 1000);
const row = (scope: string, through: string | null, finished: string | null = null, error: string | null = null): CaptureSyncRow => ({
  scope,
  known_complete_through: through ? new Date(through) : null,
  last_finished_at: finished ? new Date(finished) : null,
  last_error_code: error,
});
/** A Call Log row: confirmation `confirmedAgo` s before `now`, capped watermark `knownAgo` s before `now`. */
const callsRow = (now: Date, input: { confirmedAgo: number | null; knownAgo: number | null; observedAgo?: number; error?: string }): CaptureSyncRow => ({
  scope: "call_log_all_directions",
  known_complete_through: input.knownAgo === null ? null : ago(now, input.knownAgo),
  last_finished_at: null,
  last_error_code: input.error ?? null,
  confirmation_success_at: input.confirmedAgo === null ? null : ago(now, input.confirmedAgo),
  observed_complete_through: input.observedAgo === undefined ? null : ago(now, input.observedAgo),
});
const calls = (now: Date, capture: CaptureSyncRow | null, webhookAt: Date | null, timing: DeskTiming = DEFAULTS) => {
  const freshness = composeFreshness({
    now,
    timing,
    calls: capture,
    last_call_webhook_at: webhookAt,
    sms_capture_enabled: false,
    sms_mailboxes: [],
    granot_last_observed_at: null,
  });
  salesOutreachFreshnessSchema.parse(freshness);
  return freshness.calls;
};

test("staffed capture window is [07:45, 20:30) New York, DST-safe", () => {
  assert.equal(inStaffedCaptureWindow(NOW), true);
  assert.equal(inStaffedCaptureWindow(NIGHT), false);
  assert.equal(inStaffedCaptureWindow(new Date("2026-10-05T11:44:00Z")), false, "07:44 EDT");
  assert.equal(inStaffedCaptureWindow(new Date("2026-10-05T11:45:00Z")), true, "07:45 EDT");
  assert.equal(inStaffedCaptureWindow(new Date("2026-10-06T00:29:00Z")), true, "20:29 EDT");
  assert.equal(inStaffedCaptureWindow(new Date("2026-10-06T00:30:00Z")), false, "20:30 EDT");
  assert.equal(inStaffedCaptureWindow(new Date("2026-12-07T12:45:00Z")), true, "07:45 EST");
  assert.equal(inStaffedCaptureWindow(new Date("2026-12-07T12:44:00Z")), false, "07:44 EST");
});

test("calls: fresh with lane success 40 s ago, coverage 20 min behind and a webhook 2 min ago (in window)", () => {
  const fresh = calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 20 * 60 }), ago(NOW, 120));
  assert.equal(fresh.state, "fresh");
  assert.equal(fresh.reason, null);
  // "Calls updated" = min(confirmation, webhook) inside the staffed window.
  assert.deepEqual([fresh.last_updated_at, fresh.age_seconds], [ago(NOW, 120).toISOString(), 120]);
  assert.deepEqual([fresh.last_confirmation_at, fresh.last_webhook_at], [ago(NOW, 40).toISOString(), ago(NOW, 120).toISOString()]);
  assert.equal(fresh.known_complete_through, ago(NOW, 20 * 60).toISOString(), "the capped watermark is still served");
  // A webhook newer than the confirmation: the confirmation is the older instant.
  const webhookNewer = calls(NOW, callsRow(NOW, { confirmedAgo: 90, knownAgo: 16 * 60 }), ago(NOW, 5));
  assert.deepEqual([webhookNewer.state, webhookNewer.age_seconds], ["fresh", 90]);
});

test("calls: delayed webhook_silent when today's newest call webhook is 45 min old in the window", () => {
  const silent = calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 18 * 60 }), ago(NOW, 45 * 60));
  assert.deepEqual([silent.state, silent.reason], ["delayed", "webhook_silent"]);
  assert.equal(silent.age_seconds, 45 * 60, "age follows min(confirmation, webhook)");
  // 29 min of silence is inside the default 30-minute threshold.
  assert.equal(calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 18 * 60 }), ago(NOW, 29 * 60)).state, "fresh");
  // No call webhook ever received: there is no stream to fall silent (the subscription health check reports a missing one).
  const never = calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 18 * 60 }), null);
  assert.deepEqual([never.state, never.reason, never.last_webhook_at, never.age_seconds], ["fresh", null, null, 40]);
});

test("staffed capture window start is today's 07:45 New York inside the window, null outside (DST-safe)", () => {
  assert.equal(staffedCaptureWindowStart(NOW)?.toISOString(), "2026-10-05T11:45:00.000Z", "07:45 EDT");
  assert.equal(staffedCaptureWindowStart(new Date("2026-10-05T11:45:00Z"))?.toISOString(), "2026-10-05T11:45:00.000Z");
  assert.equal(staffedCaptureWindowStart(new Date("2026-10-06T00:29:59Z"))?.toISOString(), "2026-10-05T11:45:00.000Z", "20:29 EDT, same day");
  assert.equal(staffedCaptureWindowStart(new Date("2026-12-07T15:00:00Z"))?.toISOString(), "2026-12-07T12:45:00.000Z", "07:45 EST");
  assert.equal(staffedCaptureWindowStart(new Date("2026-10-05T11:44:59Z")), null, "07:44 EDT");
  assert.equal(staffedCaptureWindowStart(NIGHT), null);
});

test("calls: no webhook_silent from 07:45 until the day's first call webhook (olr AW1)", () => {
  /** 07:50 New York (EDT), five minutes after the window opened. */
  const opening = new Date("2026-10-05T11:50:00Z");
  /** Last night's last call webhook, 19:58 New York the day before. */
  const lastNight = new Date("2026-10-04T23:58:00Z");
  const morning = calls(opening, callsRow(opening, { confirmedAgo: 30, knownAgo: 17 * 60 }), lastNight);
  assert.deepEqual([morning.state, morning.reason], ["fresh", null]);
  // "Calls updated" is the confirmation alone until today's stream starts; the old receipt is still served.
  assert.deepEqual([morning.last_updated_at, morning.age_seconds], [ago(opening, 30).toISOString(), 30]);
  assert.equal(morning.last_webhook_at, lastNight.toISOString());
  // A quiet morning: 09:30 New York and still no call today is not silence.
  const late = new Date("2026-10-05T13:30:00Z");
  assert.deepEqual(
    [calls(late, callsRow(late, { confirmedAgo: 30, knownAgo: 17 * 60 }), lastNight).state, calls(late, callsRow(late, { confirmedAgo: 30, knownAgo: 17 * 60 }), null).state],
    ["fresh", "fresh"],
  );
  // A receipt before the window opened (an early 07:30 call) does not start today's stream either.
  const early = new Date("2026-10-05T11:30:00Z");
  assert.equal(calls(late, callsRow(late, { confirmedAgo: 30, knownAgo: 17 * 60 }), early).reason, null);
  // Once today's first call webhook arrived (07:46), silence counts from it: 34 min later is webhook_silent.
  const first = new Date("2026-10-05T11:46:00Z");
  const afterFirst = new Date("2026-10-05T12:20:00Z");
  const silent = calls(afterFirst, callsRow(afterFirst, { confirmedAgo: 30, knownAgo: 17 * 60 }), first);
  assert.deepEqual([silent.state, silent.reason, silent.age_seconds], ["delayed", "webhook_silent", 34 * 60]);
  // ...and the threshold stays tunable through evidence.webhook_silence_minutes.
  const patient = deskTimingOf(salesOutreachConfigurationValueSchema.parse({ evidence: { webhook_silence_minutes: 60 } }));
  assert.deepEqual([calls(afterFirst, callsRow(afterFirst, { confirmedAgo: 30, knownAgo: 17 * 60 }), first, patient).state], ["fresh"]);
});

test("calls: outside the staffed window the webhook is ignored", () => {
  const night = calls(NIGHT, callsRow(NIGHT, { confirmedAgo: 180, knownAgo: 17 * 60 }), ago(NIGHT, 3 * 3600));
  assert.deepEqual([night.state, night.reason], ["fresh", null]);
  assert.deepEqual([night.last_updated_at, night.age_seconds], [ago(NIGHT, 180).toISOString(), 180], "the confirmation alone");
  assert.equal(night.last_webhook_at, ago(NIGHT, 3 * 3600).toISOString(), "still served as a diagnostic");
  assert.equal(calls(NIGHT, callsRow(NIGHT, { confirmedAgo: 180, knownAgo: 17 * 60 }), null).state, "fresh");
});

test("calls: confirmation_stale when the lane and the reconcile sync are both older than 10 min", () => {
  const stale = calls(NOW, callsRow(NOW, { confirmedAgo: 11 * 60, knownAgo: 18 * 60 }), ago(NOW, 60));
  assert.deepEqual([stale.state, stale.reason, stale.age_seconds], ["delayed", "confirmation_stale", 11 * 60]);
  // No confirmation at all, but a watermark: delayed, not unknown.
  const none = calls(NOW, callsRow(NOW, { confirmedAgo: null, knownAgo: 18 * 60 }), ago(NOW, 60));
  assert.deepEqual([none.state, none.reason, none.last_updated_at, none.age_seconds], ["delayed", "confirmation_stale", null, null]);
  // confirmation_stale is reported before coverage_behind and webhook_silent.
  const all = calls(NOW, callsRow(NOW, { confirmedAgo: 3600, knownAgo: 3 * 3600 }), null);
  assert.equal(all.reason, "confirmation_stale");
});

test("calls: coverage_behind past today tolerance + settlement; the observed watermark ignores a stuck provisional cap", () => {
  // Default 25 + 2 = 27 minutes.
  const behind = calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 52 * 60 }), ago(NOW, 60));
  assert.deepEqual([behind.state, behind.reason], ["delayed", "coverage_behind"]);
  assert.equal(calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 27 * 60 }), ago(NOW, 60)).state, "fresh", "exactly at the bound");
  // A provisional row holds the capped watermark 52 min back; the observed one is 18 min behind.
  const observed = calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 52 * 60, observedAgo: 18 * 60 }), ago(NOW, 60));
  assert.deepEqual([observed.state, observed.reason, observed.known_complete_through], ["fresh", null, ago(NOW, 52 * 60).toISOString()]);
  // coverage_behind is reported before webhook_silent.
  assert.equal(calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 52 * 60 }), null).reason, "coverage_behind");
});

test("calls: the reconcile's last error code names the delay; unknown without any capture state", () => {
  const errored = calls(NOW, callsRow(NOW, { confirmedAgo: 15 * 60, knownAgo: 40 * 60, error: "RateLimited" }), ago(NOW, 60));
  assert.deepEqual([errored.state, errored.reason], ["delayed", "RateLimited"]);
  // An error on a run that does not make capture stale does not turn it red.
  assert.deepEqual(
    [calls(NOW, callsRow(NOW, { confirmedAgo: 40, knownAgo: 18 * 60, error: "RateLimited" }), ago(NOW, 60)).state],
    ["fresh"],
  );
  const unknown = calls(NOW, null, ago(NOW, 60));
  assert.deepEqual([unknown.state, unknown.reason, unknown.age_seconds, unknown.last_webhook_at], ["unknown", "no_capture_state", null, ago(NOW, 60).toISOString()]);
  const empty = calls(NOW, callsRow(NOW, { confirmedAgo: null, knownAgo: null, error: "CallLogFailed" }), null);
  assert.deepEqual([empty.state, empty.reason], ["unknown", "CallLogFailed"]);
});

test("calls: thresholds come from the configuration (deskTimingOf)", () => {
  const timing = deskTimingOf(
    salesOutreachConfigurationValueSchema.parse({
      evidence: { capture_freshness_tolerance_minutes: 2, today_coverage_tolerance_minutes: 40, webhook_silence_minutes: 60 },
    }),
  );
  // 3-minute-old confirmation: fresh under the default 10, stale under 2.
  assert.equal(calls(NOW, callsRow(NOW, { confirmedAgo: 180, knownAgo: 18 * 60 }), ago(NOW, 60)).state, "fresh");
  assert.equal(calls(NOW, callsRow(NOW, { confirmedAgo: 180, knownAgo: 18 * 60 }), ago(NOW, 60), timing).reason, "confirmation_stale");
  // 35 min of coverage lag and 45 min of webhook silence: delayed by default, fresh under 40 + 2 and 60.
  assert.equal(calls(NOW, callsRow(NOW, { confirmedAgo: 60, knownAgo: 35 * 60 }), ago(NOW, 45 * 60)).state, "delayed");
  assert.equal(calls(NOW, callsRow(NOW, { confirmedAgo: 60, knownAgo: 35 * 60 }), ago(NOW, 45 * 60), timing).state, "fresh");
});

test("calls row: the confirmation instant is max(ISync lane success, reconcile sync success) (lane A F5)", () => {
  const lane = new Date("2026-10-05T12:00:00Z");
  const reconcile = new Date("2026-10-05T14:58:00Z");
  const base = { scope: "call_log_all_directions", known_complete_through: new Date("2026-10-05T14:40:00Z") };
  // The sticky reconcile field (A3-cap) counts even when the lane is hours old.
  const sticky = toCallsCaptureRow({ ...base, isync_lane: { last_success_at: lane }, reconcile_sync_success_at: reconcile, last_run: { finished_at: reconcile } });
  assert.equal(sticky.confirmation_success_at?.toISOString(), reconcile.toISOString());
  assert.equal(calls(NOW, sticky, ago(NOW, 60)).state, "fresh");
  // A row written before the sticky field: the last run counts when it ran in sync mode on and stored a
  // token without a sync error (the rule that stamps reconcile_sync_success_at).
  const legacy = toCallsCaptureRow({ ...base, isync_lane: { last_success_at: lane }, last_run: { finished_at: reconcile, sync_mode: "on", sync_token_stored: true, sync_error_code: null } });
  assert.equal(legacy.confirmation_success_at?.toISOString(), reconcile.toISOString());
  // A shadow (or off, or unrecorded) sync mode only counts records: never a confirmation (olr AW1).
  for (const sync_mode of ["shadow", "off", null, undefined]) {
    const notOn = toCallsCaptureRow({ ...base, isync_lane: { last_success_at: lane }, last_run: { finished_at: reconcile, sync_mode, sync_token_stored: true, sync_error_code: null } });
    assert.equal(notOn.confirmation_success_at?.toISOString(), lane.toISOString(), `sync_mode ${String(sync_mode)}`);
  }
  const shadowOnly = toCallsCaptureRow({ ...base, last_run: { finished_at: reconcile, sync_mode: "shadow", sync_token_stored: true, sync_error_code: null } });
  assert.equal(shadowOnly.confirmation_success_at, null);
  const syncFailed = toCallsCaptureRow({ ...base, isync_lane: { last_success_at: lane }, last_run: { finished_at: reconcile, sync_mode: "on", sync_token_stored: true, sync_error_code: "CMN-101" } });
  assert.equal(syncFailed.confirmation_success_at?.toISOString(), lane.toISOString());
  const noToken = toCallsCaptureRow({ ...base, isync_lane: { last_success_at: lane }, last_run: { finished_at: reconcile, sync_mode: "on", sync_token_stored: false } });
  assert.equal(noToken.confirmation_success_at?.toISOString(), lane.toISOString());
  // The lane alone (staffed hours) and nothing at all.
  const laneNewer = toCallsCaptureRow({ ...base, isync_lane: { last_success_at: new Date("2026-10-05T14:59:30Z") }, reconcile_sync_success_at: reconcile });
  assert.equal(laneNewer.confirmation_success_at?.toISOString(), "2026-10-05T14:59:30.000Z");
  assert.equal(toCallsCaptureRow(base).confirmation_success_at, null);
  assert.equal(toCallsCaptureRow({ ...base, observed_complete_through: reconcile }).observed_complete_through?.toISOString(), reconcile.toISOString());
});

test("readFreshness wires the configured timing and the newest call webhook from the store", async () => {
  const store = new MemoryReadStore();
  store.calls = callsRow(NOW, { confirmedAgo: 60, knownAgo: 18 * 60 });
  store.callWebhookAt = ago(NOW, 45 * 60);
  const byDefault = await readFreshness(store, activeInspection({}) as never, NOW);
  assert.deepEqual([byDefault.freshness.calls.state, byDefault.freshness.calls.reason], ["delayed", "webhook_silent"]);
  const configured = await readFreshness(store, activeInspection({ evidence: { webhook_silence_minutes: 60 } }) as never, NOW);
  assert.deepEqual([configured.freshness.calls.state, configured.freshness.calls.last_webhook_at], ["fresh", ago(NOW, 45 * 60).toISOString()]);
});

test("freshness: SMS is not connected while capture is off, else the worst reviewed mailbox", () => {
  const off = composeFreshness({ now: NOW, timing: DEFAULTS, calls: null, last_call_webhook_at: null, sms_capture_enabled: false, sms_mailboxes: [row("rep_sms:1", "2026-10-05T14:59:00Z")], granot_last_observed_at: null });
  assert.deepEqual([off.sms.state, off.sms.reason, off.sms.last_confirmation_at, off.sms.last_webhook_at], ["not_connected", "rep_sms_capture_disabled", null, null]);
  const none = composeFreshness({ now: NOW, timing: DEFAULTS, calls: null, last_call_webhook_at: null, sms_capture_enabled: true, sms_mailboxes: [], granot_last_observed_at: null });
  assert.deepEqual([none.sms.state, none.sms.reason], ["unknown", "no_mailbox_synced"]);
  const worst = composeFreshness({
    now: NOW,
    timing: DEFAULTS,
    calls: null,
    last_call_webhook_at: ago(NOW, 30),
    sms_capture_enabled: true,
    sms_mailboxes: [row("rep_sms:1", "2026-10-05T14:59:00Z", "2026-10-05T14:59:30Z"), row("rep_sms:2", "2026-10-05T14:30:00Z", "2026-10-05T14:31:00Z")],
    granot_last_observed_at: new Date("2026-10-05T14:56:00Z"),
  });
  salesOutreachFreshnessSchema.parse(worst);
  assert.deepEqual([worst.sms.state, worst.sms.known_complete_through, worst.sms.last_updated_at], ["delayed", "2026-10-05T14:30:00.000Z", "2026-10-05T14:31:00.000Z"]);
  assert.deepEqual([worst.sms.last_confirmation_at, worst.sms.last_webhook_at], [null, null], "the call webhook never feeds SMS");
  assert.deepEqual([worst.granot.state, worst.granot.age_seconds], ["observed", 240]);
  const gap = composeFreshness({ now: NOW, timing: DEFAULTS, calls: null, last_call_webhook_at: null, sms_capture_enabled: true, sms_mailboxes: [row("rep_sms:1", "2026-10-05T14:59:00Z"), row("rep_sms:2", null)], granot_last_observed_at: null });
  assert.deepEqual([gap.sms.state, gap.sms.reason], ["unknown", "mailbox_without_coverage"]);
  // The SMS threshold is the configured capture freshness tolerance (default 10 min).
  const eight = [row("rep_sms:1", "2026-10-05T14:52:00Z")];
  const smsOf = (timing: DeskTiming) =>
    composeFreshness({ now: NOW, timing, calls: null, last_call_webhook_at: null, sms_capture_enabled: true, sms_mailboxes: eight, granot_last_observed_at: null }).sms.state;
  assert.equal(smsOf(DEFAULTS), "fresh");
  assert.equal(smsOf(deskTimingOf(salesOutreachConfigurationValueSchema.parse({ evidence: { capture_freshness_tolerance_minutes: 5 } }))), "delayed");
});

test("olr C7 freshness.sms.pending: summed over the mailboxes, the ones with any listed; null while capture is off or before the first count", () => {
  const ALICE = "6650a1b2c3d4e5f60718293a";
  const counted = (scope: string, identity: number, association: number, agent_id: string | null): CaptureSyncRow => ({
    ...row(scope, "2026-10-05T14:59:00Z", "2026-10-05T14:59:30Z"),
    sms_pending: { identity, association, agent_id },
  });
  const compose = (enabled: boolean, mailboxes: CaptureSyncRow[]) => {
    const freshness = composeFreshness({ now: NOW, timing: DEFAULTS, calls: null, last_call_webhook_at: null, sms_capture_enabled: enabled, sms_mailboxes: mailboxes, granot_last_observed_at: null });
    salesOutreachFreshnessSchema.parse(freshness);
    return freshness;
  };
  const mailboxes = [counted("rep_sms:102", 0, 1, null), counted("rep_sms:101", 2, 0, ALICE), counted("rep_sms:103", 0, 0, ALICE)];
  const on = compose(true, mailboxes);
  assert.deepEqual(on.sms.pending, {
    identity: 2,
    association: 1,
    window_days: 7,
    mailboxes: [
      { extension_id: "101", agent_id: ALICE, identity: 2, association: 0 },
      { extension_id: "102", agent_id: null, identity: 0, association: 1 },
    ],
  });
  assert.equal("pending" in on.calls, false, "calls carry no pending block");
  assert.equal(compose(false, mailboxes).sms.pending, null, "null while rep SMS capture is off");
  assert.equal(compose(true, [row("rep_sms:101", "2026-10-05T14:59:00Z")]).sms.pending, null, "null before the first count");
  assert.equal(compose(true, []).sms.pending, null);
  // A mailbox row not yet counted adds nothing; the counted ones still sum.
  assert.deepEqual(compose(true, [row("rep_sms:104", "2026-10-05T14:59:00Z"), counted("rep_sms:102", 0, 1, null)]).sms.pending?.association, 1);
  // The read store maps the stored subdocument (ObjectId agent) onto the row.
  assert.deepEqual(
    toSmsCaptureRow({ scope: "rep_sms:101", known_complete_through: null, rep_sms_pending: { identity: 3, association: 0, agent_id: { toString: () => ALICE } } }).sms_pending,
    { identity: 3, association: 0, agent_id: ALICE },
  );
  assert.equal(toSmsCaptureRow({ scope: "rep_sms:101" }).sms_pending, null);
});

test("row coverage can only lower capture coverage; unrecognized coverage counts as unknown", () => {
  const required = new Date("2026-10-05T14:50:00Z");
  const complete = callsCoverageForDay(new Date("2026-10-05T14:55:00Z"), required);
  assert.equal(mergeRowCoverage(null, complete), complete);
  assert.equal(mergeRowCoverage({ state: "complete" }, complete), complete);
  assert.equal(mergeRowCoverage({ state: "bogus" }, complete).state, "unknown");
  const partialCapture = callsCoverageForDay(new Date("2026-10-05T14:00:00Z"), required);
  assert.equal(mergeRowCoverage({ state: "complete" }, partialCapture), partialCapture);
  assert.deepEqual(callsCoverageForDay(null, required).gaps, [{ from: null, to: "2026-10-05T14:50:00.000Z" }]);
});
