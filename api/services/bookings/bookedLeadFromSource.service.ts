import type { LocalType } from "../../config/domain";
import type { CreateBookedLeadFromSourceInput } from "../../validation/v1.validation";
import { deriveBookedLeadAgentAllocations } from "../agents";
import { createBookedLead } from "./bookedLead.service";
import {
  effectiveBookingSourceCompany,
  resolveBookingSourceLead,
} from "./bookingSourceResolver";

/**
 * Bridges Google Form / phone-driven booking submissions onto the generic
 * booking lifecycle.
 *
 * Resolves (or creates) the source lead, decides the canonical
 * `source_company` from any override the form supplied, and writes that
 * back onto the lead before delegating to `createBookedLead`. Behavior
 * matches the original `v1.service.ts` implementation field-for-field,
 * including the `lead.source_company = effectiveSourceCompany` write that
 * only fires when the request actually overrode the source company.
 */
export async function createBookedLeadFromSource(input: CreateBookedLeadFromSourceInput) {
  const { lead, leadModel, jobNo } = await resolveBookingSourceLead(input);
  const effectiveSourceCompany = effectiveBookingSourceCompany(input.source_company, lead);
  if (input.source_company?.trim()) {
    lead.source_company = effectiveSourceCompany;
    await lead.save();
  }

  return createBookedLead({
    timestamp: input.timestamp,
    book_date: input.book_date,
    job_no: jobNo,
    lead_ref: lead._id.toString(),
    lead_model: leadModel,
    agent_allocations: deriveBookedLeadAgentAllocations(input),
    total_binder_amount: input.binder_amount,
    deposit_amount: input.deposit_amount,
    merchant: input.merchant,
    source: effectiveSourceCompany,
    local: lead.local as LocalType | undefined,
    submission_id: input.submission_id,
  });
}
