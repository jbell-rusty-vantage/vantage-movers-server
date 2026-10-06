import type { ClientSession } from "mongoose";
import { repSmsSyncScope } from "../../../config/domain/ringcentralRepSms";
import { OUTREACH_CONTACT_CALLS_SCOPE } from "../../../config/domain/salesOutreachContacts";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../numberActivity/reconcileCallLog";
import { listReviewedRepMailboxes } from "../../ringcentral/repSms/mailboxes";
import type { DeskTiming } from "../config/timing";

/**
 * Evidence coverage — the one place the desk turns capture and derivation watermarks into "activity is
 * known through T" (outreach lifecycle repair A3, RINGCENTRAL-CAPTURE §8). Shared by the evaluation,
 * the evaluate sweep, the reads and rep-days; pure apart from `loadCallWatermarks`.
 *
 * Two call coverages, deliberately different (decision D-A3):
 * - **cadence** (verdicts that can establish a miss): the provisional-capped capture watermark minus the
 *   settlement allowance, never past what the contact-event sweep has derived. A stuck provisional Call
 *   Log row holds it back, so a miss is never recorded on a range that might still change.
 * - **goal** (counting today's calls): the same, but from the *observed* watermarks, which keep the
 *   15-minute finalization lag and the ISync-time cap and drop only the provisional-row cap. A provisional
 *   terminal call is already counted as confirmed and a provisional non-terminal one as awaiting, so a
 *   provisional row does not make the count's coverage incomplete. Before the first reconcile/sweep that
 *   writes the observed fields, goal coverage falls back to the capped ones.
 *
 * Settlement is never shortened here (SPECIFICATION §15.1): the allowance comes from `deskTimingOf`.
 */

export type CallWatermarks = Readonly<{
  /** `call_log_all_directions.known_complete_through` (provisional-capped). */
  capture_known: Date | null;
  /** `call_log_all_directions.observed_complete_through` (no provisional cap; null until the first A3 reconcile run). */
  capture_observed: Date | null;
  /** `outreach_contact_calls.known_complete_through` (derivation watermark). */
  derived_known: Date | null;
  /** `outreach_contact_calls.observed_complete_through` (null until the first A3 sweep that catches up). */
  derived_observed: Date | null;
  /** `outreach_contact_calls.cursor.outreach_coverage_from` — first instant the derived evidence covers. */
  coverage_from: Date | null;
}>;

export type ChannelCoverage = Readonly<{ call: Date | null; sms: Date | null }>;

export const NO_CALL_WATERMARKS: CallWatermarks = Object.freeze({
  capture_known: null,
  capture_observed: null,
  derived_known: null,
  derived_observed: null,
  coverage_from: null,
});

type WatermarkRow = {
  scope?: string;
  known_complete_through?: Date | null;
  observed_complete_through?: Date | null;
  cursor?: { outreach_coverage_from?: Date | null } | null;
};

/** Pure: the two sync-state rows (any order, either missing) as `CallWatermarks`. */
export function callWatermarksOf(rows: ReadonlyArray<WatermarkRow>): CallWatermarks {
  const capture = rows.find((row) => row.scope === CALL_LOG_ALL_DIRECTIONS_SCOPE);
  const derived = rows.find((row) => row.scope === OUTREACH_CONTACT_CALLS_SCOPE);
  return {
    capture_known: capture?.known_complete_through ?? null,
    capture_observed: capture?.observed_complete_through ?? null,
    derived_known: derived?.known_complete_through ?? null,
    derived_observed: derived?.observed_complete_through ?? null,
    coverage_from: derived?.cursor?.outreach_coverage_from ?? null,
  };
}

/** One `find` over both call scopes (inside `session` when given). */
export async function loadCallWatermarks(session?: ClientSession): Promise<CallWatermarks> {
  const query = getSalesIntelligenceSyncStateModel().find(
    { scope: { $in: [CALL_LOG_ALL_DIRECTIONS_SCOPE, OUTREACH_CONTACT_CALLS_SCOPE] } },
    { scope: 1, known_complete_through: 1, observed_complete_through: 1, "cursor.outreach_coverage_from": 1 },
  );
  if (session) query.session(session);
  return callWatermarksOf((await query.lean()) as unknown as WatermarkRow[]);
}

const earlier = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
/** The later of two optional instants (an observed watermark is never read below its capped twin). */
const laterOf = (a: Date | null, b: Date | null) => (a && b ? (a.getTime() >= b.getTime() ? a : b) : (a ?? b));

function coverageOf(capture: Date | null, derived: Date | null, timing: DeskTiming): Date | null {
  if (!capture || !derived) return null;
  return earlier(new Date(capture.getTime() - timing.call_settlement_allowance_ms), derived);
}

/** Cadence verdicts: capped capture minus the allowance, never past what has been derived. Null if either is missing. */
export function cadenceCallCoverage(w: CallWatermarks, timing: DeskTiming): Date | null {
  return coverageOf(w.capture_known, w.derived_known, timing);
}

/**
 * Goal counting (D-A3): the observed (uncapped) watermarks minus the allowance, never past what has been
 * derived. Each observed watermark is read as max(observed, known): it falls back to the capped value
 * until it has been written once, so goal coverage is never behind cadence coverage.
 */
export function goalCallCoverage(w: CallWatermarks, timing: DeskTiming): Date | null {
  return coverageOf(laterOf(w.capture_observed, w.capture_known), laterOf(w.derived_observed, w.derived_known), timing);
}

/**
 * The rep mailbox sync rows SMS coverage is taken over (olr hotfix): only the *current* mailboxes — the
 * reviewed `sales_rep` mailboxes the SMS capture syncs at that instant (`listReviewedRepMailboxes`). A
 * mailbox whose link was retired or moved off `sales_rep` keeps its `rep_sms:<extension>` row, but it is
 * never synced again, so its frozen watermark must not hold coverage back. Pure; keeps input order. A
 * current mailbox without a row adds nothing (unchanged); one whose row has no watermark still makes the
 * coverage null (`smsCoverage`).
 */
export function currentSmsMailboxRows<R extends { scope?: string | null }>(rows: readonly R[], currentExtensionIds: Iterable<string>): R[] {
  const current = new Set([...currentExtensionIds].map(repSmsSyncScope));
  return rows.filter((row) => typeof row.scope === "string" && current.has(row.scope));
}

/** The extension ids of the current rep SMS mailboxes at `at` (inside `session` when given). */
export async function currentSmsMailboxIds(at: Date, session: ClientSession | null = null): Promise<string[]> {
  return (await listReviewedRepMailboxes(at, undefined, session)).map((mailbox) => mailbox.extension_id);
}

/**
 * Worst current mailbox `known_complete_through`; null when there is none or any mailbox has none. Callers
 * pass `currentSmsMailboxRows(...)`: the evaluation, the evaluate sweep and every desk read share this rule.
 */
export function smsCoverage(rows: ReadonlyArray<{ known_complete_through?: Date | null }>): Date | null {
  if (!rows.length) return null;
  let worst: Date | null = null;
  for (const row of rows) {
    const point = row.known_complete_through ?? null;
    if (!point) return null;
    if (!worst || point.getTime() < worst.getTime()) worst = point;
  }
  return worst;
}
