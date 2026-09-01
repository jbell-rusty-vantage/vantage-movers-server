import type { sheets_v4 } from "googleapis";
import {
  TARIFF_SHEET_HEADERS,
  TARIFF_SHEET_TAB_NAME,
  getTariffSheetId,
} from "../../config/domain/tariff";
import { escapeSheetTitleForRange } from "../../utils/googleSheets/ranges";
import { getSheetsClient } from "../googleSheets/auth";
import { withSheetsRetry } from "../googleSheets/retry";
import { columnLetter, ensureTabsAndHeaders } from "../googleSheets/tabs";

export const TARIFF_SERVICES = ["Linehaul", "Additional Services"] as const;
export type TariffService = (typeof TARIFF_SERVICES)[number];

export type TariffAdjustmentRow = {
  effectiveDate: string;
  pickupZone: string;
  deliveryZone: string;
  service: TariffService;
  rule: string;
  newRule: string;
  // Granot Forms View Agent text for now. A Granot Agent → Moving Carrier
  // name+DOT map will be added later; do not invent a match here.
  carrier: string;
};

export type AppendTariffAdjustmentRowsResult = {
  spreadsheetId: string;
  tabName: string;
  appended: number;
  updatedRange?: string;
  rows: string[][];
};

export async function appendTariffAdjustmentRows(
  rows: TariffAdjustmentRow[],
  options: {
    sheets?: sheets_v4.Sheets;
    spreadsheetId?: string;
    tabName?: string;
  } = {},
): Promise<AppendTariffAdjustmentRowsResult> {
  if (rows.length === 0) {
    throw new Error("Tariff adjustment write requires at least one row");
  }

  const spreadsheetId = options.spreadsheetId ?? getTariffSheetId();
  const tabName = options.tabName ?? TARIFF_SHEET_TAB_NAME;
  const sheets = options.sheets ?? getSheetsClient();
  const values = rows.map(toTariffSheetRow);

  await ensureTabsAndHeaders(sheets, spreadsheetId, [
    { tabName, headers: TARIFF_SHEET_HEADERS },
  ]);

  const response = await withSheetsRetry("values.append.tariffRows", () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A:${columnLetter(TARIFF_SHEET_HEADERS.length)}`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    }),
  );

  return {
    spreadsheetId,
    tabName,
    appended: values.length,
    updatedRange: response.data.updates?.updatedRange ?? undefined,
    rows: values,
  };
}

export function toTariffSheetRow(row: TariffAdjustmentRow): string[] {
  return [
    row.effectiveDate,
    row.pickupZone,
    row.deliveryZone,
    row.service,
    row.rule,
    row.newRule,
    row.carrier,
  ];
}
