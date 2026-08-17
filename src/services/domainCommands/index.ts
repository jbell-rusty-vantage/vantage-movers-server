import {
  attachBookingToLead,
  createBookingFromLead,
  createExistingReferralBooking,
  createLeadlessBooking,
  deleteBookedLead,
  updateBookedLead,
} from "./bookings";
import {
  createCancellation,
  deleteCancelledLead,
  updateCancelledLead,
} from "./cancellations";
import {
  createCallLead,
  createFormLead,
  deleteCallLead,
  deleteFormLead,
  updateSourceOwnedLead,
} from "./leads";
import type { CanonicalDomainCommands } from "./types";

export * from "./bookings";
export * from "./cancellations";
export * from "./existingWriteContext";
export * from "./existingWrites";
export * from "./idempotency";
export * from "./leads";
export * from "./types";

export const canonicalDomainCommands: CanonicalDomainCommands = {
  createFormLead,
  createCallLead,
  updateSourceOwnedLead,
  createBookingFromLead,
  createLeadlessBooking,
  attachBookingToLead,
  createCancellation,
};

export const existingWriteCanonicalCommands = {
  updateBookedLead,
  updateCancelledLead,
  createExistingReferralBooking,
  deleteFormLead,
  deleteCallLead,
  deleteBookedLead,
  deleteCancelledLead,
};
