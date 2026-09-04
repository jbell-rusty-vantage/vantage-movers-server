/**
 * Shared helpers for the lead browse services (form + call) backing the
 * extension Search workspace. These build loose, list-style Mongo filters
 * (full-text `q`, standalone `source_company`, booked/cancelled presence) and
 * compact booking / cancellation summaries from populated refs so result cards
 * can show attachment status without extra round trips.
 */

export type LeadBookingSummary = {
  _id: string;
  job_no?: string;
  book_date?: Date;
  cancelled?: string | null;
};

export type LeadCancellationSummary = {
  _id: string;
  cancel_date?: Date;
  reason?: string;
  job_no?: string;
};

/** Mongoose select projections used to populate the booking / cancellation refs. */
export const BOOKING_SUMMARY_SELECT = "job_no book_date cancelled";
export const CANCELLATION_SUMMARY_SELECT = "cancel_date reason job_no";

/**
 * Any-known-contact paths for Form Lead and Call Lead desk search. Admin
 * browse (including Manual attach filters), Admin typeahead, intake /
 * Connect `q`, extension browse, and Owner booking-lead reconciliation
 * candidate search share these lists so they cannot drift. Scored Form Lead
 * Search does not use them. Call Lead Search (`POST /call-leads/search`)
 * uses the Call aliases as an OR lookup, not Form-style scoring. Processor
 * identity and automatic booking match do not.
 */
export const FORM_LEAD_CONTACT_NAME_PATHS = [
  "name",
  "first_name",
  "last_name",
  "ingested_contact_snapshot.name",
  "ingested_contact_snapshot.first_name",
  "ingested_contact_snapshot.last_name",
  "granot_contact_snapshot.name",
  "granot_contact_snapshot.first_name",
  "granot_contact_snapshot.last_name",
] as const;

export const FORM_LEAD_CONTACT_EMAIL_PATHS = [
  "email",
  "ingested_contact_snapshot.email",
  "granot_contact_snapshot.email",
] as const;

export const FORM_LEAD_CONTACT_PHONE_PATHS = [
  "phone_number",
  "normalized_phone_number",
  "ingested_contact_snapshot.phone_number",
  "ingested_contact_snapshot.normalized_phone_number",
  "granot_contact_snapshot.phone_number",
  "granot_contact_snapshot.normalized_phone_number",
] as const;

export const CALL_LEAD_CONTACT_NAME_PATHS = FORM_LEAD_CONTACT_NAME_PATHS;
export const CALL_LEAD_CONTACT_EMAIL_PATHS = FORM_LEAD_CONTACT_EMAIL_PATHS;
export const CALL_LEAD_CONTACT_PHONE_PATHS = FORM_LEAD_CONTACT_PHONE_PATHS;

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeValue(value?: string | null): string | undefined {
  return value?.trim() || undefined;
}

/** Case-insensitive substring match for a single field. */
export function fieldContainsClause(
  field: string,
  value: string,
): Record<string, unknown> {
  return { [field]: new RegExp(escapeRegex(value), "i") };
}

/** Anchored case-insensitive exact match (used for `source_company`). */
export function fieldEqualsClause(
  field: string,
  value: string,
): Record<string, unknown> {
  return { [field]: new RegExp(`^${escapeRegex(value)}$`, "i") };
}

/** Loose full-text `$or` across the supplied fields. */
export function fullTextClause(
  fields: string[],
  value: string,
): Record<string, unknown> {
  const regex = new RegExp(escapeRegex(value), "i");
  return { $or: fields.map((field) => ({ [field]: regex })) };
}

/** Booking attachment presence filter (`true` = attached, `false` = not attached). */
export function attachmentClause(
  field: "booked" | "cancelled",
  present: boolean,
): Record<string, unknown> {
  return present
    ? { [field]: { $ne: null, $exists: true } }
    : { $or: [{ [field]: null }, { [field]: { $exists: false } }] };
}

/** Combines clauses into a single Mongo filter (`{}` when there are none). */
export function combineClauses(
  clauses: Record<string, unknown>[],
): Record<string, unknown> {
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

type PopulatedBooking = {
  _id: unknown;
  job_no?: string;
  book_date?: Date;
  cancelled?: unknown;
};

type PopulatedCancellation = {
  _id: unknown;
  cancel_date?: Date;
  reason?: string;
  job_no?: string;
};

export function toBookingSummary(value: unknown): LeadBookingSummary | null {
  if (!value || typeof value !== "object") return null;
  const booking = value as PopulatedBooking;
  if (!booking._id) return null;
  return {
    _id: String(booking._id),
    job_no: booking.job_no,
    book_date: booking.book_date,
    cancelled: booking.cancelled ? String(booking.cancelled) : null,
  };
}

export function toCancellationSummary(
  value: unknown,
): LeadCancellationSummary | null {
  if (!value || typeof value !== "object") return null;
  const cancellation = value as PopulatedCancellation;
  if (!cancellation._id) return null;
  return {
    _id: String(cancellation._id),
    cancel_date: cancellation.cancel_date,
    reason: cancellation.reason,
    job_no: cancellation.job_no,
  };
}
