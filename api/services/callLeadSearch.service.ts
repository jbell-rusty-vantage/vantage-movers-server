// --- Compatibility re-exports -------------------------------------------------
//
// Implementation moved to `api/services/search/callLeadSearch.service.ts` as
// part of refactor plan 06. This file is kept so route-layer imports from
// `api/services/callLeadSearch.service` keep compiling. New code should
// import from `api/services/search` instead.

export {
  searchCallLeads,
  summarizeCallLead,
  type CallLeadSearchSummary,
} from "./search/callLeadSearch.service";
