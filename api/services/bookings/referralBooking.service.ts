import type { CreateReferralBookingInput } from "../../validation/v1.validation";
import { BookedLead } from "../../models/BookedLead";
import { deriveBookedLeadAgentAllocations, resolveAgentAllocations } from "../agents";
import { scheduleBookedLeadSheetSync } from "../sheetSync";
import { V1ServiceError } from "../v1ServiceError";
import { buildBookedLeadWarnings } from "./bookingWarnings";
import { populateBookedLead } from "./bookedLead.service";

const REFERRAL_SOURCE = "referral";

export async function createReferralBooking(input: CreateReferralBookingInput) {
  const jobNo = input.job_no.trim();
  const existingBooking = await BookedLead.findOne({ job_no: jobNo }).select("_id").lean().exec();
  if (existingBooking) {
    throw new V1ServiceError("A booking already exists with this job number", 409);
  }

  const allocationInputs = deriveBookedLeadAgentAllocations({
    agent: input.agent,
    split_agent: input.split_agent,
    binder_amount: input.total_binder_amount,
  });
  const agent_allocations = await resolveAgentAllocations(allocationInputs);
  const warnings = buildBookedLeadWarnings(agent_allocations);
  const depositAmount = input.deposit_amount;

  const booking = await BookedLead.create({
    timestamp: new Date(),
    book_date: input.book_date,
    job_no: jobNo,
    customer_name: input.customer_name.trim(),
    agent_allocations,
    total_binder_amount: input.total_binder_amount,
    deposit_amount: depositAmount,
    merchant: input.merchant,
    source: REFERRAL_SOURCE,
    is_referral_booking: true,
    local: input.local,
    over_2000: depositAmount > 2000,
    over_4000: depositAmount > 4000,
  });

  scheduleBookedLeadSheetSync(booking._id.toString(), "referral_booking.create");

  return {
    booking: await populateBookedLead(booking._id),
    message: "Referral booking created.",
    warnings,
    total_binder_amount: booking.total_binder_amount,
  };
}
