import type mongoose from "mongoose";
import type { LeadModelName } from "../../config/domain";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import type {
  CreateCancelledLeadInput,
  UpdateCancelledLeadInput,
} from "../../validation/v1.validation";
import { primaryAgentName } from "../agents";
import { deleteCancelledLeadFromSheets } from "../googleSheets.service";
import {
  scheduleFullSheetSyncProcess,
  syncBookingAndSource,
  syncSourceLeadById,
} from "../sheetSync";
import { V1ServiceError } from "../v1ServiceError";
import {
  clearCancellationFromLead,
  mirrorCancellationToLead,
} from "./cancellationMirror.service";
import { resolveBookedLeadForCancellation } from "./cancellationResolver";

/**
 * Creates a cancellation against a resolved booked lead.
 *
 * Behavior preserved from `v1.service.ts`:
 *   - Resolves the booking via `resolveBookedLeadForCancellation` (which
 *     enforces the lead/booking match invariants).
 *   - Snapshots customer/job/agent/book-date/source fields off the
 *     populated booking so the cancellation record stays usable after the
 *     booking is mutated or deleted.
 *   - Sets `booking.cancelled = cancellation._id` and saves.
 *   - Mirrors `cancelled` onto the linked source lead.
 *   - Schedules a `cancellation_chain` sheet sync with the original
 *     operation tag `cancelled_lead.create`.
 */
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

/**
 * Patches a cancellation document and schedules a `cancellation_chain`
 * sheet sync tagged `cancelled_lead.update`. Throws 404 when the id is
 * unknown, matching the original behavior.
 */
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

/**
 * Deletes a cancellation and unwinds the state it owned.
 *
 * Behavior preserved from `v1.service.ts`:
 *   - 404 when the cancellation does not exist.
 *   - Deletes the cancellation row from Google Sheets first so the sheet
 *     state matches the impending Mongo write.
 *   - Unsets `cancelled` from the associated booking (when one is still
 *     present) using `$unset`, which mirrors the original implementation.
 *   - Clears `cancelled` from the linked source lead with the
 *     `syncAfterClear: false` flag so we batch the sync below.
 *   - Triggers a booking-chain sync when the booking still exists,
 *     otherwise a source-lead sync when only the lead reference is known.
 *   - Removes the cancellation document last so the upstream wipes settle
 *     even if the final delete fails.
 */
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
