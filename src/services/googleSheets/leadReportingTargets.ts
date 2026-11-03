import { CALL_SHEET_HEADERS, FORM_SHEET_HEADERS, SHEET_TAB_NAMES, type SourceCompany } from "../../config/domain";
import { getCallLeadReportingDecision, hasTrustedExternalSheetReview } from "../leads/callLeadReportingDisposition";
import { getLeadTargets } from "./targets";
import type { SyncTarget } from "./types";

export const CALL_REPORTING_TARGETS = [
  { disposition: "calls", masterTarget: "master_calls", sourceTarget: "source_calls", tabName: SHEET_TAB_NAMES.calls },
  { disposition: "duplicate_calls", masterTarget: "master_duplicate_calls", sourceTarget: "source_duplicate_calls", tabName: SHEET_TAB_NAMES.duplicateCalls },
  { disposition: "bad_call_leads", masterTarget: "master_bad_calls", sourceTarget: "source_bad_calls", tabName: SHEET_TAB_NAMES.badCalls },
] as const;
export const CALL_REPORTING_TARGET_KEYS = CALL_REPORTING_TARGETS.flatMap((base) => [base.masterTarget, base.sourceTarget]);
export const FORM_REPORTING_TARGET_KEYS = ["master_forms", "source_forms", "master_duplicates", "source_duplicates", "master_bad_leads", "source_bad_leads"];

export function staleCallTargetKeys(lead: unknown): string[] {
  const disposition = getCallLeadReportingDecision(lead).disposition;
  return CALL_REPORTING_TARGETS.filter((base) => base.disposition !== disposition).flatMap((base) => [base.masterTarget, base.sourceTarget]);
}

export function callLeadTargets(lead: { source_company: SourceCompany | string }, all = false): SyncTarget[] {
  const disposition = getCallLeadReportingDecision(lead).disposition;
  return CALL_REPORTING_TARGETS.filter((base) => all || base.disposition === disposition)
    .flatMap((base) => getLeadTargets(base.masterTarget, base.sourceTarget, lead.source_company, base.tabName, CALL_SHEET_HEADERS));
}

export function hasFormBadProjection(lead: { bad_lead?: unknown; external_sheet_review?: unknown }): boolean {
  return Boolean(lead.bad_lead) || hasTrustedExternalSheetReview(lead.external_sheet_review, ["bad_form"]);
}

/** Transitional titles are delete-only. Writers provision canonical titles. */
export function allFormLeadTargets(sourceCompany: SourceCompany | string): SyncTarget[] {
  return [
    ["master_forms", "source_forms", SHEET_TAB_NAMES.forms],
    ["master_duplicates", "source_duplicates", SHEET_TAB_NAMES.duplicates],
    ["master_duplicates", "source_duplicates", "Duplicates"],
    ["master_bad_leads", "source_bad_leads", SHEET_TAB_NAMES.badLeads],
    ["master_bad_leads", "source_bad_leads", "Bad Leads"],
  ].flatMap(([master, source, title]) => getLeadTargets(master, source, sourceCompany, title, FORM_SHEET_HEADERS));
}
