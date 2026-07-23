import mongoose, { type ClientSession } from "mongoose";
import {
  cplLeadTypeForModel,
  getCplForSource,
  type LeadModelName,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { logger } from "../../logger";
import { BookedLead } from "../../models/BookedLead";
import { upsertCustomerFromLead } from "../customers/customerFromLead.service";
import { getLinkedLead, type SourceLeadDocument } from "../leads";
import { syncSourceLead, type FullSheetSyncJob } from "../sheetSync";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";

/**
 * Re-evaluates a booked lead that hangs off a freshly mutated source lead.
 *
 * Used by the form/call lead update paths after they save the source lead.
 * Behavior preserved from `v1.service.ts`:
 *   - If the source lead has no `booked` reference, returns a `source_lead`
 *     sheet-sync job so the caller still refreshes the lead's row.
 *   - If the booking referenced by the lead cannot be loaded or its
 *     `lead_model`/`lead_ref` no longer match, logs a warning with the same
 *     `source_lead.update.booking_*` shape and falls back to a `source_lead`
 *     sync job.
 *   - Otherwise, upserts the customer derived from the new lead fields and
 *     mirrors `local` onto the booking when the lead has a non-empty value.
 *     Saves the booking only if something changed.
 *   - Returns a `booking_chain` job so the caller refreshes booking + source
 *     in one pass.
 */
export async function refreshAttachedBookingFromLead(
  lead: SourceLeadDocument,
  leadModel: LeadModelName,
  operation: string,
  session?: ClientSession,
): Promise<FullSheetSyncJob> {
  const sourceLeadJob: FullSheetSyncJob = {
    resource: "source_lead",
    operation,
    leadModel,
    leadId: lead._id.toString(),
  };
  if (!lead.booked) {
    return sourceLeadJob;
  }

  const bookingId = lead.booked.toString();
  const bookingQuery = BookedLead.findById(bookingId);
  const booking = await (session ? bookingQuery.session(session) : bookingQuery);
  if (!booking) {
    logger.warn({
      msg: "source_lead.update.booking_missing",
      operation,
      leadModel,
      leadId: lead._id.toString(),
      bookingId,
    });
    return sourceLeadJob;
  }

  const bookingLeadRef = booking.lead_ref?.toString();
  if (booking.lead_model !== leadModel || bookingLeadRef !== lead._id.toString()) {
    logger.warn({
      msg: "source_lead.update.booking_mismatch",
      operation,
      leadModel,
      leadId: lead._id.toString(),
      bookingId,
      bookingLeadModel: booking.lead_model,
      bookingLeadId: bookingLeadRef,
    });
    return sourceLeadJob;
  }

  let changed = false;
  const customer = await upsertCustomerFromLead(lead, session);
  if (customer && !sameObjectId(booking.customer, customer._id)) {
    booking.customer = customer._id;
    changed = true;
  }
  if (lead.local && booking.local !== lead.local) {
    booking.local = lead.local;
    changed = true;
  }
  if (changed) {
    await booking.save({ session });
  }

  return {
    resource: "booking_chain",
    operation,
    bookingId: booking._id.toString(),
  };
}

/**
 * Writes booking-side state back onto its source lead.
 *
 * Sets `booked`, `over_2000`, `over_4000`, optionally `source_company` and
 * `local`, and normally recomputes `cpl` from the resulting source company /
 * lead type / local triple. Reconciliation may preserve the existing CPL when
 * it is preserving the Lead's source assignment. Caller passes a hydrated lead document (and its
 * model name, so the correct granular CPL rate slot is used) so the save
 * happens on a single round-trip.
 */
export async function mirrorBookingToLead(
  lead: SourceLeadDocument,
  leadModel: LeadModelName,
  bookingId: mongoose.Types.ObjectId,
  over2000: boolean,
  over4000: boolean,
  local: LocalType | undefined,
  sourceCompany?: SourceCompany,
  session?: ClientSession,
  preserveExistingCpl = false,
) {
  lead.booked = bookingId;
  lead.over_2000 = over2000;
  lead.over_4000 = over4000;
  if (local) {
    lead.local = local;
  }
  const leadType = cplLeadTypeForModel(leadModel);
  if (sourceCompany) {
    const { resolution, assignment } = await resolveLeadSourceAssignment({
      value: sourceCompany,
      company_slug: sourceCompany,
      channel: leadType,
      local,
      source_site: lead.source_company_site,
    });
    Object.assign(lead, assignment);
    lead.cpl = resolution.granularity.cpl;
  } else if (!preserveExistingCpl) {
    lead.cpl = await getCplForSource(
      lead.source_company as SourceCompany,
      leadType,
      local,
    );
  }
  await lead.save({ session });
}

/**
 * Atomically claims an otherwise eligible Lead for a newly-created Booking.
 * Returns false when another request claimed/cancelled/quarantined the Lead
 * after candidate evaluation, allowing employee submission to stay leadless.
 */
export async function claimAvailableLeadForBooking(
  lead: SourceLeadDocument,
  leadModel: LeadModelName,
  bookingId: mongoose.Types.ObjectId,
  over2000: boolean,
  over4000: boolean,
  local: LocalType | undefined,
  session?: ClientSession,
): Promise<boolean> {
  const result = await (lead.constructor as any).updateOne(
    {
      _id: lead._id,
      $and: [
        { $or: [{ booked: null }, { booked: { $exists: false } }] },
        { $or: [{ cancelled: null }, { cancelled: { $exists: false } }] },
      ],
      duplicate: { $ne: true },
      ...(leadModel === "CallLead"
        ? { created_on_unmatched: { $ne: true } }
        : {}),
    },
    {
      $set: {
        booked: bookingId,
        over_2000: over2000,
        over_4000: over4000,
        ...(local ? { local } : {}),
      },
    },
    { session },
  );
  return result.modifiedCount === 1;
}

/**
 * Clears booking-side state from a source lead and triggers a sheet sync.
 *
 * Invoked from the booked-lead delete path. Also unsets `cancelled` because
 * deleting the booking implies the cancellation chain it owned is gone too;
 * cancellation-only clears go through `clearCancellationFromLead` in the
 * cancellation service so they retain `booked`.
 */
export async function clearBookingFromLead(
  leadModel: LeadModelName,
  leadId: string,
  options: { session?: ClientSession; syncAfterClear?: boolean } = {},
): Promise<SourceLeadDocument> {
  const { session, syncAfterClear = true } = options;
  const lead = await getLinkedLead(leadModel, leadId, session);
  lead.booked = undefined;
  lead.cancelled = undefined;
  lead.over_2000 = false;
  lead.over_4000 = false;
  await lead.save({ session });
  // In queued mode the caller enqueues a source-lead refresh job inside the
  // transaction instead of running an inline (non-transactional) sync.
  if (syncAfterClear) {
    await syncSourceLead(lead, leadModel);
  }
  return lead;
}

function sameObjectId(
  left: mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId } | string | null | undefined,
  right: mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId } | string | null | undefined,
): boolean {
  return objectIdToString(left) === objectIdToString(right);
}

function objectIdToString(
  value: mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId } | string | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }
  return value._id?.toString();
}
