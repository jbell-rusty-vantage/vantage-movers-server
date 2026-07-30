import {
  resolveSourceCompany,
  type LeadModelName,
  type SourceCompany,
} from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import {
  findBestCallLeadMatchByPhone,
  getLinkedLead,
  hasFormFillForCallLead,
  type SourceLeadDocument,
} from "../leads";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type {
  CreateBookedLeadFromSourceInput,
  CreateBookedLeadInput,
} from "../../validation/v1.validation";
import { V1ServiceError } from "../v1ServiceError";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";
import { resolveLeadCplSnapshot } from "../leads/leadCplResolution";
import { bestRelocationImportLeadFilter } from "./bestRelocationImportGuard";

/**
 * Locates (or creates) the source lead a booked-from-source request points at.
 *
 * Behavior preserved from `v1.service.ts`:
 *   - `FormLead` requests look the lead up by `form_lead_id` and reuse the
 *     submitted `job_no`.
 *   - `CallLead` requests with a job number find an existing call lead
 *     (rejecting with 409 if multiple share the same job number) and
 *     refresh its phone number when one was submitted.
 *   - When no job-number match is found, the resolver falls back to a
 *     phone-based match using `findBestCallLeadMatchByPhone`. Matched call
 *     leads receive the submitted job number and phone number before they
 *     are returned.
 *   - When neither path finds a match, a brand-new `CallLead` is created
 *     with `created_on_unmatched: true` so the unmatched call sheet sync
 *     path skips it. `form_fill` is computed via `hasFormFillForCallLead`
 *     against the resolved source company.
 */
export async function resolveBookingSourceLead(
  input: CreateBookedLeadFromSourceInput,
): Promise<{ lead: SourceLeadDocument; leadModel: LeadModelName; jobNo?: string }> {
  if (input.lead_type === "FormLead") {
    const lead = await getLinkedLead("FormLead", input.form_lead_id);
    return { lead, leadModel: "FormLead", jobNo: input.job_no };
  }

  const jobNo = input.call_job_no?.trim() || undefined;
  const submittedPhone = input.call_phone_number?.trim();
  const normalizedPhone = normalizePhoneNumberForMatch(submittedPhone);
  const importLeadFilter = bestRelocationImportLeadFilter(input.ingestion_source);

  const leads = jobNo
    ? await CallLead.find({ job_no: jobNo, ...importLeadFilter })
        .sort({ createdAt: -1 })
        .limit(5)
    : [];

  if (leads.length > 1) {
    throw new V1ServiceError(
      `Multiple call leads matched job_no ${jobNo}: ${leads
        .map((lead) => lead._id.toString())
        .join(", ")}`,
      409,
    );
  }

  if (leads.length === 1) {
    const lead = leads[0];
    if (submittedPhone) {
      lead.phone_number = submittedPhone;
      await lead.save();
    }
    return { lead, leadModel: "CallLead", jobNo };
  }

  const phoneMatchedLead = normalizedPhone
    ? await findBestCallLeadMatchByPhone(normalizedPhone, {
        sourceCompany: importLeadFilter.source_company,
      })
    : undefined;
  if (phoneMatchedLead) {
    if (jobNo) {
      phoneMatchedLead.job_no = jobNo;
    }
    if (submittedPhone) {
      phoneMatchedLead.phone_number = submittedPhone;
    }
    await phoneMatchedLead.save();
    return { lead: phoneMatchedLead, leadModel: "CallLead", jobNo };
  }

  const { assignment: sourceAssignment } = await resolveLeadSourceAssignment({
      value: input.source_company,
      channel: "call",
    });
  const form_fill = await hasFormFillForCallLead(
    {
      sourceCompany: sourceAssignment.source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
    },
    submittedPhone,
  );
  const timestamp = toFloridaTimestamp(input.timestamp);
  const cplSnapshot = await resolveLeadCplSnapshot({
    sourceGranularityId: sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    storedBusinessTimestamp: timestamp,
    applicable: false,
  });
  const lead = await CallLead.create({
    ...(jobNo ? { job_no: jobNo } : {}),
    ...(submittedPhone ? { phone_number: submittedPhone } : {}),
    ...sourceAssignment,
    form_fill,
    created_on_unmatched: true,
    timestamp,
    ...cplSnapshot,
  });

  return { lead, leadModel: "CallLead", jobNo };
}

/**
 * Resolves the effective `source_company` to persist on a booked lead.
 *
 * If the request explicitly overrides the source company, prefer the label
 * lookup (so display strings like "Vantage – Long Distance" still resolve
 * to their canonical key) and fall back to direct parsing. When no override
 * is supplied, parse the source lead's existing `source_company`.
 */
export function effectiveBookingSourceCompany(
  sourceCompanyOverride: string | undefined,
  lead: SourceLeadDocument,
): SourceCompany {
  const sourceCompanyOverrideText = sourceCompanyOverride?.trim();
  if (sourceCompanyOverrideText) {
    return sourceCompanyOverrideText as SourceCompany;
  }

  return String(lead.source_company ?? "not_provided") as SourceCompany;
}

/**
 * Decides whether the booking-driven write should overwrite the form lead's
 * `source_company`.
 *
 * Returns the canonical company only when the booking targets a `FormLead`
 * AND the lead's stored company differs from the canonical mapping derived
 * from `input.source`. Returns `undefined` for call leads (their company is
 * settled at booking-source-resolution time) and when the values already
 * agree.
 */
export function getFormLeadSourceCompanyForBooking(
  lead: SourceLeadDocument,
  input: Pick<CreateBookedLeadInput, "lead_model" | "source">,
): SourceCompany | undefined {
  if (input.lead_model !== "FormLead") {
    return undefined;
  }

  const mappedSourceCompany = resolveSourceCompany(input.source);
  if (!mappedSourceCompany || lead.source_company === mappedSourceCompany) {
    return undefined;
  }

  return mappedSourceCompany;
}
