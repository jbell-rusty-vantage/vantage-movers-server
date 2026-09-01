import { getRequiredEnv } from "./runtime";

export const TARIFF_SHEET_ENV_VAR = "TARIFF_SHEET_ID";
export const TARIFF_SHEET_TAB_NAME = "TARIFFS";

export const TARIFF_SHEET_HEADERS = [
  "Effective Date",
  "Pickup Zone",
  "Delivery Zone",
  "Service",
  "Rule",
  "New Rule",
  "Carrier",
] as const;

export type TariffSheetHeader = (typeof TARIFF_SHEET_HEADERS)[number];

export function getTariffSheetId(): string {
  return getRequiredEnv(TARIFF_SHEET_ENV_VAR);
}
