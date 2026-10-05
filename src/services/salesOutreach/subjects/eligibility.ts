import type { DeskLeadFacts } from "./leadFacts";

/**
 * P05h new-desk eligibility seam (CONTRACTS "Approved Lead eligibility — P05h"). Written fresh: the
 * legacy `officialClosure` treated `no_sync` as a closure and cannot be reused (IMPLEMENTATION-PLAN §1).
 *
 * - Bad Lead, official Booking and official Cancellation are authoritative closures, never reopened.
 *   (Priority 5/7/8 closures come from the accepted priority map, P05d, not from here.)
 * - A Duplicate Lead gets no separate cadence: its contact belongs to the original opportunity only
 *   through a verified number association (lane S3), never through a desk subject of its own.
 * - An unmatched Call Lead created only to anchor a Booking has no automatic cadence.
 * - No-Sync is reporting scope, not a desk closure: a viable No-Sync Lead stays eligible.
 * - Form Fill alone neither excludes a Call Lead nor merges it with another Lead (it is not read).
 * - A Lead already closed by a legacy record needs review and an authorized reopening; the desk never
 *   reopens it silently. (The legacy Outreach records were purged by the slimming, so the loader never
 *   sets `legacy_closed` today; the seam keeps the approved behaviour for any such record.)
 * - A number-only record (a Contact Number with no verified eligible Lead) is history/review: no
 *   subject, no guessed cadence, no goal credit.
 */
export type DeskEligibility =
  | Readonly<{ outcome: "eligible" }>
  | Readonly<{ outcome: "closed"; reason: DeskClosureReason }>
  | Readonly<{ outcome: "excluded"; reason: "duplicate" | "unmatched_booking_anchor" }>
  | Readonly<{ outcome: "review"; reason: "legacy_closed_reopening_required" | "number_only_unassociated" }>;

export type DeskClosureReason = "official_booking" | "official_cancellation" | "bad_lead";

export type DeskEligibilityRecord =
  | Readonly<{ kind: "lead"; facts: DeskLeadFacts; legacy_closed?: boolean }>
  | Readonly<{ kind: "number_only" }>;

export function evaluateDeskEligibility(record: DeskEligibilityRecord): DeskEligibility {
  if (record.kind === "number_only") return { outcome: "review", reason: "number_only_unassociated" };
  const { facts } = record;
  // Authoritative closures first (P06f: closure precedes everything).
  if (facts.booked_id) return { outcome: "closed", reason: "official_booking" };
  if (facts.cancelled_id) return { outcome: "closed", reason: "official_cancellation" };
  if (facts.bad_lead) return { outcome: "closed", reason: "bad_lead" };
  if (facts.duplicate) return { outcome: "excluded", reason: "duplicate" };
  if (facts.ref.model === "CallLead" && facts.created_on_unmatched) return { outcome: "excluded", reason: "unmatched_booking_anchor" };
  if (record.legacy_closed) return { outcome: "review", reason: "legacy_closed_reopening_required" };
  // `no_sync` and `form_fill` are deliberately not read.
  return { outcome: "eligible" };
}
