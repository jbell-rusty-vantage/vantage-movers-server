import { floridaCalendarToday } from "../../utils/easternTime";
import { normalizePhoneNumberForStorage, normalizePhoneNumberForMatch } from "../../utils/phone";
import type { CreateEmployeeBookingSubmissionInput } from "../../validation/v1.validation";
import { deriveBookedLeadAgentAllocations, resolveAgentAllocations } from "../agents";
import { resolveActiveMerchantName } from "../catalog";
import {
  normalizeComparisonEmail,
  normalizeComparisonName,
  normalizeJobNo,
  normalizeSubmissionLid,
} from "../bookings/bookingIdentity";
import { ValidationError } from "../errors";
import {
  getSourceCompany,
  isRegistryError,
  listSourceGranularities,
} from "../operationsRegistry";
import type { PreparedEmployeeBookingSubmission } from "./types";
import { toObjectId } from "../../utils/objectId";

export async function prepareEmployeeBookingSubmission(
  input: CreateEmployeeBookingSubmissionInput,
): Promise<PreparedEmployeeBookingSubmission> {
  let company: Awaited<ReturnType<typeof getSourceCompany>> | undefined;
  try {
    company = await getSourceCompany(input.lead_source_company_id);
  } catch (error) {
    if (!isRegistryError(error)) throw error;
  }
  if (!company || company.active !== true) {
    throw new ValidationError("Unknown or inactive employee booking source company");
  }

  const granularities = await listSourceGranularities({
    sourceCompanyId: company.id,
  });
  const granularity = granularities.find(
    (candidate) =>
      candidate.active === true &&
      candidate.granularity_key ===
        input.source_granularity_key.trim().toLowerCase(),
  );
  if (!granularity) {
    throw new ValidationError(
      "Unknown or inactive employee booking source granularity",
    );
  }

  if (!["form", "call"].includes(granularity.channel)) {
    throw new ValidationError("Employee booking source granularity has invalid channel");
  }

  const normalizedPhoneNumber = normalizePhoneNumberForMatch(input.phone_number);
  if (!normalizedPhoneNumber) {
    throw new ValidationError("Phone number is not valid for employee booking matching");
  }

  const normalizedJobNo = normalizeJobNo(input.job_no);
  if (!normalizedJobNo) {
    throw new ValidationError("Job number is required");
  }

  const normalizedLid = normalizeSubmissionLid(input.lid);
  const normalizedEmail = normalizeComparisonEmail(input.email);
  const normalizedLeadName = normalizeComparisonName(input.lead_name);
  const merchant = await resolveActiveMerchantName(input.merchant);
  const allocationInputs = deriveBookedLeadAgentAllocations({
    agent: input.agent,
    split_agent: input.split_agent,
    binder_amount: input.binder_amount,
  });
  const agentAllocations = await resolveAgentAllocations(allocationInputs);

  return {
    submissionId: input.submission_id,
    leadName: input.lead_name.trim(),
    normalizedLeadName,
    phoneNumber: normalizePhoneNumberForStorage(input.phone_number),
    normalizedPhoneNumber,
    email: input.email?.trim() || undefined,
    normalizedEmail,
    lid: input.lid?.trim() || undefined,
    normalizedLid,
    jobNo: input.job_no.trim(),
    normalizedJobNo,
    binderAmount: input.binder_amount,
    depositAmount: input.deposit_amount,
    merchant,
    agent: input.agent.trim(),
    splitAgent: input.split_agent?.trim() || undefined,
    bookDate: floridaCalendarToday(),
    sourceDisplayLabel:
      granularity.crm_label ||
      granularity.owner_label ||
      company.owner_label ||
      company.company_slug,
    sourceAssignment: {
      lead_source_company: toObjectId(company.id),
      source_granularity_id: toObjectId(granularity.id),
      source_granularity_key: granularity.granularity_key,
      source_company: company.company_slug,
      source_company_label_snapshot: company.owner_label,
      source_granularity_label_snapshot: granularity.owner_label,
      crm_source_label_snapshot: granularity.crm_label,
      channel: granularity.channel,
    },
    local: granularity.local ?? undefined,
    agentAllocations,
  };
}
