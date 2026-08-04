import { createHash } from "node:crypto";
import { toFloridaTimestamp } from "../../utils/easternTime";
import type { CreateLeadlessBookingInput } from "../../validation/v1.validation";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { deriveBookedLeadAgentAllocations, resolveAgentAllocations } from "../agents";
import { resolveActiveMerchantName } from "../catalog";
import { upsertCustomerFromBookingContact } from "../customers/customerFromLead.service";
import {
  finalizeSheetSync,
  persistSheetSyncIntent,
  runSheetSyncWrite,
  type FullSheetSyncJob,
} from "../sheetSync";
import { V1ServiceError } from "../v1ServiceError";
import { buildBookedLeadWarnings } from "./bookingWarnings";
import { populateBookedLead } from "./bookedLead.service";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";
import { requireBestRelocationImportSource } from "./bestRelocationImportGuard";
import {
  normalizeComparisonName,
  normalizeJobNo,
} from "./bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";

function leadlessBookingJob(bookingId: string): FullSheetSyncJob {
  return {
    resource: "booked_lead",
    operation: "leadless_booking.create",
    bookingId,
  };
}

async function resolveLeadlessBookingSource(
  sourceCompany: string,
  sourceLabel?: string,
) {
  const channel: "call" | "form" = /inbound|call/i.test(sourceLabel ?? "")
    ? "call"
    : "form";
  const { assignment } = await resolveLeadSourceAssignment({
    value: sourceLabel ?? sourceCompany,
    channel,
  });
  return {
    companySlug: assignment.source_company,
    assignment,
    channel,
    label:
      assignment.crm_source_label_snapshot ??
      assignment.source_granularity_label_snapshot ??
      assignment.source_company_label_snapshot ??
      assignment.source_company,
  };
}

export async function createLeadlessBooking(input: CreateLeadlessBookingInput) {
  const jobNo = input.job_no.trim();
  const resolvedSource = await resolveLeadlessBookingSource(
    input.source_company,
    input.source,
  );
  const isBestRelocationImport = requireBestRelocationImportSource(
    input.ingestion_source,
    resolvedSource.companySlug,
  );
  const existingBooking = await BookedLead.findOne({ job_no: jobNo }).select("_id").lean().exec();
  if (existingBooking) {
    throw new V1ServiceError("A booking already exists with this job number", 409);
  }

  const allocationInputs = deriveBookedLeadAgentAllocations({
    agent: input.agent,
    split_agent: input.split_agent,
    binder_amount: input.total_binder_amount,
  });
  const agent_allocations = await resolveAgentAllocations(allocationInputs, {
    includeInactive: isBestRelocationImport,
  });
  const merchant = await resolveActiveMerchantName(input.merchant);
  const warnings = buildBookedLeadWarnings(agent_allocations);
  const depositAmount = input.deposit_amount;
  const customerName = input.customer_name?.trim() ?? "";
  const source =
    input.source?.trim() || resolvedSource.label;

  const outcome = await runSheetSyncWrite(async (session) => {
    const customer = customerName
      ? await upsertCustomerFromBookingContact(
          { customer_name: customerName, customer_phone: input.customer_phone },
          session,
        )
      : undefined;
    const created = new BookedLead({
      timestamp: toFloridaTimestamp(new Date()),
      book_date: input.book_date,
      job_no: jobNo,
      ...(customerName ? { customer_name: customerName } : {}),
      ...(customer ? { customer: customer._id } : {}),
      agent_allocations,
      total_binder_amount: input.total_binder_amount,
      deposit_amount: depositAmount,
      merchant,
      source,
      is_leadless_booking: true,
      local: input.local,
      over_2000: depositAmount > 2000,
      over_4000: depositAmount > 4000,
    });
    await created.save({ session });
    if (isBestRelocationImport) {
      const phone = input.customer_phone?.trim() || "not provided";
      const leadName = customerName || "Unknown";
      const candidateHash = createHash("sha256")
        .update(`${jobNo}:external_sheet_ingestion`)
        .digest("hex");
      await BookingLeadReconciliationCase.create(
        [
          {
            booking: created._id,
            origin: "external_sheet_ingestion",
            status: "pending",
            reason: "no_match",
            submission: {
              submission_id: `external-sheet:${normalizeJobNo(jobNo) ?? jobNo}`,
              lead_name: leadName,
              normalized_name: normalizeComparisonName(leadName),
              phone_number: phone,
              normalized_phone_number:
                input.customer_phone
                  ? normalizePhoneNumberForMatch(phone) ?? "not_provided"
                  : "not_provided",
              job_no: jobNo,
              normalized_job_no: normalizeJobNo(jobNo) ?? jobNo,
              binder_amount: input.total_binder_amount,
              deposit_amount: depositAmount,
              merchant,
              agent: input.agent,
              ...(input.split_agent
                ? { split_agent: input.split_agent }
                : {}),
              book_date: input.book_date,
              source_assignment: {
                ...resolvedSource.assignment,
                channel: resolvedSource.channel,
              },
            },
            latest_candidates: [],
            match_attempts: [
              {
                attempted_at: new Date(),
                trigger: "initial",
                outcome: "no_match",
                reason: "external_sheet_ingestion",
                candidate_count: 0,
                candidate_snapshot_hash: candidateHash,
                auto_match_policy_version:
                  "best-relocation-conservative-v1",
                enabled_auto_match_rules: [],
              },
            ],
            retry: { attempt_count: 0 },
            resolution_history: [],
            revision: 0,
          },
        ],
        { session },
      );
    }
    await persistSheetSyncIntent(leadlessBookingJob(created._id.toString()), session);
    return { booking: created, warnings };
  });

  const { booking } = outcome;
  await finalizeSheetSync(leadlessBookingJob(booking._id.toString()));

  return {
    booking: await populateBookedLead(booking._id),
    message: "Leadless booking created.",
    warnings,
    total_binder_amount: booking.total_binder_amount,
  };
}
