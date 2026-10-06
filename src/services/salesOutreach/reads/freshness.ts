import type { z } from "zod";
import type { salesOutreachCoverageSchema, salesOutreachFreshnessSchema } from "../../../validation/v1/salesOutreachReads";
import { ISYNC_LANE_END_MINUTE, ISYNC_LANE_START_MINUTE, ISYNC_LANE_TIMEZONE } from "../../numberActivity/callLogIsyncLane";
import type { DeskTiming } from "../config/timing";
import { minuteOfDay } from "../engine/calendar";
import { newYorkDayBounds } from "./businessDay";

export type SalesOutreachFreshness = z.infer<typeof salesOutreachFreshnessSchema>;
export type SalesOutreachCoverage = z.infer<typeof salesOutreachCoverageSchema>;

/** Why calls freshness is not `fresh`, after the reconcile's own `last_error_code`. A free string in the DTO. */
export const CALLS_FRESHNESS_REASONS = ["confirmation_stale", "coverage_behind", "webhook_silent"] as const;
export type CallsFreshnessReason = (typeof CALLS_FRESHNESS_REASONS)[number];

/** One `sales_intelligence_sync_state` row as the desk reads it. */
export type CaptureSyncRow = Readonly<{
  scope: string;
  known_complete_through: Date | null;
  last_finished_at: Date | null;
  last_error_code: string | null;
  /**
   * Calls only (`call_log_all_directions`): the last instant the Call Log confirmed calls, i.e. the later
   * of the minute ISync lane's `isync_lane.last_success_at` and the 5-minute reconcile's own sync success
   * (`reconcile_sync_success_at`, or, on a row written before that field existed, `last_run.finished_at`
   * of a run that stored a sync token without a sync error; lane A F5). Absent/null on SMS rows.
   */
  confirmation_success_at?: Date | null;
  /** Calls only: `observed_complete_through` (the watermark without the provisional-row cap; A3-cap). */
  observed_complete_through?: Date | null;
}>;

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const ageSeconds = (now: Date, at: Date | null) => (at ? Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000)) : null);
/** True when `at` is missing or older than `toleranceMs` before `now`. */
const staleAt = (now: Date, at: Date | null, toleranceMs: number) => !at || now.getTime() - at.getTime() > toleranceMs;
const laterOf = (a: Date | null, b: Date | null) => (a && b ? (a.getTime() >= b.getTime() ? a : b) : (a ?? b));
const earlierOf = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

/**
 * Whether `now` is inside the staffed capture window [07:45, 20:30) New York: the minute ISync lane's
 * window (`callLogIsyncLane.ts`), where a silent call webhook stream means capture is not live
 * (RINGCENTRAL-CAPTURE §8). DST-safe through the engine calendar.
 */
export function inStaffedCaptureWindow(now: Date): boolean {
  const minute = minuteOfDay(now.getTime(), ISYNC_LANE_TIMEZONE);
  return minute >= ISYNC_LANE_START_MINUTE && minute < ISYNC_LANE_END_MINUTE;
}

/** SMS: fresh while the worst mailbox is known complete within the capture freshness tolerance. */
function smsFreshness(
  now: Date,
  knownCompleteThrough: Date | null,
  lastUpdatedAt: Date | null,
  reason: string | null,
  timing: DeskTiming,
): SalesOutreachFreshness["sms"] {
  const state: SalesOutreachFreshness["sms"]["state"] = !knownCompleteThrough
    ? "unknown"
    : staleAt(now, knownCompleteThrough, timing.capture_freshness_tolerance_ms)
      ? "delayed"
      : "fresh";
  return {
    state,
    last_updated_at: iso(lastUpdatedAt),
    known_complete_through: iso(knownCompleteThrough),
    age_seconds: ageSeconds(now, knownCompleteThrough),
    reason: state === "fresh" ? null : (reason ?? (state === "unknown" ? "no_capture_state" : "capture_behind")),
    last_confirmation_at: null,
    last_webhook_at: null,
  };
}

/**
 * Calls freshness (RINGCENTRAL-CAPTURE §8, outreach lifecycle repair A3-fresh).
 * - Confirmation instant: the later of the ISync lane success and the reconcile's sync success. Outside
 *   the staffed window only the reconcile confirms calls, so the lane alone would read delayed every night.
 * - "Calls updated" (`last_updated_at`, `age_seconds`): min(confirmation, newest call webhook receipt)
 *   inside the staffed window; the confirmation alone outside it.
 * - `fresh` needs all three: a confirmation within `capture_freshness_tolerance`; capture coverage within
 *   `today_coverage_tolerance + settlement allowance` (coverage behind never reads green, SPECIFICATION
 *   §16); and, in the staffed window, a call webhook within `webhook_silence`. Otherwise it is `delayed`,
 *   and the reason is the first that applies of: the reconcile's `last_error_code`, `confirmation_stale`,
 *   `coverage_behind`, `webhook_silent`.
 * - `unknown`: neither a confirmation nor a watermark yet.
 * Coverage reads the observed watermark (no provisional-row cap) when it is present, else the capped
 * one, so a stuck provisional Call Log row does not make capture look stale (D-A3). `known_complete_through`
 * is still served as the capped watermark.
 */
function callsFreshness(now: Date, row: CaptureSyncRow | null, lastCallWebhookAt: Date | null, timing: DeskTiming): SalesOutreachFreshness["calls"] {
  const known = row?.known_complete_through ?? null;
  const confirmation = row?.confirmation_success_at ?? null;
  const coverage = laterOf(row?.observed_complete_through ?? null, known);
  const inWindow = inStaffedCaptureWindow(now);
  const lastUpdated = inWindow && lastCallWebhookAt && confirmation ? earlierOf(confirmation, lastCallWebhookAt) : confirmation;
  const diagnostics = { last_confirmation_at: iso(confirmation), last_webhook_at: iso(lastCallWebhookAt) };
  if (!confirmation && !known) {
    return { state: "unknown", last_updated_at: null, known_complete_through: null, age_seconds: null, reason: row?.last_error_code ?? "no_capture_state", ...diagnostics };
  }
  const failed: CallsFreshnessReason | null = staleAt(now, confirmation, timing.capture_freshness_tolerance_ms)
    ? "confirmation_stale"
    : staleAt(now, coverage, timing.today_coverage_tolerance_ms + timing.call_settlement_allowance_ms)
      ? "coverage_behind"
      : inWindow && staleAt(now, lastCallWebhookAt, timing.webhook_silence_ms)
        ? "webhook_silent"
        : null;
  return {
    state: failed ? "delayed" : "fresh",
    last_updated_at: iso(lastUpdated),
    known_complete_through: iso(known),
    age_seconds: ageSeconds(now, lastUpdated),
    reason: failed ? (row?.last_error_code ?? failed) : null,
    ...diagnostics,
  };
}

/**
 * Header freshness {calls, sms, granot} (SPECIFICATION §16, RINGCENTRAL-CAPTURE §8).
 *
 * - calls: `callsFreshness` (Call Log confirmation, capture coverage, the call webhook stream).
 * - sms: "not connected" while `controls.rep_sms_capture_enabled` is false; otherwise the worst
 *   reviewed mailbox (`rep_sms:<extension>` rows), unknown when no mailbox has synced.
 * - granot: the newest captured observation (event-driven, so no staleness threshold is implied).
 * Thresholds come from `deskTimingOf(configuration)`.
 */
export function composeFreshness(input: {
  now: Date;
  timing: DeskTiming;
  calls: CaptureSyncRow | null;
  /** Newest call webhook receipt (`ringcentral_webhook_events` with a telephony session id). */
  last_call_webhook_at: Date | null;
  sms_capture_enabled: boolean;
  sms_mailboxes: readonly CaptureSyncRow[];
  granot_last_observed_at: Date | null;
}): SalesOutreachFreshness {
  const { now, timing } = input;
  let sms: SalesOutreachFreshness["sms"];
  if (!input.sms_capture_enabled) {
    sms = {
      state: "not_connected",
      last_updated_at: null,
      known_complete_through: null,
      age_seconds: null,
      reason: "rep_sms_capture_disabled",
      last_confirmation_at: null,
      last_webhook_at: null,
    };
  } else if (!input.sms_mailboxes.length) {
    sms = smsFreshness(now, null, null, "no_mailbox_synced", timing);
  } else {
    // Worst mailbox: any mailbox without coverage makes the whole channel unknown.
    const missing = input.sms_mailboxes.some((row) => !row.known_complete_through);
    const worst = missing
      ? null
      : input.sms_mailboxes.reduce<Date>(
          (min, row) => (row.known_complete_through! < min ? row.known_complete_through! : min),
          input.sms_mailboxes[0]!.known_complete_through!,
        );
    const lastUpdated = input.sms_mailboxes.reduce<Date | null>(
      (min, row) => (row.last_finished_at && (!min || row.last_finished_at < min) ? row.last_finished_at : min),
      null,
    );
    sms = smsFreshness(now, worst, lastUpdated, missing ? "mailbox_without_coverage" : null, timing);
  }
  return {
    calls: callsFreshness(now, input.calls, input.last_call_webhook_at, timing),
    sms,
    granot: {
      state: input.granot_last_observed_at ? "observed" : "unknown",
      last_observed_at: iso(input.granot_last_observed_at),
      age_seconds: ageSeconds(now, input.granot_last_observed_at),
    },
  };
}

/**
 * The instant a business day's call count needs capture coverage through: the end of a past day, or
 * `now − today_coverage_tolerance` for today (olr C0; `evidence.today_coverage_tolerance_minutes`,
 * default 25 = the 15-minute Call Log finalization lag + the 5-minute reconcile cadence + the 2-minute
 * settlement allowance + 3 minutes of runtime), so a Call Log at its normal lag still counts as current.
 */
export function requiredCoverageThrough(
  businessDay: string,
  today: string,
  now: Date,
  timing: Pick<DeskTiming, "today_coverage_tolerance_ms">,
): Date {
  if (businessDay < today) return newYorkDayBounds(businessDay).end;
  return new Date(now.getTime() - timing.today_coverage_tolerance_ms);
}

/** Calls coverage for one business day from the Call Log reconcile watermark. */
export function callsCoverageForDay(knownCompleteThrough: Date | null, requiredThrough: Date): SalesOutreachCoverage {
  if (!knownCompleteThrough) {
    return { state: "unknown", known_complete_through: null, required_through: requiredThrough.toISOString(), gaps: [{ from: null, to: requiredThrough.toISOString() }] };
  }
  const complete = knownCompleteThrough.getTime() >= requiredThrough.getTime();
  return {
    state: complete ? "complete" : "partial",
    known_complete_through: knownCompleteThrough.toISOString(),
    required_through: requiredThrough.toISOString(),
    gaps: complete ? [] : [{ from: knownCompleteThrough.toISOString(), to: requiredThrough.toISOString() }],
  };
}

const COVERAGE_RANK = { complete: 2, partial: 1, unknown: 0 } as const;

/**
 * Reads the `coverage` JSON a rep-day row carries (written by the rep-day projection) and returns the
 * worse of it and the capture coverage. An unrecognized row coverage counts as unknown.
 */
export function mergeRowCoverage(rowCoverage: unknown, capture: SalesOutreachCoverage): SalesOutreachCoverage {
  if (rowCoverage === null || rowCoverage === undefined) return capture;
  const row = rowCoverage as { state?: unknown; known_complete_through?: unknown; gaps?: unknown };
  const state = typeof row.state === "string" && row.state in COVERAGE_RANK ? (row.state as keyof typeof COVERAGE_RANK) : "unknown";
  if (COVERAGE_RANK[state] >= COVERAGE_RANK[capture.state]) return capture;
  const through = typeof row.known_complete_through === "string" && !Number.isNaN(Date.parse(row.known_complete_through))
    ? new Date(row.known_complete_through).toISOString()
    : null;
  return {
    state,
    known_complete_through: through,
    required_through: capture.required_through,
    gaps: state === "complete" ? [] : [{ from: through, to: capture.required_through }],
  };
}
