import type { SourceCompany } from "../../config/domain";
import { logger } from "../../logger";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import { scheduleFullSheetSyncProcess } from "../sheetSync";
import { buildPhoneRegex } from "./leadPhoneMatching";

/**
 * Returns `true` when the supplied phone + email pair already exists for a
 * non-duplicate form lead within the same source company.
 *
 * Both phone and email are required to count as a duplicate; either being
 * absent short-circuits to `false`, preserving the original behavior where
 * single-field collisions never mark a new lead as a duplicate.
 *
 * Phone matching uses `buildPhoneRegex` as a Mongo-side sieve and then
 * re-verifies in memory via `normalizePhoneNumberForMatch`.
 */
export async function isDuplicateFormLead(
  sourceCompany: SourceCompany,
  phoneNumber?: string | null,
  email?: string | null,
): Promise<boolean> {
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedPhone || !normalizedEmail) {
    return false;
  }

  const candidates = await FormLead.find({
    source_company: sourceCompany,
    email: normalizedEmail,
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
 * Returns `true` when a non-duplicate form lead exists in the same source
 * company that shares the supplied phone number. Used to set `form_fill`
 * on newly created call leads.
 */
export async function hasFormFillForCallLead(
  sourceCompany: SourceCompany,
  phoneNumber?: string | null,
): Promise<boolean> {
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
 * Each matched call lead also gets a sheet sync scheduled so its row in the
 * Calls sheet reflects the updated `FormFill` column. Schedules occur at the
 * exact same point as before extraction to preserve sync ordering guarantees.
 */
export async function markMatchingCallLeadsWithFormFill(
  sourceCompany: SourceCompany,
  phoneNumber: string,
  formLeadId: string,
): Promise<void> {
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  if (!normalizedPhone) {
    return;
  }

  const candidates = await CallLead.find({
    source_company: sourceCompany,
    form_fill: { $ne: true },
    $or: [
      { normalized_phone_number: normalizedPhone },
      { phone_number: buildPhoneRegex(normalizedPhone) },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(25)
    .exec();

  const matchedCallLeads = candidates.filter(
    (lead) => normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone,
  );

  for (const callLead of matchedCallLeads) {
    callLead.form_fill = true;
    await callLead.save();
    scheduleFullSheetSyncProcess({
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
}
