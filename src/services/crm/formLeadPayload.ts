import { createHash } from "node:crypto";
import type { FormLeadDocument } from "../../models/FormLead";
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
 * Formats a date-only Mongo value into the `M/D/YYYY` string Granot expects in
 * `movedte`. Form move dates are stored at UTC midnight, so UTC components
 * preserve the submitted calendar day regardless of the process timezone.
 */
export function formatCrmMoveDate(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

/**
 * Builds the Granot CRM form-lead payload from a Mongo `FormLead`.
 *
 * Important wire invariants (do not change without coordinating with
 * `.cursor/rules/form-lead-granot-crm.mdc`):
 *   - `label` is the company-facing source label, defaulting to
 *     `CRM_FORM_LEAD_LABEL` when the caller passes a blank value.
 *   - `leadno` carries the provider `ref_no`; Granot writes it to the list
 *     `ref_no` column used by both reconciliation paths.
 *   - `notes` may carry the internal `lid` for operator context, but it is
 *     never a matching key.
 *
 * Exact CRM labels (see `CRM_SOURCE_LABELS` in `config/domain/sources`):
 *   - Form leads: source company + local move type
 *     (`getCrmFormLeadSourceCompanyLabel`).
 *   - Call leads: source company inbound label
 *     (`getCallLeadSourceCompanyLabel`).
 */
export function buildCrmFormLeadPayload(
  lead: FormLeadDocument,
  companyLabel: string = CRM_FORM_LEAD_LABEL,
): CrmFormLeadPayload {
  const { firstname, lastname } = splitNameForCrm(lead.name);
  const lid = lead.lid?.trim() || "";
  const rawRefNo = lead.ref_no?.trim() || "";
  const providerRefNo =
    rawRefNo.toLowerCase() === "not provided" ? "" : rawRefNo;

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
    notes: lid,
    leadno: providerRefNo,
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
 * Returns a log-safe summary of a CRM payload. Customer identifiers and
 * locations are represented by deterministic short fingerprints so operators
 * can correlate retries without persisting raw values.
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
    ozip: fingerprintForLog(payload.ozip),
    dzip: fingerprintForLog(payload.dzip),
    email: payload.email ? maskEmailForLog(payload.email) : "",
    phone1: payload.phone1 ? maskPhoneForLog(payload.phone1) : "",
    movesize: payload.movesize,
    movedte: payload.movedte,
    notes: fingerprintForLog(payload.notes),
    leadno: fingerprintForLog(payload.leadno),
  };
}

function fingerprintForLog(value: string): string {
  return value
    ? `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 12)}`
    : "";
}
