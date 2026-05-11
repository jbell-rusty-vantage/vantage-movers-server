const INVALID_SHEET_TITLE_CHARS = /[\\/?*[\]:]/g;
const MAX_SHEET_TITLE_LENGTH = 100;
const LEADS_SUFFIX = " - Leads";

export function sanitizeSheetName(value: string): string {
  const sanitized = value.replace(INVALID_SHEET_TITLE_CHARS, "").trim();
  return sanitized || "Unknown Source";
}

export function getCompanyLeadSheetName(sourceCompanySite: string): string {
  const baseNameMaxLength = MAX_SHEET_TITLE_LENGTH - LEADS_SUFFIX.length;
  return `${sanitizeSheetName(sourceCompanySite).slice(0, baseNameMaxLength)}${LEADS_SUFFIX}`;
}
