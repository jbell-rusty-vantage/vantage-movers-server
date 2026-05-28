import type mongoose from "mongoose";
import type { LeadModelName } from "../../config/domain";
import { getLinkedLead } from "../leads";
import { syncSourceLead } from "../sheetSync";

/**
 * Writes the cancellation reference back onto its source lead.
 *
 * Loads the linked form/call lead and stamps `cancelled` with the new
 * cancellation id. Behavior matches the original `v1.service.ts`
 * implementation: the source lead retains its `booked` reference because
 * the cancellation lives alongside the booking, not in place of it.
 */
export async function mirrorCancellationToLead(
  leadModel: LeadModelName,
  leadId: string,
  cancellationId: mongoose.Types.ObjectId,
) {
  const lead = await getLinkedLead(leadModel, leadId);
  lead.cancelled = cancellationId;
  await lead.save();
}

/**
 * Clears `cancelled` from the source lead pointed at by a cancellation.
 *
 * Invoked from the cancellation delete path. `syncAfterClear` defaults to
 * `true` so callers that only want to mutate state (e.g. the delete path
 * which schedules its own `syncBookingAndSource`/`syncSourceLeadById`
 * follow-up) can opt out. A missing `leadId` is treated as a no-op, which
 * preserves the original behavior for cancellations created without a
 * linked source lead.
 */
export async function clearCancellationFromLead(
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
