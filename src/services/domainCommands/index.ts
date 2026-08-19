import {
  attachBookingToLead,
  createBookingFromLead,
  createExistingReferralBooking,
  createLeadlessBooking,
  deleteBookedLead,
  updateBookedLead,
  updateBooking,
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
import { createLeadFromGranot } from "../granotLifecycle/createLeadFromGranot";
import { synchronizeLeadFromGranot } from "../granotLifecycle/synchronizeLeadFromGranot";
import {
  adoptRingCentralCall,
  markRingCentralConvergenceConflict,
} from "../ringcentral/callLeadConvergence.service";
import type { CanonicalDomainCommands } from "./types";

export * from "./bookings";
export * from "./cancellations";
export * from "./existingWriteContext";
export * from "./existingWrites";
export * from "./idempotency";
export * from "./leads";
export * from "./types";
export { createLeadFromGranot } from "../granotLifecycle/createLeadFromGranot";
export {
  adoptRingCentralCall,
  markRingCentralConvergenceConflict,
} from "../ringcentral/callLeadConvergence.service";

export const canonicalDomainCommands: CanonicalDomainCommands = {
  createFormLead,
  createCallLead,
  updateSourceOwnedLead,
  createBookingFromLead,
  createLeadlessBooking,
  attachBookingToLead,
  createCancellation,
  createLeadFromGranot,
  synchronizeLeadFromGranot,
  updateBooking,
  adoptRingCentralCall,
  markRingCentralConvergenceConflict,
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
