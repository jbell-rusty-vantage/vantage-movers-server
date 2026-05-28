/**
 * Public barrel for the search service folder.
 *
 * The two services here are read-only lookups that back the v1 search
 * endpoints. They are exposed as the route-facing API and re-exported by
 * the legacy `api/services/formLeadSearch.service.ts` /
 * `api/services/callLeadSearch.service.ts` facades for backward
 * compatibility.
 */

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
} from "./formLeadSearch.service";

export {
  searchCallLeads,
  summarizeCallLead,
  type CallLeadSearchSummary,
} from "./callLeadSearch.service";
