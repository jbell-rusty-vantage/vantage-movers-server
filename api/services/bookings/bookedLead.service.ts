import type mongoose from "mongoose";
import type { LeadModelName, LocalType } from "../../config/domain";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import type {
  CreateBookedLeadInput,
  UpdateBookedLeadInput,
} from "../../validation/v1.validation";
import { deleteBookedLeadFromSheets } from "../googleSheets.service";
import {
  patchAgentAllocations,
  resolveAgentAllocations,
  resolveTotalBinderAmount,
} from "../agents";
import {
  upsertCustomerFromBookingContact,
  upsertCustomerFromLead,
} from "../customers/customerFromLead.service";
import { getLinkedLead } from "../leads";
import { scheduleFullSheetSyncProcess } from "../sheetSync";
import { V1ServiceError } from "../v1ServiceError";
import {
  clearBookingFromLead,
  mirrorBookingToLead,
} from "./bookingMirror.service";
import { getFormLeadSourceCompanyForBooking } from "./bookingSourceResolver";
import { buildBookedLeadWarnings } from "./bookingWarnings";

/**
 * Internal create-input variant used by `createBookedLeadFromSource`, which
 * may not yet have a `job_no`.
 *
 * Routes still post the full schema (which requires `job_no`); only the
 * source-driven flow narrows it because call leads can be booked before a
 * job number is recorded.
 */
type CreateBookedLeadServiceInput = Omit<CreateBookedLeadInput, "job_no"> & {
  job_no?: string;
  customer_name?: string;
  customer_phone?: string;
};

export async function createBookedLead(input: CreateBookedLeadServiceInput) {
  const lead = await getLinkedLead(input.lead_model, input.lead_ref);
  const sourceCompanyForLead = getFormLeadSourceCompanyForBooking(lead, input);
  const local = optionalValue(input.local ?? lead.local);
  if (!local && input.lead_model !== "CallLead") {
    throw new V1ServiceError("Booking requires local or a linked lead with local classification");
  }
  const customerNameOverride = input.customer_name?.trim();
  const customer = customerNameOverride
    ? await upsertCustomerFromBookingContact({
        customer_name: customerNameOverride,
        customer_phone: input.customer_phone,
        lead,
      })
    : await upsertCustomerFromLead(lead);
  const over_2000 = input.deposit_amount > 2000;
  const over_4000 = input.deposit_amount > 4000;
  const agent_allocations = await resolveAgentAllocations(input.agent_allocations);
  const total_binder_amount = resolveTotalBinderAmount(
    agent_allocations,
    input.total_binder_amount,
  );
  const warnings = buildBookedLeadWarnings(agent_allocations);
  const existingBooking = await BookedLead.findOne({
    lead_ref: input.lead_ref,
    lead_model: input.lead_model,
  });
  const { customer_phone: _customerPhone, ...bookingInput } = input;

  if (existingBooking) {
    if (input.submission_id && existingBooking.submission_id === input.submission_id) {
      return {
        booking: await populateBookedLead(existingBooking._id),
        message: "Duplicate booked lead submission ignored; existing booking returned.",
        warnings,
        total_binder_amount: existingBooking.total_binder_amount,
      };
    }

    Object.assign(existingBooking, {
      ...bookingInput,
      agent_allocations,
      total_binder_amount,
      ...(customer ? { customer: customer._id } : {}),
      ...(customerNameOverride ? { customer_name: customerNameOverride } : {}),
      local,
      over_2000,
      over_4000,
    });
    await existingBooking.save();
    await mirrorBookingToLead(
      lead,
      existingBooking._id,
      over_2000,
      over_4000,
      local,
      sourceCompanyForLead,
    );
    scheduleFullSheetSyncProcess({
      resource: "booking_chain",
      operation: "booked_lead.upsert",
      bookingId: existingBooking._id.toString(),
    });
    return {
      booking: await populateBookedLead(existingBooking._id),
      message: "Booked lead already existed and was upserted.",
      warnings,
      total_binder_amount,
    };
  }

  const booking = await BookedLead.create({
    ...bookingInput,
    agent_allocations,
    total_binder_amount,
    timestamp: input.timestamp ?? new Date(),
    ...(customer ? { customer: customer._id } : {}),
    ...(customerNameOverride ? { customer_name: customerNameOverride } : {}),
    local,
    over_2000,
    over_4000,
  });

  await mirrorBookingToLead(lead, booking._id, over_2000, over_4000, local, sourceCompanyForLead);
  scheduleFullSheetSyncProcess({
    resource: "booking_chain",
    operation: "booked_lead.create",
    bookingId: booking._id.toString(),
  });
  return {
    booking: await populateBookedLead(booking._id),
    message: "Booked lead created.",
    warnings,
    total_binder_amount,
  };
}

export async function updateBookedLead(id: string, input: UpdateBookedLeadInput) {
  const booking = await BookedLead.findById(id);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  if (booking.is_referral_booking) {
    throw new V1ServiceError("Referral booking edits are not supported yet", 409);
  }
  if (!booking.lead_ref || !booking.lead_model) {
    throw new V1ServiceError("Booked lead is missing linked lead metadata", 409);
  }

  const { agent_allocations, agent_allocation_mode, total_binder_amount, ...bookingInput } = input;
  Object.assign(booking, bookingInput);
  if (input.deposit_amount !== undefined) {
    booking.over_2000 = input.deposit_amount > 2000;
    booking.over_4000 = input.deposit_amount > 4000;
  }
  const warnings: string[] = [];
  if (agent_allocations) {
    const resolvedAllocations = await resolveAgentAllocations(agent_allocations);
    const nextAllocations =
      agent_allocation_mode === "replace"
        ? resolvedAllocations
        : patchAgentAllocations(booking.agent_allocations ?? [], resolvedAllocations);
    booking.set("agent_allocations", nextAllocations);
    warnings.push(...buildBookedLeadWarnings(resolvedAllocations));
  }
  if (agent_allocations || total_binder_amount !== undefined) {
    booking.total_binder_amount = resolveTotalBinderAmount(
      booking.agent_allocations ?? [],
      total_binder_amount,
    );
  }

  const lead = await getLinkedLead(booking.lead_model as LeadModelName, booking.lead_ref.toString());
  booking.local = input.local ?? booking.local ?? lead.local;
  await booking.save();
  await mirrorBookingToLead(
    lead,
    booking._id,
    booking.over_2000,
    booking.over_4000,
    booking.local as LocalType | undefined,
  );
  scheduleFullSheetSyncProcess({
    resource: "booking_chain",
    operation: "booked_lead.update",
    bookingId: booking._id.toString(),
  });
  return {
    booking: await populateBookedLead(booking._id),
    message: "Booked lead updated.",
    warnings,
    total_binder_amount: booking.total_binder_amount,
  };
}

export async function findAllBookedLeads() {
  return BookedLead.find()
    .populate("customer")
    .populate("agent_allocations.agent")
    .sort({ createdAt: -1 })
    .limit(200);
}

export async function deleteBookedLead(id: string, cascade: boolean) {
  const booking = await BookedLead.findById(id);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  if (booking.is_referral_booking) {
    throw new V1ServiceError("Referral booking deletion is not supported yet", 409);
  }
  if (!booking.lead_ref || !booking.lead_model) {
    throw new V1ServiceError("Booked lead is missing linked lead metadata", 409);
  }
  if (booking.cancelled && !cascade) {
    throw new V1ServiceError("Booked lead has a cancellation; pass cascade=true to delete dependents", 409);
  }
  if (booking.cancelled && cascade) {
    await CancelledLead.findByIdAndDelete(booking.cancelled);
  }
  await clearBookingFromLead(booking.lead_model as LeadModelName, booking.lead_ref.toString());
  await deleteBookedLeadFromSheets(booking);
  await booking.deleteOne();
}

/**
 * Loads a booked lead with the populated relations expected by route
 * responses. Throws via `orFail` to propagate the standard mongoose error
 * when the document disappears between writes.
 */
export async function populateBookedLead(id: mongoose.Types.ObjectId) {
  return BookedLead.findById(id).populate("customer").populate("agent_allocations.agent").orFail();
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}
