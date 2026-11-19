import assert from "node:assert/strict";
import { test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { salesOutreachFreshnessSchema } from "../../../validation/v1/salesOutreachReads";
import { deskTimingOf, type DeskTiming } from "../config/timing";
import {
  callsCoverageForDay,
  composeFreshness,
  mergeRowCoverage,
  type CaptureSyncRow,
} from "./freshness";
import { toSmsCaptureRow } from "./store";

/** 11:00 New York (EDT): inside the staffed capture window [07:45, 20:30). */
const NOW = new Date("2026-10-05T15:00:00Z");
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
