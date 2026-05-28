// --- Compatibility re-exports -------------------------------------------------
//
// Implementation moved to `api/services/search/formLeadSearch.service.ts` as
// part of refactor plan 06. This file is kept so route-layer imports from
// `api/services/formLeadSearch.service` keep compiling. New code should
// import from `api/services/search` instead.

export {
  searchFormLeads,
  type FormLeadSearchAmbiguousResult,
  type FormLeadSearchConfidence,
  type FormLeadSearchCriteria,
  type FormLeadSearchField,
  type FormLeadSearchFoundResult,
  type FormLeadSearchInput,
  type FormLeadSearchMatch,
  type FormLeadSearchNotFoundResult,
  type FormLeadSearchResult,
  type FormLeadSearchStatus,
} from "./search/formLeadSearch.service";
