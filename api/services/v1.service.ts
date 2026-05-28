import type mongoose from "mongoose";
import type { LeadModelName } from "../config/domain";
import { BookedLead, type BookedLeadDocument } from "../models/BookedLead";
import { CancelledLead } from "../models/CancelledLead";
import type {
  CreateCancelledLeadInput,
  UpdateCancelledLeadInput,
} from "../validation/v1.validation";
import { deleteCancelledLeadFromSheets } from "./googleSheets.service";
import { primaryAgentName } from "./agents";
import {
  scheduleFullSheetSyncProcess,
  syncBookingAndSource,
  syncSourceLead,
  syncSourceLeadById,
} from "./sheetSync";
import { getLinkedLead, resolveSourceLeadById } from "./leads";
import { V1ServiceError } from "./v1ServiceError";

// --- Compatibility re-exports -------------------------------------------------
//
// Route layers and other services historically imported these symbols from
// `api/services/v1.service.ts`. As the refactor moves implementations into
// dedicated folders, this facade keeps the original import paths working.
//
// Cancellation lifecycle (create/update/find/delete) still lives in this
// file; refactor plan 05 will extract it into `api/services/cancellations/`.

export { V1ServiceError } from "./v1ServiceError";

export {
  scheduleBookingChainSheetSync,
  scheduleCallLeadSheetSync,
} from "./sheetSync";

export {
  createCallLead,
  createFormLead,
  deleteCallLead,
  deleteFormLead,
  findAllCallLeads,
  findAllFormLeads,
  findFormLead,
  updateCallLead,
  updateFormLead,
} from "./leads";

export {
  createBookedLead,
  createBookedLeadFromSource,
  deleteBookedLead,
  findAllBookedLeads,
  refreshAttachedBookingFromLead,
  updateBookedLead,
} from "./bookings";

export {
  createCustomer,
  deleteCustomer,
  findAllCustomers,
  updateCustomer,
} from "./customers";

// -----------------------------------------------------------------------------
// Cancellation lifecycle. These functions still live here because refactor
// plan 05 owns the cancellation extraction. They depend on booking mirror
// helpers (now in `services/bookings/`) and on `primaryAgentName` (now in
// `services/agents/`), but the cancellation graph is small enough that
// keeping it in one place here is still the simplest path until plan 05.

export async function createCancelledLead(input: CreateCancelledLeadInput) {
  const booking = await resolveBookedLeadForCancellation(input);

  const customer = booking.customer as
    | { _id?: mongoose.Types.ObjectId; full_name?: string }
    | undefined;
  const timestamp = input.timestamp ?? new Date();
  const cancellation = await CancelledLead.create({
    timestamp,
    booked_lead: booking._id,
    customer: customer?._id ?? booking.customer,
    lead_ref: booking.lead_ref,
    lead_model: booking.lead_model,
    cancel_date: input.cancel_date ?? timestamp,
    agent: primaryAgentName(booking),
    book_date: booking.book_date,
    job_no: booking.job_no,
    customer_name: customer?.full_name,
    refund_amount: input.refund_amount,
    merchant: booking.merchant,
    source: booking.source,
    reason: input.reason,
    notes: input.notes,
    cancelled_by: input.cancelled_by,
  });

  booking.cancelled = cancellation._id;
  await booking.save();
  await mirrorCancellationToLead(
    booking.lead_model as LeadModelName,
    booking.lead_ref.toString(),
    cancellation._id,
  );
  scheduleFullSheetSyncProcess({
    resource: "cancellation_chain",
    operation: "cancelled_lead.create",
    cancellationId: cancellation._id.toString(),
  });
  return cancellation;
}

async function resolveBookedLeadForCancellation(
  input: CreateCancelledLeadInput,
): Promise<mongoose.HydratedDocument<BookedLeadDocument>> {
  if (input.booked_lead && !input.lead_id) {
    return getBookedLeadForCancellation(input.booked_lead);
  }

  if (!input.lead_id) {
    throw new V1ServiceError("Either booked_lead or lead_id must be provided", 400);
  }

  const { lead, leadModel } = await resolveSourceLeadById(input.lead_id);
  if (!lead.booked) {
    throw new V1ServiceError("Source lead is not booked", 409);
  }

  const booking = await getBookedLeadForCancellation(lead.booked.toString());
  if (input.booked_lead && !booking._id.equals(input.booked_lead)) {
    throw new V1ServiceError("booked_lead does not match the source lead booking", 409);
  }
  if (booking.lead_model !== leadModel || booking.lead_ref.toString() !== lead._id.toString()) {
    throw new V1ServiceError("Booked lead does not match the source lead", 409);
  }

  return booking;
}

async function getBookedLeadForCancellation(
  bookedLeadId: string,
): Promise<mongoose.HydratedDocument<BookedLeadDocument>> {
  const booking = await BookedLead.findById(bookedLeadId).populate("customer");
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  if (booking.cancelled) {
    throw new V1ServiceError("Booked lead is already cancelled", 409);
  }

  return booking;
}

export async function updateCancelledLead(id: string, input: UpdateCancelledLeadInput) {
  const cancellation = await CancelledLead.findByIdAndUpdate(id, input, {
    returnDocument: "after",
  });
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }

  scheduleFullSheetSyncProcess({
    resource: "cancellation_chain",
    operation: "cancelled_lead.update",
    cancellationId: cancellation._id.toString(),
  });
  return cancellation;
}

export async function findAllCancelledLeads() {
  return CancelledLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function deleteCancelledLead(id: string) {
  const cancellation = await CancelledLead.findById(id);
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }
  await deleteCancelledLeadFromSheets(cancellation);
  const booking = await BookedLead.findByIdAndUpdate(
    cancellation.booked_lead,
    { $unset: { cancelled: "" } },
    { returnDocument: "after" },
  );
  await clearCancellationFromLead(
    cancellation.lead_model as LeadModelName,
    cancellation.lead_ref?.toString(),
    false,
  );
  if (booking) {
    await syncBookingAndSource(
      booking._id,
      booking.lead_model as LeadModelName,
      booking.lead_ref.toString(),
    );
  } else if (cancellation.lead_ref) {
    await syncSourceLeadById(
      cancellation.lead_model as LeadModelName,
      cancellation.lead_ref.toString(),
    );
  }
  await cancellation.deleteOne();
}

async function mirrorCancellationToLead(
  leadModel: LeadModelName,
  leadId: string,
  cancellationId: mongoose.Types.ObjectId,
) {
  const lead = await getLinkedLead(leadModel, leadId);
  lead.cancelled = cancellationId;
  await lead.save();
}

async function clearCancellationFromLead(
  leadModel: LeadModelName,
  leadId?: string,
  syncAfterClear = true,
) {
  if (!leadId) {
    return;
  }
  const lead = await getLinkedLead(leadModel, leadId);
  lead.cancelled = undefined;
  await lead.save();
  if (syncAfterClear) {
    await syncSourceLead(lead, leadModel);
  }
}
