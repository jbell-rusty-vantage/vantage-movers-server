/**
 * Public barrel for the reconciliation service folder.
 *
 * The service performs preview/sync reconciliation of Booked Jobs (and
 * Follow-Up Estimates with prior=5) rows against existing call leads and
 * bookings. The route layer reaches it through the legacy
 * `api/services/bookedCallLeadReconciliation.service.ts` facade; new code
 * should import from this folder directly.
 */

export {
  previewBookedCallLeadReconciliation,
  syncBookedCallLeadReconciliation,
  type BookedCallLeadMatchMethod,
  type BookedCallLeadReconciliationResult,
  type BookedCallLeadReconciliationStatus,
} from "./bookedCallLeadReconciliation.service";

export type {
  ParsedBookedCallLeadRow,
  ParsedBookedCallLeadRowWithWarnings,
} from "./bookedCallLeadRows";
