import { toFloridaTimestamp } from "../../utils/easternTime";
import type { CreateLeadlessBookingInput } from "../../validation/v1.validation";
import { BookedLead } from "../../models/BookedLead";
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

function leadlessBookingJob(bookingId: string): FullSheetSyncJob {
  return {
    resource: "booked_lead",
    operation: "leadless_booking.create",
    bookingId,
  };
}

async function resolveLeadlessBookingSource(sourceCompany: string) {
  const { assignment } = await resolveLeadSourceAssignment({
    value: sourceCompany,
    channel: "call",
  });
  return {
    companySlug: assignment.source_company,
    label:
      assignment.crm_source_label_snapshot ??
      assignment.source_granularity_label_snapshot ??
      assignment.source_company_label_snapshot ??
      assignment.source_company,
  };
}

export async function createLeadlessBooking(input: CreateLeadlessBookingInput) {
  const jobNo = input.job_no.trim();
  const resolvedSource = await resolveLeadlessBookingSource(input.source_company);
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

  const booking = await runSheetSyncWrite(async (session) => {
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
    await persistSheetSyncIntent(leadlessBookingJob(created._id.toString()), session);
    return created;
  });

  await finalizeSheetSync(leadlessBookingJob(booking._id.toString()));

  return {
    booking: await populateBookedLead(booking._id),
    message: "Leadless booking created.",
    warnings,
    total_binder_amount: booking.total_binder_amount,
  };
}
