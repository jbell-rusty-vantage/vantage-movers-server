import { createHash } from "node:crypto";
import type { ClientSession, Connection } from "mongoose";
import { AppError } from "../errors/AppError";
import { ERROR_CODES } from "../errors/errorCodes";
import {
  BOOKING_JOB_NUMBER_REJECTION_MESSAGES,
  BOOKING_JOB_NUMBER_RULE_VERSION,
  classifyBookingJobNumber,
  type BookingJobNumberRejection,
} from "./bookingJobNumber";

/**
 * Runtime switch for Booking Job Number validation (Mongo, never an env var).
 * `booking_job_number_control` `{ _id: "validation", mode }`. A missing document or any other
 * value is `shadow`, so a production false negative is impossible until the Owner flips it.
 */
export const BOOKING_JOB_NUMBER_CONTROL_COLLECTION = "booking_job_number_control";
export const BOOKING_JOB_NUMBER_CONTROL_ID = "validation";
/** One document per Booking and rejected value: `${booking_id}:${sha256(raw)}`. */
export const BOOKING_JOB_NUMBER_CHECKS_COLLECTION = "booking_job_number_checks";

export type BookingJobNumberMode = "shadow" | "enforce";
export type BookingJobNumberWritePath =
  | "create_lead_booking"
  | "create_leadless_booking"
  | "create_referral_booking"
  | "create_employee_booking"
  | "update_booking"
  | "update_query";

export class BookingJobNumberError extends AppError {
  readonly reason: BookingJobNumberRejection;
  constructor(reason: BookingJobNumberRejection, metadata: Record<string, unknown> = {}) {
    super(`Invalid Job Number: ${BOOKING_JOB_NUMBER_REJECTION_MESSAGES[reason]}`, {
      code: ERROR_CODES.BOOKING_JOB_NUMBER_INVALID,
      statusCode: 422,
      metadata: { reason, rule_version: BOOKING_JOB_NUMBER_RULE_VERSION, ...metadata },
    });
    this.reason = reason;
  }
}

export function isBookingJobNumberError(error: unknown): error is BookingJobNumberError {
  return error instanceof BookingJobNumberError;
}

export async function readBookingJobNumberMode(
  connection: Connection,
  session?: ClientSession | null,
): Promise<BookingJobNumberMode> {
  // Without a live connection nothing can be recorded or enforced from configuration; the safe
  // default is shadow (unit tests that only call `validate()` land here).
  if (connection.readyState !== 1 || !connection.db) return "shadow";
  const row = await connection.db
    .collection<{ _id: string; mode?: unknown }>(BOOKING_JOB_NUMBER_CONTROL_COLLECTION)
    .findOne({ _id: BOOKING_JOB_NUMBER_CONTROL_ID }, { session: session ?? undefined });
  return row?.mode === "enforce" ? "enforce" : "shadow";
}

/**
 * Checks one Booking Job Number write. Valid values return immediately without I/O. An invalid
 * value throws a 422 `BookingJobNumberError` in `enforce`; in `shadow` it records a would-reject
 * (inside the caller's transaction when there is one, so aborted writes leave no record) and the
 * write continues. Raw text is never stored: only its SHA-256, the reason and the write path.
 */
export async function checkBookingJobNumber(input: {
  connection: Connection;
  session?: ClientSession | null;
  booking_id?: unknown;
  job_no: unknown;
  write_path: BookingJobNumberWritePath;
  now?: Date;
}): Promise<{ mode: BookingJobNumberMode | null; reason: BookingJobNumberRejection | null }> {
  const verdict = classifyBookingJobNumber(input.job_no);
  if (verdict.valid) return { mode: null, reason: null };
  const mode = await readBookingJobNumberMode(input.connection, input.session);
  const bookingId = input.booking_id == null ? null : String(input.booking_id);
  if (mode === "enforce") {
    throw new BookingJobNumberError(verdict.reason, { write_path: input.write_path, booking_id: bookingId });
  }
  if (input.connection.readyState === 1 && input.connection.db) {
    const valueHash = createHash("sha256").update(String(input.job_no ?? "")).digest("hex");
    const now = input.now ?? new Date();
    await input.connection.db.collection<{ _id: string }>(BOOKING_JOB_NUMBER_CHECKS_COLLECTION).updateOne(
      { _id: `${bookingId ?? "unknown"}:${valueHash}` },
      {
        $setOnInsert: { first_seen_at: now, booking_id: bookingId, value_sha256: valueHash },
        $set: {
          last_seen_at: now,
          verdict: "would_reject",
          mode,
          reason: verdict.reason,
          write_path: input.write_path,
          rule_version: BOOKING_JOB_NUMBER_RULE_VERSION,
        },
      },
      { upsert: true, session: input.session ?? undefined },
    );
  }
  return { mode, reason: verdict.reason };
}
