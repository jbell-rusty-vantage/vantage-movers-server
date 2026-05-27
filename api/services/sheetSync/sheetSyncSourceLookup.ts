import mongoose from "mongoose";
import type { LeadModelName } from "../../config/domain";
import { logger } from "../../logger";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import {
  syncBookedLeadToSheets,
  syncCallLeadToSheets,
  syncCancelledLeadToSheets,
  syncFormLeadToSheets,
} from "../googleSheets.service";
import { getLinkedLead } from "../leads/sourceLeadLookup.service";
import { syncAndStore, type SheetSyncDocument } from "./sheetSyncPersistence";

/**
 * Looks up a source lead by id+model and runs its sheet sync.
 */
export async function syncSourceLeadById(
  leadModel: LeadModelName,
  leadId: string,
): Promise<void> {
  const lead = await getLinkedLead(leadModel, leadId);
  await syncSourceLead(lead, leadModel);
}

/**
 * Syncs a booking together with its linked source lead.
 *
 * This is the chain pushed for any booking-related event: the booked sheet
 * gets refreshed first, then the source (form/call) lead's sheet row is
 * refreshed so any mirrored booking fields stay aligned.
 */
export async function syncBookingChainById(bookingId: string): Promise<void> {
  const booking = await BookedLead.findById(bookingId);
  if (!booking) {
    logger.warn({ msg: "sheet_sync.booking_missing", bookingId });
    return;
  }

  await syncBookingAndSource(
    booking._id,
    booking.lead_model as LeadModelName,
    booking.lead_ref.toString(),
  );
}

/**
 * Syncs a cancellation chain: booking chain (which also handles the source
 * lead) followed by the cancellation row itself.
 */
export async function syncCancellationChainById(cancellationId: string): Promise<void> {
  const cancellation = await CancelledLead.findById(cancellationId);
  if (!cancellation) {
    logger.warn({ msg: "sheet_sync.cancellation_missing", cancellationId });
    return;
  }

  await syncBookingChainById(cancellation.booked_lead.toString());
  await syncAndStore(cancellation as unknown as SheetSyncDocument, syncCancelledLeadToSheets);
}

/**
 * Syncs the booked lead row followed by its linked source lead row. Used both
 * by the booking chain runner and by direct deletion-path side effects.
 */
export async function syncBookingAndSource(
  bookingId: mongoose.Types.ObjectId,
  leadModel: LeadModelName,
  leadId: string,
): Promise<void> {
  const booking = await BookedLead.findById(bookingId)
    .populate("customer")
    .populate("agent_allocations.agent")
    .orFail();
  await syncAndStore(booking as unknown as SheetSyncDocument, syncBookedLeadToSheets);
  const lead = await getLinkedLead(leadModel, leadId);
  await syncSourceLead(lead, leadModel);
}

/**
 * Syncs a single source lead document.
 *
 * Skips call leads created via the unmatched-booking path because they should
 * not appear in the call lead sheet until they receive real call data.
 */
export async function syncSourceLead(
  lead: SheetSyncDocument,
  leadModel: LeadModelName,
): Promise<void> {
  if (leadModel === "CallLead") {
    if (lead.get("created_on_unmatched") === true) {
      logger.info({
        msg: "sheet_sync.call_lead.created_on_unmatched.skipped",
        leadId: lead._id.toString(),
      });
      return;
    }
    await lead.populate({ path: "booked", populate: { path: "customer" } });
    await syncAndStore(lead, syncCallLeadToSheets);
    return;
  }

  await lead.populate({ path: "booked", populate: { path: "customer" } });
  await syncAndStore(lead, syncFormLeadToSheets);
}
