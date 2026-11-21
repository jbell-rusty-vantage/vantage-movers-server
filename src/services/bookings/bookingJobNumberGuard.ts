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
/**
 * One document per Booking, reason and value length: `${booking_id}:${reason}:${length}` for a
 * recorded-only write, with a `:rejected` suffix for a blocked one (written outside the caller's
 * transaction, so it must never share a key with an in-transaction record).
 */
export const BOOKING_JOB_NUMBER_CHECKS_COLLECTION = "booking_job_number_checks";

export type BookingJobNumberMode = "shadow" | "enforce";
export type BookingJobNumberWritePath =
  | "create_lead_booking"
  | "create_leadless_booking"
  | "create_referral_booking"
  | "create_employee_booking"
  | "update_booking"
  | "update_query";

/**
 * Who is writing the Booking, carried explicitly by the caller (never inferred from field values).
 * `granot_lifecycle` is the Granot Confirm (lead and Leadless) and Referral creation commands.
 */
export type BookingJobNumberWriteOrigin = "standard" | "granot_lifecycle";
/** Why an invalid value was allowed through in `enforce` mode. */
export type BookingJobNumberExemption = "reason_not_enforced" | "granot_lifecycle";

/** `$locals` key a Granot lifecycle site sets on a `BookedLead` document before `save`. */
export const BOOKING_JOB_NUMBER_ORIGIN_LOCAL = "jobNumberOrigin";

/** Marks a Booking document as written by the Granot lifecycle: its Job Number never blocks the write. */
export function markGranotLifecycleBookingWrite(doc: { $locals: Record<string, unknown> }): void {
  doc.$locals[BOOKING_JOB_NUMBER_ORIGIN_LOCAL] = "granot_lifecycle" satisfies BookingJobNumberWriteOrigin;
}

/** The write origin a document carries; anything unmarked or unknown is `standard`. */
export function bookingJobNumberWriteOrigin(locals: Record<string, unknown> | undefined): BookingJobNumberWriteOrigin {
  return locals?.[BOOKING_JOB_NUMBER_ORIGIN_LOCAL] === "granot_lifecycle" ? "granot_lifecycle" : "standard";
}

export type BookingJobNumberEnforcement =
  | { blocks: true; exemption: null }
  | { blocks: false; exemption: BookingJobNumberExemption | null };

/**
 * The one enforcement decision (Owner, 2026-11-21: "Don't make Granot records part of enforcement.
 * Minimal enforcement of having a job number."). Only `enforce` mode can block, and only a missing
 * or empty value (`missing`) from a non-Granot write. Every other case is recorded, never blocked:
 * - `shadow`: no exemption (nothing is enforced; the record is today's would-reject);
 * - `enforce` + Granot lifecycle origin: exempt by origin, for every reason including `missing`;
 * - `enforce` + any reason other than `missing`: exempt by reason.
 */
export function jobNumberEnforcement(
  mode: BookingJobNumberMode,
  reason: BookingJobNumberRejection,
  origin: BookingJobNumberWriteOrigin,
): BookingJobNumberEnforcement {
  if (mode !== "enforce") return { blocks: false, exemption: null };
  if (origin === "granot_lifecycle") return { blocks: false, exemption: "granot_lifecycle" };
  if (reason !== "missing") return { blocks: false, exemption: "reason_not_enforced" };
  return { blocks: true, exemption: null };
}

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

  /** HTTP body for every route: stable `code`, the public message and the reason as a `job_no` issue. */
  toHttpBody(requestId?: string | null) {
    return {
      ok: false as const,
      code: this.code,
      error: this.message,
      ...(requestId === undefined ? {} : { request_id: requestId }),
      issues: [{ path: "job_no", message: this.reason }],
    };
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
 * Checks one Booking Job Number write. Valid values return immediately without I/O. For an invalid
 * value, `jobNumberEnforcement` decides:
 * - recorded only (every `shadow` write; in `enforce`, every exempt write): a `would_reject` record
 *   is written inside the caller's transaction when there is one (so aborted writes leave no record)
 *   and the write continues. In `enforce` the record also carries `enforced: false` and `exemption`.
 * - blocked (`enforce`, `missing`, non-Granot): a `rejected` record with `enforced: true` is written
 *   outside the caller's transaction (the refusal aborts it), best effort, then a 422
 *   `BookingJobNumberError` is thrown.
 * The value is never stored, hashed or logged (a name is customer data and an unsalted hash of a
 * name is reversible by guessing): only its reason, length, the write path and the decision.
 */
export async function checkBookingJobNumber(input: {
  connection: Connection;
  session?: ClientSession | null;
  booking_id?: unknown;
  job_no: unknown;
  write_path: BookingJobNumberWritePath;
  write_origin?: BookingJobNumberWriteOrigin;
  now?: Date;
}): Promise<{
  mode: BookingJobNumberMode | null;
  reason: BookingJobNumberRejection | null;
  blocked: boolean;
  exemption: BookingJobNumberExemption | null;
}> {
  const verdict = classifyBookingJobNumber(input.job_no);
  if (verdict.valid) return { mode: null, reason: null, blocked: false, exemption: null };
  const mode = await readBookingJobNumberMode(input.connection, input.session);
  const bookingId = input.booking_id == null ? null : String(input.booking_id);
  const decision = jobNumberEnforcement(mode, verdict.reason, input.write_origin ?? "standard");
  const valueLength = typeof input.job_no === "string" ? input.job_no.length : 0;
  const now = input.now ?? new Date();
  const record = (session: ClientSession | undefined) => input.connection.db!
    .collection<{ _id: string }>(BOOKING_JOB_NUMBER_CHECKS_COLLECTION)
    .updateOne(
      { _id: `${bookingId ?? "unknown"}:${verdict.reason}:${valueLength}${decision.blocks ? ":rejected" : ""}` },
      {
        $setOnInsert: { first_seen_at: now, booking_id: bookingId, value_length: valueLength },
        $set: {
          last_seen_at: now,
          verdict: decision.blocks ? "rejected" : "would_reject",
          mode,
          reason: verdict.reason,
          write_path: input.write_path,
          rule_version: BOOKING_JOB_NUMBER_RULE_VERSION,
          // `shadow` records stay exactly as before 2026-11-21: no enforcement fields.
          ...(mode === "enforce" ? { enforced: decision.blocks, exemption: decision.exemption } : {}),
        },
        ...(mode === "enforce" ? {} : { $unset: { enforced: "", exemption: "" } }),
      },
      { upsert: true, session },
    );
  const connected = input.connection.readyState === 1 && Boolean(input.connection.db);
  if (decision.blocks) {
    // Never let the audit record mask the refusal.
    if (connected) await record(undefined).catch(() => undefined);
    throw new BookingJobNumberError(verdict.reason, { write_path: input.write_path, booking_id: bookingId });
  }
  if (connected) await record(input.session ?? undefined);
  return { mode, reason: verdict.reason, blocked: false, exemption: decision.exemption };
}
