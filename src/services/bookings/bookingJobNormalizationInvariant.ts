import type { Db } from "mongodb";
import { logger } from "../../logger";
import { normalizeJobNo } from "./bookingIdentity";
import { BOOKING_JOB_NUMBER_CONTROL_COLLECTION } from "./bookingJobNumberGuard";

/**
 * Invariant behind Pool admission's index-only Booking read (2026-11-20): every Booking's
 * `normalized_job_no` equals `normalizeJobNo(job_no)`. A Booking that breaks it would hold its
 * Lead only through `lead_ref`, so the invariant is measured hourly and logged at error level
 * when it fails. Production had 0 such Bookings when the raw-Job scan was removed.
 *
 * Any change to `normalizeJobNo` must ship with a `normalized_job_no` backfill that runs before
 * the change deploys, or this invariant fails for every Booking whose key changes.
 */
export const BOOKING_JOB_NORMALIZATION_STATE_ID = "normalization_invariant";
const MIN_INTERVAL_MS = 55 * 60 * 1000;
const SAMPLE_IDS = 20;
/** The scan reads every Booking; bound it so a slow member fails the check instead of holding the cron. */
const DRIFT_SCAN_MAX_TIME_MS = 15_000;

export type BookingJobNormalizationState = {
  _id: typeof BOOKING_JOB_NORMALIZATION_STATE_ID;
  /** Last completed scan; absent until one completes. `drift_count`, `booking_ids` and `scanned_candidates` belong to it. */
  checked_at?: Date;
  drift_count?: number;
  booking_ids?: string[];
  scanned_candidates?: number;
  /** Last attempt, completed or failed. The hourly throttle reads this, so a scan that times out is not retried every 5 minutes. */
  last_attempt_at?: Date;
  /** Error message of the last attempt, or null when it completed. */
  last_failure?: string | null;
};

type BookingKeys = { _id: unknown; job_no?: unknown; normalized_job_no?: unknown };

/** Bookings whose stored key is missing, not a string, or not the canonical normalization of `job_no`. */
export async function findBookingJobNormalizationDrift(db: Db): Promise<{ drift: string[]; scanned: number }> {
  // Candidates are rows the database can see may disagree; equal raw and normalized text is already
  // canonical for the ASCII uppercase alphanumerics normalizeJobNo produces. JavaScript decides the rest.
  const candidates = await db.collection<BookingKeys>("booked_leads").find({ $or: [
    { job_no: { $type: "string" }, normalized_job_no: { $not: { $type: "string" } } },
    { job_no: { $not: { $type: "string" } }, normalized_job_no: { $exists: true, $ne: null } },
    { job_no: { $type: "string" }, $expr: { $ne: ["$job_no", "$normalized_job_no"] } },
  ] }, { projection: { job_no: 1, normalized_job_no: 1 }, maxTimeMS: DRIFT_SCAN_MAX_TIME_MS }).toArray();
  const drift = candidates.filter((row) => {
    const expected = typeof row.job_no === "string" ? normalizeJobNo(row.job_no) ?? null : null;
    const stored = row.normalized_job_no ?? null;
    return stored !== expected;
  }).map((row) => String(row._id));
  return { drift, scanned: candidates.length };
}

/** Runs at most once per `MIN_INTERVAL_MS` from a frequent cron; stores the last result for `status`. */
export async function runBookingJobNormalizationInvariant(db: Db, now = new Date()): Promise<
  { skipped: true } | { skipped: false; drift_count: number }
> {
  const state = db.collection<BookingJobNormalizationState>(BOOKING_JOB_NUMBER_CONTROL_COLLECTION);
  const last = await state.findOne({ _id: BOOKING_JOB_NORMALIZATION_STATE_ID });
  const lastAttempt = last?.last_attempt_at ?? last?.checked_at;
  if (lastAttempt && now.getTime() - lastAttempt.getTime() < MIN_INTERVAL_MS) return { skipped: true };
  let result: { drift: string[]; scanned: number };
  try {
    result = await findBookingJobNormalizationDrift(db);
  } catch (error) {
    // Keep the last completed result for `status`; record the attempt so the throttle still holds.
    await state.updateOne(
      { _id: BOOKING_JOB_NORMALIZATION_STATE_ID },
      { $set: { last_attempt_at: now, last_failure: error instanceof Error ? error.message : String(error) } },
      { upsert: true },
    );
    throw error;
  }
  const { drift, scanned } = result;
  await state.updateOne(
    { _id: BOOKING_JOB_NORMALIZATION_STATE_ID },
    { $set: {
      checked_at: now,
      last_attempt_at: now,
      last_failure: null,
      drift_count: drift.length,
      booking_ids: drift.slice(0, SAMPLE_IDS),
      scanned_candidates: scanned,
    } },
    { upsert: true },
  );
  if (drift.length > 0) {
    logger.error({
      msg: "booking.job_number.normalization_drift",
      workflow: "booking_job_number",
      drift_count: drift.length,
      booking_ids: drift.slice(0, SAMPLE_IDS),
    }, "Bookings whose normalized_job_no disagrees with job_no are held from Pool only by lead_ref");
  }
  return { skipped: false, drift_count: drift.length };
}
