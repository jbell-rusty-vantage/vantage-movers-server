import { normalizeJobNo } from "./bookingIdentity";

/**
 * Booking Job Number rule (Owner, 2026-11-20): every Booking must carry a valid Job Number, and a
 * valid Job Number is never rejected. The rule therefore accepts every class seen in production
 * Bookings, Leads, Record Links and Granot evidence, plus the separator, case and whitespace
 * variants that normalize to one of them, and rejects only values that cannot be a Job Number.
 *
 * On the canonical normalized form (`normalizeJobNo`: NFKC, punctuation to spaces, uppercase):
 * - exactly one token contains a number, and it is an ASCII letter prefix (possibly empty) followed
 *   by 4 to 9 ASCII digits (the digit core);
 * - a bare digit token may be preceded by a letters-only token (a separated prefix, `P-5556759`);
 * - every other token is letters only (Granot annotations such as `NEW`, `VIP`, `RIGOS`).
 *
 * Rejected: a missing value, no number at all (a customer name), two or more numbers
 * (`EJBA03-LL-20260908-A`), a token mixing digits with trailing letters (`4B`), and a digit core
 * shorter than 4 or longer than 9 digits (a 10-digit value is a phone number, not a Granot Job).
 */
export const BOOKING_JOB_NUMBER_RULE_VERSION = "booking-job-number-v1";
export const BOOKING_JOB_DIGIT_CORE_MIN = 4;
export const BOOKING_JOB_DIGIT_CORE_MAX = 9;

export type BookingJobNumberClass =
  /** `5556759` */
  | "digits"
  /** `P5556759`, `RF5555499`, `AT5564415` */
  | "prefixed"
  /** `P 5556759`, from `P-5556759` or `P 5556759` */
  | "separated_prefix"
  /** `P5556759 NEW`, `P5556759 VIP RIGOS` */
  | "annotated";

export type BookingJobNumberRejection =
  | "missing"
  | "no_digits"
  | "multiple_numbers"
  | "mixed_token"
  | "digit_core_length";

export type BookingJobNumberVerdict =
  | {
      valid: true;
      normalized: string;
      job_class: BookingJobNumberClass;
      /** Digit core shared by every equivalent spelling (`5556759`). */
      core: string;
      /** Raw text differed from its normalized form (case, whitespace, punctuation, width). */
      normalized_input: boolean;
    }
  | { valid: false; normalized?: string; reason: BookingJobNumberRejection };

const NUMERIC = /\p{N}/u;
const CORE_TOKEN = /^([A-Z]*)([0-9]+)$/;
const LETTERS = /^[A-Z]+$/;

export const BOOKING_JOB_NUMBER_REJECTION_MESSAGES: Record<BookingJobNumberRejection, string> = {
  missing: "A Booking requires a Job Number.",
  no_digits: "The Job Number contains no number; it looks like free text such as a name.",
  multiple_numbers: "The Job Number contains more than one number; enter only the Granot Job Number.",
  mixed_token: "The Job Number must be an optional letter prefix followed by digits (for example P5556759).",
  digit_core_length: `The Job Number must have ${BOOKING_JOB_DIGIT_CORE_MIN} to ${BOOKING_JOB_DIGIT_CORE_MAX} digits.`,
};

type ParsedJobNumber =
  | { ok: true; job_class: BookingJobNumberClass; core: string }
  | { ok: false; reason: Exclude<BookingJobNumberRejection, "missing" | "digit_core_length"> };

/** Structure only (no digit-count bound): one prefixed digit token, every other token letters. */
function parseJobNumber(normalized: string): ParsedJobNumber {
  const tokens = normalized.split(" ");
  const numeric = tokens.flatMap((token, index) => (NUMERIC.test(token) ? [index] : []));
  if (!numeric.length) return { ok: false, reason: "no_digits" };
  if (numeric.length > 1) return { ok: false, reason: "multiple_numbers" };
  const index = numeric[0]!;
  const match = CORE_TOKEN.exec(tokens[index]!);
  if (!match) return { ok: false, reason: "mixed_token" };
  const [, prefix, core] = match as unknown as [string, string, string];
  const separatedPrefix = !prefix && index > 0 && LETTERS.test(tokens[index - 1]!);
  const words = tokens.length - 1 - (separatedPrefix ? 1 : 0);
  const job_class: BookingJobNumberClass = words > 0
    ? "annotated"
    : separatedPrefix ? "separated_prefix" : prefix ? "prefixed" : "digits";
  return { ok: true, job_class, core };
}

export function classifyBookingJobNumber(raw: unknown): BookingJobNumberVerdict {
  if (typeof raw !== "string") return { valid: false, reason: "missing" };
  const normalized = normalizeJobNo(raw);
  if (!normalized) return { valid: false, reason: "missing" };
  const parsed = parseJobNumber(normalized);
  if (!parsed.ok) return { valid: false, normalized, reason: parsed.reason };
  if (parsed.core.length < BOOKING_JOB_DIGIT_CORE_MIN || parsed.core.length > BOOKING_JOB_DIGIT_CORE_MAX) {
    return { valid: false, normalized, reason: "digit_core_length" };
  }
  return { valid: true, normalized, job_class: parsed.job_class, core: parsed.core, normalized_input: raw !== normalized };
}

/**
 * Digit core of an already-normalized Job Number, by structure only. Matching never applies the
 * write-time digit-count bound, so an equivalence that held before the rule still holds.
 */
export function bookingJobNumberCore(normalized?: string | null): string | undefined {
  if (!normalized) return undefined;
  const parsed = parseJobNumber(normalized);
  return parsed.ok ? parsed.core : undefined;
}

/** Equal normalized text, or two valid Job Numbers with the same digit core. */
export function bookingJobNumbersEquivalent(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftCore = bookingJobNumberCore(left);
  return Boolean(leftCore && leftCore === bookingJobNumberCore(right));
}

/** Identity key shared by every spelling of one Job Number (`core:5556759`). */
export function bookingJobNumberKey(normalized: string): string {
  const core = bookingJobNumberCore(normalized);
  return core ? `core:${core}` : `job:${normalized}`;
}

/**
 * Booked Lead read for a batch of normalized Lead Job Numbers. Exact keys are point lookups on the
 * partial normalized index; the digit-core regex walks the same index keys (never the collection) and finds
 * every valid spelling of the cores, including separated prefixes and Granot annotations.
 * The caller re-checks each row with `bookingJobNumbersEquivalent`.
 */
export function bookingJobNumberFilter(jobs: readonly string[]): Record<string, unknown> {
  const cores = [...new Set(jobs.flatMap((job) => bookingJobNumberCore(job) ?? []))];
  // `$type: "string"` restates the index's partial filter so the planner may use
  // `booked_leads.normalized_job_no_1`; without it both clauses fall back to a collection scan.
  const exact = { normalized_job_no: { $type: "string", $in: [...new Set([...jobs, ...cores])] } };
  if (!cores.length) return exact;
  return {
    $or: [
      exact,
      {
        normalized_job_no: {
          $type: "string",
          $regex: `^(?:[^ ]+ )*[A-Z]*(?:${cores.join("|")})(?: [^ ]+)*$`,
        },
      },
    ],
  };
}
