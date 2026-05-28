// --- Compatibility re-exports -------------------------------------------------
//
// Implementation moved to
// `api/services/reconciliation/bookedCallLeadReconciliation.service.ts` as
// part of refactor plan 06. This file is kept so route-layer imports from
// `api/services/bookedCallLeadReconciliation.service` keep compiling. New
// code should import from `api/services/reconciliation` instead.

export {
  previewBookedCallLeadReconciliation,
  syncBookedCallLeadReconciliation,
  type BookedCallLeadMatchMethod,
  type BookedCallLeadReconciliationResult,
  type BookedCallLeadReconciliationStatus,
} from "./reconciliation/bookedCallLeadReconciliation.service";
