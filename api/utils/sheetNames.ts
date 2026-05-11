import { getCompanySourceBySite } from "./companySources";

const INVALID_SHEET_TITLE_CHARS = /[\\/?*[\]:]/g;
const MAX_SHEET_TITLE_LENGTH = 100;
const LEADS_SUFFIX = " - Leads";
const CALLS_SUFFIX = " - Calls";

export function sanitizeSheetName(value: string): string {
  const sanitized = value.replace(INVALID_SHEET_TITLE_CHARS, "").trim();
  return sanitized || "Unknown Source";
}

export function getCompanyLeadSheetName(sourceCompanySite: string): string {
  const source = getCompanySourceBySite(sourceCompanySite);
  return getCompanySheetName(source?.labels.leads ?? sourceCompanySite, LEADS_SUFFIX);
}

export function getCompanyCallSheetName(sourceCompanySite: string): string {
  const source = getCompanySourceBySite(sourceCompanySite);
  return getCompanySheetName(source?.labels.calls ?? sourceCompanySite, CALLS_SUFFIX);
}

function getCompanySheetName(label: string, suffix: string): string {
  const baseNameMaxLength = MAX_SHEET_TITLE_LENGTH - suffix.length;
  return `${sanitizeSheetName(label).slice(0, baseNameMaxLength)}${suffix}`;
}
