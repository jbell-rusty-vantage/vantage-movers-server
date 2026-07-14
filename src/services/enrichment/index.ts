/**
 * Public barrel for the call lead enrichment service folder.
 *
 * The service performs preview/sync updates on existing call leads from
 * CRM (browser extension) rows. The route layer reaches it through the
 * legacy `api/services/callLeadEnrichment.service.ts` facade; new code
 * should import from this folder directly.
 */

export {
  previewCallLeadEnrichment,
  syncCallLeadEnrichment,
  type CallLeadEnrichmentResult,
  type CallLeadEnrichmentStatus,
  type CallLeadMatchMethod,
} from "./callLeadEnrichment.service";

export type {
  ParsedCallLeadEnrichmentRow,
  ParsedCallLeadEnrichmentRowWithWarnings,
} from "./callLeadEnrichmentRows";
