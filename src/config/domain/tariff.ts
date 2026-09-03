import { getRequiredEnv } from "./runtime";

export const TARIFF_SHEET_ENV_VAR = "TARIFF_SHEET_ID";
export const TARIFF_SHEET_TAB_NAME = "Master";

// Live Master tab header for Rule includes a trailing space. Match it
// exactly so ensureTabsAndHeaders does not rewrite the Owner's header.
export const TARIFF_SHEET_HEADERS = [
  "Timestamp",
  "Effective Date",
  "Pickup Zone",
  "Delivery Zone",
  "Service",
  "Rule ",
  "New Rule",
  "Carrier",
] as const;

export type TariffSheetHeader = (typeof TARIFF_SHEET_HEADERS)[number];

export function getTariffSheetId(): string {
  return getRequiredEnv(TARIFF_SHEET_ENV_VAR);
}
