import { getCallLeadReportingDecision } from "../leads/callLeadReportingDisposition";
import mongoose from "mongoose";
import {
  type LeadModelName,
  type SourceCompany,
} from "../../config/domain";
import { logger } from "../../logger";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { deleteRowsFromTargets } from "../googleSheets/deleteRows";
import { allFormLeadTargets, FORM_REPORTING_TARGET_KEYS, callLeadTargets, CALL_REPORTING_TARGET_KEYS } from "../googleSheets/leadReportingTargets";
import type { CallLeadSheetSource } from "../googleSheets/types";
import type { SyncableDocument } from "../googleSheets/types";
import {
  syncBookedLeadToSheets,
  syncCallLeadToSheets,
  syncCancelledLeadToSheets,
  syncFormLeadToSheets,
} from "../googleSheets.service";
import { getLinkedLead } from "../leads/sourceLeadLookup.service";
import { noSyncAppliesToNormalTabs } from "./noSyncLead";
import {
  syncAndStore,
  type SheetSyncDocument,
  type SheetSyncUpdateEntry,
} from "./sheetSyncPersistence";

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

  if (!booking.lead_ref || !booking.lead_model) {
    await syncBookedLeadById(bookingId);
    return;
  }

  await syncBookingAndSource(
    booking._id,
    booking.lead_model as LeadModelName,
    booking.lead_ref.toString(),
  );
}

/**
 * Syncs only the booked-lead row. Used by leadless referral bookings and by
 * booking-chain fallback when a legacy/leadless booking has no source lead.
 */
export async function syncBookedLeadById(bookingId: string): Promise<void> {
  const booking = await BookedLead.findById(bookingId)
    .populate("customer")
    .populate("agent_allocations.agent");
  if (!booking) {
    logger.warn({ msg: "sheet_sync.booking_missing", bookingId });
    return;
  }
  await syncAndStore(booking as unknown as SheetSyncDocument, syncBookedLeadToSheets);
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
  if (
    noSyncAppliesToNormalTabs({
      _id: lead._id,
      created_on_unmatched: lead.get("created_on_unmatched") as boolean | null | undefined,
      no_sync: lead.get("no_sync") as boolean | null | undefined,
      duplicate: lead.get("duplicate") as boolean | null | undefined,
      bad_lead: lead.get("bad_lead"),
      ringcentral: lead.get("ringcentral"),
      external_call_admission: lead.get("external_call_admission"),
      source_company: lead.get("source_company"),
      lead_source_company: lead.get("lead_source_company"),
      source_granularity_id: lead.get("source_granularity_id"),
      timestamp: lead.get("timestamp"),
      form_fill: lead.get("form_fill") as boolean | null | undefined,
      external_sheet_review: lead.get("external_sheet_review"),
    })
  ) {
    await syncAndStore(lead, (doc) => deleteOrdinaryNoSyncLeadRows(doc, leadModel));
    return;
  }
  if (leadModel === "CallLead") {
    if (lead.get("created_on_unmatched") === true) {
      logger.info({
        msg: "sheet_sync.call_lead.created_on_unmatched.skipped",
        leadId: lead._id.toString(),
      });
      return;
    }
    if (getCallLeadReportingDecision(lead).disposition === "excluded") return;
    await lead.populate({ path: "booked", populate: { path: "customer" } });
    await syncAndStore(lead, syncCallLeadToSheets);
    return;
  }

  await lead.populate({ path: "booked", populate: { path: "customer" } });
  await syncAndStore(lead, syncFormLeadToSheets);
}

async function deleteOrdinaryNoSyncLeadRows(
  lead: SheetSyncDocument,
  leadModel: LeadModelName,
): Promise<SheetSyncUpdateEntry[]> {
  const sourceCompany = lead.get("source_company") as SourceCompany;
  const isForm = leadModel === "FormLead";
  const deletedTargets = await deleteRowsFromTargets(
    lead as unknown as SyncableDocument,
    isForm ? allFormLeadTargets(sourceCompany) : callLeadTargets(lead as unknown as CallLeadSheetSource, true),
    isForm ? FORM_REPORTING_TARGET_KEYS : CALL_REPORTING_TARGET_KEYS,
  );
  return deletedTargets.map((target) => ({ target, status: "deleted" as const }));
}
