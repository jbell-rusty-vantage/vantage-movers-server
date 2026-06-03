import type { FormLeadDocument } from "../../models/FormLead";
import { generateLeadId } from "../../utils/ids";
import {
  maskEmailForLog,
  maskPhoneForLog,
} from "../../utils/logging/sanitizeFormLeadForLog";
import { CRM_FORM_LEAD_LABEL } from "./crmConfig";
import type { CrmFormLeadPayload } from "./types";

/**
 * Splits a full name into Granot CRM `firstname`/`lastname` fields.
 *
 * Behavior preserved from the original `crm.service.ts`:
 *   - Empty/whitespace name -> both fields empty.
 *   - Single token       -> both `firstname` and `lastname` get that token
 *                            (Granot rejects rows without a last name).
 *   - Multiple tokens    -> first token is `firstname`, last token is
 *                            `lastname`. Middle tokens are intentionally
 *                            dropped so the lead row stays compact.
 */
export function splitNameForCrm(name: string): {
  firstname: string;
  lastname: string;
} {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstname: "", lastname: "" };
  }

  if (parts.length === 1) {
    return { firstname: parts[0], lastname: parts[0] };
  }

  return {
    firstname: parts[0],
    lastname: parts[parts.length - 1],
  };
}

/**
 * Formats a JS `Date` into the `M/D/YYYY` string Granot expects in
 * `movedte`. Month/day are unpadded (matches the original behavior;
 * Granot's parser accepts either form, but the previous implementation
 * produced unpadded values and we keep that wire shape).
 */
export function formatCrmMoveDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

/**
 * Builds the Granot CRM form-lead payload from a Mongo `FormLead`.
 *
 * Important wire invariants (do not change without coordinating with
 * `.cursor/rules/form-lead-granot-crm.mdc`):
 *   - `label` is the company-facing source label, defaulting to
 *     `CRM_FORM_LEAD_LABEL` when the caller passes a blank value.
 *   - `notes` carries a freshly generated lead identifier for Granot-side
 *     tracking; it is not stored on the Mongo `FormLead`.
 *   - `leadno` is the Mongo `_id` as a string. The Granot extension
 *     reads it back as the web-app `ref_no` column and uses it to
 *     update the right FormLead. NEVER substitute the Mongo `ref_no`
 *     field here.
 */
export function buildCrmFormLeadPayload(
  lead: FormLeadDocument,
  companyLabel: string = CRM_FORM_LEAD_LABEL,
): CrmFormLeadPayload {
  const { firstname, lastname } = splitNameForCrm(lead.name);

  return {
    label: companyLabel.trim() || CRM_FORM_LEAD_LABEL,
    firstname,
    lastname,
    ozip: lead.pickup_zip,
    dzip: lead.destination_zip,
    email: lead.email ?? "",
    phone1: lead.phone_number,
    movesize: lead.move_size,
    movedte: formatCrmMoveDate(lead.move_date),
    notes: generateLeadId(),
    leadno: lead._id.toString(),
  };
}

/**
 * Encodes a payload as `application/x-www-form-urlencoded` for the
 * Granot HTTP submission.
 */
export function encodeCrmFormBody(payload: CrmFormLeadPayload): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    params.set(key, value);
  }

  return params.toString();
}

/**
 * Returns a log-safe summary of a CRM payload: keeps non-PII fields
 * (label, zips, move size/date, leadno, notes) as-is and masks
 * `firstname`/`lastname`/`email`/`phone1`.
 *
 * Use this in service logs so operators can debug what we sent to
 * Granot without writing raw customer PII to Vercel log storage.
 */
export function summarizeCrmPayloadForLog(
  payload: CrmFormLeadPayload,
): Record<string, string> {
  return {
    label: payload.label,
    firstname: payload.firstname ? `${payload.firstname[0]}***` : "",
    lastname: payload.lastname ? `${payload.lastname[0]}***` : "",
    ozip: payload.ozip,
    dzip: payload.dzip,
    email: payload.email ? maskEmailForLog(payload.email) : "",
    phone1: payload.phone1 ? maskPhoneForLog(payload.phone1) : "",
    movesize: payload.movesize,
    movedte: payload.movedte,
    notes: payload.notes,
    leadno: payload.leadno,
  };
}
