import { CALL_SHEET_NAME, LEAD_SHEET_NAME } from "./sheetRows";

export const REQUIRED_SHEET_NAMES = [LEAD_SHEET_NAME, CALL_SHEET_NAME] as const;

export function getLeadSheetName(): typeof LEAD_SHEET_NAME {
  return LEAD_SHEET_NAME;
}

export function getCallSheetName(): typeof CALL_SHEET_NAME {
  return CALL_SHEET_NAME;
}
