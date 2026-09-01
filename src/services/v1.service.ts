// --- Compatibility re-exports -------------------------------------------------
//
// Route layers and other services historically imported these symbols from
// `api/services/v1.service.ts`. As the refactor moves implementations into
// dedicated folders, this facade keeps the original import paths working.
//
// Every domain in this file is now backed by a dedicated service folder
// under `api/services/`. New code should import directly from those folders;
// the re-exports below exist purely so the route layer and any in-flight
// branches keep compiling.

export { V1ServiceError } from "./v1ServiceError";

export {
  scheduleBookedLeadSheetSync,
  scheduleBookingChainSheetSync,
  scheduleCallLeadSheetSync,
} from "./sheetSync";

export {
  createCallLead,
  createFormLead,
  deleteCallLead,
  deleteFormLead,
  findAllCallLeads,
  findAllFormLeads,
  findFormLead,
  findFormLeadForEnrichment,
  ingestCallLead,
  ingestFormLead,
  correctCallLead,
  correctFormLead,
  listRecentCallLeads,
  removeCallLead,
  removeFormLead,
  updateCallLead,
  updateFormLead,
} from "./leads";

export {
  createBookedLead,
  createBookedLeadFromSource,
  createReferralBooking,
  createLeadlessBooking,
  deleteBookedLead,
  findAllBookedLeads,
  refreshAttachedBookingFromLead,
  updateBookedLead,
} from "./bookings";

export {
  createCancelledLead,
  deleteCancelledLead,
  findAllCancelledLeads,
  updateCancelledLead,
} from "./cancellations";

export {
  createCustomer,
  deleteCustomer,
  findAllCustomers,
  updateCustomer,
} from "./customers";
