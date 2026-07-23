import type mongoose from "mongoose";
import { BookedLead, type BookedLeadDocument } from "../../models/BookedLead";
import type { CreateCancelledLeadInput } from "../../validation/v1.validation";
import { resolveSourceLeadById } from "../leads";
import { V1ServiceError } from "../v1ServiceError";

/**
 * Resolves the booked lead that a cancellation create request targets.
 *
 * Behavior preserved from `v1.service.ts`:
 *   - When the request supplies only `booked_lead`, fetches that booking
 *     directly via `getBookedLeadForCancellation`.
 *   - When neither identifier is supplied, throws 400.
 *   - When `lead_id` is supplied, resolves the source lead, requires that
 *     it has a `booked` reference (otherwise 409), and loads that booking.
 *   - If both `booked_lead` and `lead_id` are supplied and disagree on the
 *     booking id, throws 409 with the `booked_lead does not match the
 *     source lead booking` message.
 *   - When the source lead's `lead_model`/`_id` no longer match the
 *     booking's `lead_model`/`lead_ref`, throws 409 with
 *     `Booked lead does not match the source lead`.
 */
export async function resolveBookedLeadForCancellation(
  input: CreateCancelledLeadInput,
  session?: mongoose.ClientSession,
): Promise<mongoose.HydratedDocument<BookedLeadDocument>> {
  if (input.booked_lead && !input.lead_id) {
    return getBookedLeadForCancellation(input.booked_lead, session);
  }

  if (!input.lead_id) {
    throw new V1ServiceError("Either booked_lead or lead_id must be provided", 400);
  }

  const { lead, leadModel } = await resolveSourceLeadById(
    input.lead_id,
    session,
  );
  if (!lead.booked) {
    throw new V1ServiceError("Source lead is not booked", 409);
  }

  const booking = await getBookedLeadForCancellation(
    lead.booked.toString(),
    session,
  );
  if (input.booked_lead && booking._id.toString() !== input.booked_lead) {
    throw new V1ServiceError("booked_lead does not match the source lead booking", 409);
  }
  if (booking.lead_model !== leadModel || booking.lead_ref?.toString() !== lead._id.toString()) {
    throw new V1ServiceError("Booked lead does not match the source lead", 409);
  }

  return booking;
}

/**
 * Loads a booked lead by id with `customer` populated, enforcing the
 * cancellation-side invariants:
 *   - 404 when the booking does not exist.
 *   - 409 when the booking already has a cancellation attached.
 *
 * Used by `resolveBookedLeadForCancellation` and exposed so future callers
 * can reuse the exact lookup if they need it.
 */
export async function getBookedLeadForCancellation(
  bookedLeadId: string,
  session?: mongoose.ClientSession,
): Promise<mongoose.HydratedDocument<BookedLeadDocument>> {
  const booking = await BookedLead.findById(bookedLeadId)
    .session(session ?? null)
    .populate("customer");
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  if (booking.cancelled) {
    throw new V1ServiceError("Booked lead is already cancelled", 409);
  }
  const employeeLeadlessBooking =
    booking.booking_origin === "employee_booking" &&
    booking.is_leadless_booking === true;
  if (
    booking.is_referral_booking ||
    (!employeeLeadlessBooking &&
      (booking.is_leadless_booking || !booking.lead_ref || !booking.lead_model))
  ) {
    throw new V1ServiceError("Standalone booking cancellation is not supported yet", 409);
  }

  return booking;
}
