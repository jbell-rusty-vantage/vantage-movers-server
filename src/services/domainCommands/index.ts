import {
  attachBookingToLead,
  createBookingFromLead,
  createLeadlessBooking,
} from "./bookings";
import { createCancellation } from "./cancellations";
import {
  createCallLead,
  createFormLead,
  updateSourceOwnedLead,
} from "./leads";
import type { CanonicalDomainCommands } from "./types";

export * from "./bookings";
export * from "./cancellations";
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
