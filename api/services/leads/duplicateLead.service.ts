import type { ClientSession } from "mongoose";
import type { SourceCompany } from "../../config/domain";
import { logger } from "../../logger";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { FullSheetSyncJob } from "../sheetSync";
import { buildPhoneRegex } from "./leadPhoneMatching";

export type DuplicateFormLeadMatch = {
  duplicate: boolean;
  matchedBy: "email" | "phone" | "both" | null;
  matchedLeadIds: string[];
};

/**
 * Resolves whether the supplied phone or email already exists for a
 * non-duplicate form lead within the same source company, returning the match
 * basis and matched lead IDs so callers can record richer operational events.
 *
 * Phone matching uses `buildPhoneRegex` as a Mongo-side sieve and then
 * re-verifies in memory via `normalizePhoneNumberForMatch`.
 */
export async function findDuplicateFormLeadMatch(
  sourceCompany: SourceCompany,
  phoneNumber?: string | null,
  email?: string | null,
): Promise<DuplicateFormLeadMatch> {
  const FormLead = getFormLeadModel();
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  const normalizedEmail = email?.trim().toLowerCase();
  const duplicateClauses = [
    ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
    ...(normalizedPhone ? [{ phone_number: buildPhoneRegex(normalizedPhone) }] : []),
  ];

  if (duplicateClauses.length === 0) {
    return { duplicate: false, matchedBy: null, matchedLeadIds: [] };
  }

  const candidates = await FormLead.find({
    source_company: sourceCompany,
    duplicate: { $ne: true },
    $or: duplicateClauses,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .exec();

  let emailMatch = false;
  let phoneMatch = false;
  let hasMatch = false;
  const matchedLeadIds: string[] = [];

  for (const lead of candidates) {
    const byEmail = normalizedEmail ? lead.email === normalizedEmail : false;
    const byPhone = normalizedPhone
      ? normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone
      : false;
    if (byEmail || byPhone) {
      hasMatch = true;
      emailMatch = emailMatch || byEmail;
      phoneMatch = phoneMatch || byPhone;
      if (lead._id) {
        matchedLeadIds.push(lead._id.toString());
      }
    }
  }

  const duplicate = hasMatch;
  const matchedBy = !duplicate
    ? null
    : emailMatch && phoneMatch
      ? "both"
      : emailMatch
        ? "email"
        : "phone";

  return { duplicate, matchedBy, matchedLeadIds };
}

/**
 * Returns `true` when the supplied phone or email already exists for a
 * non-duplicate form lead within the same source company. Compatibility
 * wrapper around `findDuplicateFormLeadMatch`.
 */
export async function isDuplicateFormLead(
  sourceCompany: SourceCompany,
  phoneNumber?: string | null,
  email?: string | null,
): Promise<boolean> {
  const match = await findDuplicateFormLeadMatch(sourceCompany, phoneNumber, email);
  return match.duplicate;
}

/**
 * Returns `true` when a non-duplicate form lead exists in the same source
 * company that shares the supplied phone number. Used to set `form_fill`
 * on newly created call leads.
 */
export async function hasFormFillForCallLead(
  sourceCompany: SourceCompany,
  phoneNumber?: string | null,
): Promise<boolean> {
  const FormLead = getFormLeadModel();
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  if (!normalizedPhone) {
    return false;
  }

  const candidates = await FormLead.find({
    source_company: sourceCompany,
    duplicate: { $ne: true },
    phone_number: buildPhoneRegex(normalizedPhone),
  })
    .sort({ createdAt: -1 })
    .limit(25)
    .exec();

  return candidates.some(
    (lead) => normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone,
  );
}

/**
 * Flips `form_fill = true` on any matching call leads in the same source
 * company when a new (non-duplicate) form lead arrives.
 *
 * Returns a `source_lead` sheet-sync job for every call lead it touched so the
 * caller can persist/finalize the syncs alongside the form-lead write (inside
 * the same transaction in queued mode). When a `session` is supplied the call
 * lead writes participate in that transaction.
 */
export async function markMatchingCallLeadsWithFormFill(
  sourceCompany: SourceCompany,
  phoneNumber: string,
  formLeadId: string,
  session?: ClientSession,
): Promise<FullSheetSyncJob[]> {
  const CallLead = getCallLeadModel();
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  if (!normalizedPhone) {
    return [];
  }

  const candidatesQuery = CallLead.find({
    source_company: sourceCompany,
    form_fill: { $ne: true },
    $or: [
      { normalized_phone_number: normalizedPhone },
      { phone_number: buildPhoneRegex(normalizedPhone) },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(25);
  const candidates = await (session ? candidatesQuery.session(session) : candidatesQuery).exec();

  const matchedCallLeads = candidates.filter(
    (lead) => normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone,
  );

  const jobs: FullSheetSyncJob[] = [];
  for (const callLead of matchedCallLeads) {
    callLead.form_fill = true;
    await callLead.save({ session });
    jobs.push({
      resource: "source_lead",
      operation: "call_lead.form_fill.update",
      leadModel: "CallLead",
      leadId: callLead._id.toString(),
    });
  }

  logger.info({
    msg: "form_lead.call_lead_form_fill.updated",
    formLeadId,
    sourceCompany,
    normalizedPhone,
    matchedCallLeadCount: matchedCallLeads.length,
  });

  return jobs;
}
