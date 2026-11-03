import { getCallLeadReportingDecision } from "../leads/callLeadReportingDisposition";
import { hasFormBadProjection } from "../googleSheets/leadReportingTargets";
/**
 * Shared No-Sync Lead predicates for Sheet Sync planner, legacy sync, and
 * Owner contains. Only `no_sync === true` excludes. Missing / false / null
 * stay syncable.
 */

export function isNoSyncLead(lead: { no_sync?: boolean | null }): boolean {
  return lead.no_sync === true;
}

export function noSyncAppliesToNormalTabs(lead: {
  no_sync?: boolean | null;
  duplicate?: boolean | null;
  bad_lead?: unknown;
  ringcentral?: unknown;
  external_call_admission?: unknown;
  source_company?: unknown;
  lead_source_company?: unknown;
  source_granularity_id?: unknown;
  form_fill?: boolean | null;
  external_sheet_review?: unknown;
  timestamp?: unknown;
}): boolean {
  if (lead.no_sync !== true) return false;
  if (lead.duplicate === true) return false;
  if (hasFormBadProjection(lead)) return false;
  const disposition = getCallLeadReportingDecision(lead).disposition;
  if (disposition === "duplicate_calls" || disposition === "bad_call_leads") return false;
  return true;
}
