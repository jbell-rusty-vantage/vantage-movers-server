import type { LocalType } from "../../config/domain";
import type { CreateBookedLeadFromSourceInput } from "../../validation/v1.validation";
import { deriveBookedLeadAgentAllocations } from "../agents";
import { createBookedLead } from "./bookedLead.service";
import {
  effectiveBookingSourceCompany,
  resolveBookingSourceLead,
} from "./bookingSourceResolver";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";

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
  let bookingSource = sourceDisplayLabelFromLead(lead) ?? effectiveSourceCompany;
  if (input.source_company?.trim()) {
    const { resolution, assignment } = await resolveLeadSourceAssignment({
      value: input.source_company,
      company_slug: effectiveSourceCompany,
      channel: leadModel === "CallLead" ? "call" : "form",
      local: lead.local as LocalType | undefined,
      source_site: lead.source_company_site,
    });
    Object.assign(lead, assignment);
    lead.cpl = resolution.granularity.cpl;
    bookingSource = sourceDisplayLabelFromAssignment(assignment);
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
    source: bookingSource,
    local: lead.local as LocalType | undefined,
    submission_id: input.submission_id,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
  });
}

type SourceDisplayLead = {
  crm_source_label_snapshot?: unknown;
  source_granularity_label_snapshot?: unknown;
  source_company_label_snapshot?: unknown;
};

function sourceDisplayLabelFromLead(lead: SourceDisplayLead): string | undefined {
  return (
    stringValue(lead.crm_source_label_snapshot) ??
    stringValue(lead.source_granularity_label_snapshot) ??
    stringValue(lead.source_company_label_snapshot)
  );
}

function sourceDisplayLabelFromAssignment(assignment: {
  crm_source_label_snapshot?: string;
  source_granularity_label_snapshot?: string;
  source_company_label_snapshot?: string;
  source_company: string;
}): string {
  return (
    assignment.crm_source_label_snapshot ??
    assignment.source_granularity_label_snapshot ??
    assignment.source_company_label_snapshot ??
    assignment.source_company
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
