import assert from "node:assert/strict";
import { test } from "node:test";
import { salesOutreachFreshnessSchema } from "../../../validation/v1/salesOutreachReads";
import { callsCoverageForDay, composeFreshness, mergeRowCoverage, type CaptureSyncRow } from "./freshness";

const NOW = new Date("2026-10-05T15:00:00Z");
const row = (scope: string, through: string | null, finished: string | null = null, error: string | null = null): CaptureSyncRow => ({
  scope,
  known_complete_through: through ? new Date(through) : null,
  last_finished_at: finished ? new Date(finished) : null,
  last_error_code: error,
});

test("freshness: calls fresh/delayed/unknown from the Call Log reconcile watermark", () => {
  const fresh = composeFreshness({ now: NOW, calls: row("call_log_all_directions", "2026-10-05T14:52:00Z", "2026-10-05T14:53:00Z"), sms_capture_enabled: false, sms_mailboxes: [], granot_last_observed_at: null });
  salesOutreachFreshnessSchema.parse(fresh);
  assert.deepEqual([fresh.calls.state, fresh.calls.age_seconds, fresh.calls.reason], ["fresh", 480, null]);
  const delayed = composeFreshness({ now: NOW, calls: row("call_log_all_directions", "2026-10-05T14:40:00Z"), sms_capture_enabled: false, sms_mailboxes: [], granot_last_observed_at: null });
  assert.deepEqual([delayed.calls.state, delayed.calls.reason], ["delayed", "capture_behind"]);
  const unknown = composeFreshness({ now: NOW, calls: null, sms_capture_enabled: false, sms_mailboxes: [], granot_last_observed_at: null });
  assert.deepEqual([unknown.calls.state, unknown.calls.reason, unknown.granot.state], ["unknown", "no_capture_state", "unknown"]);
});

test("freshness: SMS is not connected while capture is off, else the worst reviewed mailbox", () => {
  const off = composeFreshness({ now: NOW, calls: null, sms_capture_enabled: false, sms_mailboxes: [row("rep_sms:1", "2026-10-05T14:59:00Z")], granot_last_observed_at: null });
  assert.deepEqual([off.sms.state, off.sms.reason], ["not_connected", "rep_sms_capture_disabled"]);
  const none = composeFreshness({ now: NOW, calls: null, sms_capture_enabled: true, sms_mailboxes: [], granot_last_observed_at: null });
  assert.deepEqual([none.sms.state, none.sms.reason], ["unknown", "no_mailbox_synced"]);
  const worst = composeFreshness({
    now: NOW,
    calls: null,
    sms_capture_enabled: true,
    sms_mailboxes: [row("rep_sms:1", "2026-10-05T14:59:00Z", "2026-10-05T14:59:30Z"), row("rep_sms:2", "2026-10-05T14:30:00Z", "2026-10-05T14:31:00Z")],
    granot_last_observed_at: new Date("2026-10-05T14:56:00Z"),
  });
  assert.deepEqual([worst.sms.state, worst.sms.known_complete_through, worst.sms.last_updated_at], ["delayed", "2026-10-05T14:30:00.000Z", "2026-10-05T14:31:00.000Z"]);
  assert.deepEqual([worst.granot.state, worst.granot.age_seconds], ["observed", 240]);
  const gap = composeFreshness({ now: NOW, calls: null, sms_capture_enabled: true, sms_mailboxes: [row("rep_sms:1", "2026-10-05T14:59:00Z"), row("rep_sms:2", null)], granot_last_observed_at: null });
  assert.deepEqual([gap.sms.state, gap.sms.reason], ["unknown", "mailbox_without_coverage"]);
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
