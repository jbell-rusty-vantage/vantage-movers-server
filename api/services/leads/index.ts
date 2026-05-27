/**
 * Public barrel for the leads service folder.
 *
 * Route-facing functions are exposed unchanged so `api/services/v1.service.ts`
 * can re-export them for backward compatibility. Shared helpers used by
 * booking, cancellation, and sheet sync code are also exposed here.
 */

export {
  createFormLead,
  deleteFormLead,
  findAllFormLeads,
  findFormLead,
  updateFormLead,
} from "./formLead.service";

export {
  createCallLead,
  deleteCallLead,
  findAllCallLeads,
  updateCallLead,
} from "./callLead.service";

export {
  buildPhoneRegex,
  findBestCallLeadMatchByPhone,
} from "./leadPhoneMatching";

export {
  deriveFormLeadLocal,
  deriveLocal,
  normalizeState,
  resolveOptionalLocation,
  resolveRequiredLocation,
} from "./leadLocation.service";

export { parseSourceCompany } from "./leadSourceCompany";

export {
  hasFormFillForCallLead,
  isDuplicateFormLead,
  markMatchingCallLeadsWithFormFill,
} from "./duplicateLead.service";

export {
  getLinkedLead,
  resolveSourceLeadById,
  type SourceLeadDocument,
} from "./sourceLeadLookup.service";
