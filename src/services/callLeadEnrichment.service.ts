// --- Compatibility re-exports -------------------------------------------------
//
// Implementation moved to `api/services/enrichment/callLeadEnrichment.service.ts`
// as part of refactor plan 06. This file is kept so route-layer imports from
// `api/services/callLeadEnrichment.service` keep compiling. New code should
// import from `api/services/enrichment` instead.

export {
  previewCallLeadEnrichment,
  syncCallLeadEnrichment,
  type CallLeadEnrichmentResult,
  type CallLeadEnrichmentStatus,
  type CallLeadMatchMethod,
} from "./enrichment/callLeadEnrichment.service";
