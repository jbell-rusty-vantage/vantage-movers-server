import type { z } from "zod";
import type { salesOutreachCoverageSchema, salesOutreachFreshnessSchema } from "../../../validation/v1/salesOutreachReads";
import { newYorkDayBounds } from "./businessDay";

export type SalesOutreachFreshness = z.infer<typeof salesOutreachFreshnessSchema>;
export type SalesOutreachCoverage = z.infer<typeof salesOutreachCoverageSchema>;

/**
 * Capture coverage counts as current while it trails the reference instant by at most this much.
 * Engineering freshness threshold, not business policy: it matches the 10-minute "last good sync"
 * bound RINGCENTRAL-CAPTURE §8 uses for SMS, and covers the 5-minute Call Log reconcile cadence.
 */
export const CAPTURE_CURRENT_TOLERANCE_MS = 10 * 60_000;

/** One `sales_intelligence_sync_state` row as the desk reads it. */
export type CaptureSyncRow = Readonly<{
  scope: string;
  known_complete_through: Date | null;
  last_finished_at: Date | null;
  last_error_code: string | null;
}>;

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const ageSeconds = (now: Date, at: Date | null) => (at ? Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000)) : null);

function captureFreshness(now: Date, knownCompleteThrough: Date | null, lastUpdatedAt: Date | null, reason: string | null) {
  const state: SalesOutreachFreshness["calls"]["state"] = !knownCompleteThrough
    ? "unknown"
    : now.getTime() - knownCompleteThrough.getTime() <= CAPTURE_CURRENT_TOLERANCE_MS
      ? "fresh"
      : "delayed";
  return {
    state,
    last_updated_at: iso(lastUpdatedAt),
    known_complete_through: iso(knownCompleteThrough),
    age_seconds: ageSeconds(now, knownCompleteThrough),
    reason: state === "fresh" ? null : (reason ?? (state === "unknown" ? "no_capture_state" : "capture_behind")),
  };
}

/**
 * Header freshness {calls, sms, granot} (SPECIFICATION §16, RINGCENTRAL-CAPTURE §8).
 *
 * - calls: the account Call Log reconcile row (`call_log_all_directions`): fresh when it is known
 *   complete within the tolerance of `now`.
 * - sms: "not connected" while `controls.rep_sms_capture_enabled` is false; otherwise the worst
 *   reviewed mailbox (`rep_sms:<extension>` rows), unknown when no mailbox has synced.
 * - granot: the newest captured observation (event-driven, so no staleness threshold is implied).
 */
export function composeFreshness(input: {
  now: Date;
  calls: CaptureSyncRow | null;
  sms_capture_enabled: boolean;
  sms_mailboxes: readonly CaptureSyncRow[];
  granot_last_observed_at: Date | null;
}): SalesOutreachFreshness {
  const { now, calls } = input;
  let sms: SalesOutreachFreshness["sms"];
  if (!input.sms_capture_enabled) {
    sms = { state: "not_connected", last_updated_at: null, known_complete_through: null, age_seconds: null, reason: "rep_sms_capture_disabled" };
  } else if (!input.sms_mailboxes.length) {
    sms = captureFreshness(now, null, null, "no_mailbox_synced");
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
    sms = captureFreshness(now, worst, lastUpdated, missing ? "mailbox_without_coverage" : null);
  }
  return {
    calls: captureFreshness(now, calls?.known_complete_through ?? null, calls?.last_finished_at ?? null, calls?.last_error_code ?? null),
    sms,
    granot: {
      state: input.granot_last_observed_at ? "observed" : "unknown",
      last_observed_at: iso(input.granot_last_observed_at),
      age_seconds: ageSeconds(now, input.granot_last_observed_at),
    },
  };
}

/**
 * The instant a business day's call count needs capture coverage through: the end of a past day,
 * or `now − tolerance` for today (so a Call Log a few minutes behind still counts as current).
 */
export function requiredCoverageThrough(businessDay: string, today: string, now: Date): Date {
  if (businessDay < today) return newYorkDayBounds(businessDay).end;
  return new Date(now.getTime() - CAPTURE_CURRENT_TOLERANCE_MS);
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
