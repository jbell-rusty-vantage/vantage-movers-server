import type { z } from "zod";
import type { salesOutreachCoverageSchema, salesOutreachFreshnessSchema } from "../../../validation/v1/salesOutreachReads";
import { ISYNC_LANE_END_MINUTE, ISYNC_LANE_START_MINUTE, ISYNC_LANE_TIMEZONE } from "../../numberActivity/callLogIsyncLane";
import type { DeskTiming } from "../config/timing";
import { businessDateOf, localInstant, minuteOfDay } from "../engine/calendar";
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
  /**
   * SMS only (olr C7): the mailbox's `rep_sms_pending` counters (pending SMS events of the last 7 days) and
   * its reviewed rep when they were computed; absent/null before the first refresh wrote them.
   */
  sms_pending?: Readonly<{ identity: number; association: number; agent_id: string | null }> | null;
}>;

/** `freshness.sms.pending` window (olr C7; `contacts/smsPending.ts` SMS_PENDING_WINDOW_DAYS). */
export const SMS_PENDING_WINDOW_DAYS = 7 as const;
/** At most this many mailboxes are listed (the DTO bound). */
const SMS_PENDING_MAILBOXES_MAX = 100;

/**
 * olr C7: pending SMS evidence summed over the mailboxes, with the mailboxes that have any (by extension).
 * Null until at least one mailbox row carries counters.
 */
export function smsPendingOf(mailboxes: readonly CaptureSyncRow[]): SalesOutreachFreshness["sms"]["pending"] {
  const counted = mailboxes.filter((row) => row.sms_pending);
  if (!counted.length) return null;
  const extension = (row: CaptureSyncRow) => (row.scope.startsWith("rep_sms:") ? row.scope.slice("rep_sms:".length) : row.scope);
  return {
    identity: counted.reduce((n, row) => n + row.sms_pending!.identity, 0),
    association: counted.reduce((n, row) => n + row.sms_pending!.association, 0),
    window_days: SMS_PENDING_WINDOW_DAYS,
    mailboxes: counted
      .filter((row) => row.sms_pending!.identity + row.sms_pending!.association > 0)
      .map((row) => ({
        extension_id: extension(row),
        agent_id: row.sms_pending!.agent_id,
        identity: row.sms_pending!.identity,
        association: row.sms_pending!.association,
      }))
      .sort((a, b) => a.extension_id.localeCompare(b.extension_id))
      .slice(0, SMS_PENDING_MAILBOXES_MAX),
  };
}

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

/**
 * The instant today's staffed capture window opened (07:45 New York on `now`'s local date) while `now` is
 * inside the window; null outside it. DST-safe through the engine calendar.
 */
export function staffedCaptureWindowStart(now: Date): Date | null {
  if (!inStaffedCaptureWindow(now)) return null;
  const today = businessDateOf(now.getTime(), ISYNC_LANE_TIMEZONE);
  return new Date(localInstant(today, ISYNC_LANE_START_MINUTE, ISYNC_LANE_TIMEZONE));
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
    pending: null,
  };
}

/**
 * Calls freshness (RINGCENTRAL-CAPTURE §8, outreach lifecycle repair A3-fresh).
 * - Confirmation instant: the later of the ISync lane success and the reconcile's sync success. Outside
 *   the staffed window only the reconcile confirms calls, so the lane alone would read delayed every night.
 * - Today's call webhook stream: the newest call webhook receipt when it arrived inside the current
 *   staffed window (at or after today's 07:45 New York). A receipt from before the window opened (last
 *   night's last call) says nothing about today's stream, so it is ignored like the webhook outside the window.
 * - "Calls updated" (`last_updated_at`, `age_seconds`): min(confirmation, today's newest call webhook)
 *   inside the staffed window; the confirmation alone outside it and before the day's first call webhook.
 * - `fresh` needs all three: a confirmation within `capture_freshness_tolerance`; capture coverage within
 *   `today_coverage_tolerance + settlement allowance` (coverage behind never reads green, SPECIFICATION
 *   §16); and, once today's stream has started, its newest receipt within `webhook_silence`. Before the
 *   day's first call webhook there is no stream to fall silent, so the morning (07:45 until the first call)
 *   never reads `webhook_silent`; a missing or broken subscription is the subscription health check's to
 *   report. Otherwise it is `delayed`, and the reason is the first that applies of: the reconcile's
 *   `last_error_code`, `confirmation_stale`, `coverage_behind`, `webhook_silent`.
 * - `unknown`: neither a confirmation nor a watermark yet.
 * Coverage reads max(observed, known) — the observed watermark has no provisional-row cap — so a stuck
 * provisional Call Log row does not make capture look stale (D-A3, extended from goal coverage to header
 * freshness). `known_complete_through` is still served as the capped watermark.
 */
function callsFreshness(now: Date, row: CaptureSyncRow | null, lastCallWebhookAt: Date | null, timing: DeskTiming): SalesOutreachFreshness["calls"] {
  const known = row?.known_complete_through ?? null;
  const confirmation = row?.confirmation_success_at ?? null;
  const coverage = laterOf(row?.observed_complete_through ?? null, known);
  const windowStart = staffedCaptureWindowStart(now);
  const webhookToday =
    windowStart && lastCallWebhookAt && lastCallWebhookAt.getTime() >= windowStart.getTime() ? lastCallWebhookAt : null;
  const lastUpdated = webhookToday && confirmation ? earlierOf(confirmation, webhookToday) : confirmation;
  const diagnostics = { last_confirmation_at: iso(confirmation), last_webhook_at: iso(lastCallWebhookAt) };
  if (!confirmation && !known) {
    return { state: "unknown", last_updated_at: null, known_complete_through: null, age_seconds: null, reason: row?.last_error_code ?? "no_capture_state", ...diagnostics };
  }
  const failed: CallsFreshnessReason | null = staleAt(now, confirmation, timing.capture_freshness_tolerance_ms)
    ? "confirmation_stale"
    : staleAt(now, coverage, timing.today_coverage_tolerance_ms + timing.call_settlement_allowance_ms)
      ? "coverage_behind"
      : webhookToday && staleAt(now, webhookToday, timing.webhook_silence_ms)
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
 *   reviewed mailbox (`rep_sms:<extension>` rows), unknown when no mailbox has synced. `pending` (olr C7)
 *   sums the mailboxes' pending SMS counters; null while capture is off or before the first refresh.
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
      pending: null,
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
    sms = { ...smsFreshness(now, worst, lastUpdated, missing ? "mailbox_without_coverage" : null, timing), pending: smsPendingOf(input.sms_mailboxes) };
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
