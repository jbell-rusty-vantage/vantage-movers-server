import type mongoose from "mongoose";
import { CallLead, type CallLeadDocument } from "../../models/CallLead";
import { normalizePhoneNumberForMatch } from "../../utils/phone";

/**
 * Builds a Mongo-side regex sieve that hits any stored phone whose last 10
 * digits equal `normalizedPhone`, regardless of separators or extra leading
 * digits (e.g. country code, or an 11th digit that storage chose to preserve
 * as-is).
 *
 * Anchored only at the tail via `(?:\D|$)` so the regex never matches the
 * prefix of a longer number. Callers must still verify the exact match in
 * memory via `normalizePhoneNumberForMatch(stored) === normalizedPhone`.
 */
export function buildPhoneRegex(normalizedPhone: string): RegExp {
  const digits = normalizedPhone.replace(/\D/g, "");
  return new RegExp(`${digits.split("").join("\\D*")}(?:\\D|$)`);
}

/**
 * Finds the best call lead match for a normalized phone number.
 *
 * Selection rules (preserved from the original implementation):
 * - Candidates are filtered to those whose normalized stored phone exactly
 *   equals `normalizedPhone` (the regex is only a Mongo-side sieve).
 * - Unbooked and uncancelled candidates are preferred when at least one
 *   exists.
 * - Ties broken by recency (`timestamp` then `createdAt`, newest first).
 */
export async function findBestCallLeadMatchByPhone(
  normalizedPhone: string,
  options: { sourceCompany?: string } = {},
): Promise<mongoose.HydratedDocument<CallLeadDocument> | undefined> {
  const candidates = (
    await CallLead.find({
      ...(options.sourceCompany ? { source_company: options.sourceCompany } : {}),
      $or: [
        { normalized_phone_number: normalizedPhone },
        { phone_number: buildPhoneRegex(normalizedPhone) },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(25)
      .exec()
  ).filter((lead) => normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone);

  if (candidates.length === 0) {
    return undefined;
  }

  const eligibleCandidates = candidates.filter((lead) => !lead.booked && !lead.cancelled);
  const ranked = eligibleCandidates.length > 0 ? eligibleCandidates : candidates;
  ranked.sort(compareCallLeadRecency);
  return ranked[0];
}

function compareCallLeadRecency(
  a: mongoose.HydratedDocument<CallLeadDocument>,
  b: mongoose.HydratedDocument<CallLeadDocument>,
): number {
  return getCallLeadTime(b) - getCallLeadTime(a);
}

function getCallLeadTime(lead: mongoose.HydratedDocument<CallLeadDocument>): number {
  const doc = lead as mongoose.HydratedDocument<CallLeadDocument> & { createdAt?: Date };
  return (lead.timestamp ?? doc.createdAt ?? new Date(0)).getTime();
}
