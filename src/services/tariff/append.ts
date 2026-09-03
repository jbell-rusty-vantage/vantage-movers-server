import type { sheets_v4 } from "googleapis";
import {
  TARIFF_SHEET_HEADERS,
  TARIFF_SHEET_TAB_NAME,
  getTariffSheetId,
} from "../../config/domain/tariff";
import { toFloridaTimestamp } from "../../utils/easternTime";
import { escapeSheetTitleForRange } from "../../utils/googleSheets/ranges";
import { formatTimestamp } from "../googleSheets/projections/cells";
import { getSheetsClient } from "../googleSheets/auth";
import { withSheetsRetry } from "../googleSheets/retry";
import { columnLetter, ensureTabsAndHeaders } from "../googleSheets/tabs";
import { resolveTariffCarrierCell } from "./resolveCarrier";

export const TARIFF_SERVICES = ["Linehaul", "Additional Services"] as const;
export type TariffService = (typeof TARIFF_SERVICES)[number];

export type TariffAdjustmentRow = {
  effectiveDate: string;
  pickupZone: string;
  deliveryZone: string;
  service: TariffService;
  rule: string;
  newRule: string;
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
    now?: Date;
    resolveCarrier?: (granotCarrierCode: string) => Promise<string>;
  } = {},
): Promise<AppendTariffAdjustmentRowsResult> {
  if (rows.length === 0) {
    throw new Error("Tariff adjustment write requires at least one row");
  }

  const spreadsheetId = options.spreadsheetId ?? getTariffSheetId();
  const tabName = options.tabName ?? TARIFF_SHEET_TAB_NAME;
  const sheets = options.sheets ?? getSheetsClient();
  const timestamp = formatTimestamp(toFloridaTimestamp(options.now ?? new Date()));
  const resolveCarrier = options.resolveCarrier ?? resolveTariffCarrierCell;
  const carrierCells = await resolveCarrierCells(
    rows.map((row) => row.carrier),
    resolveCarrier,
  );
  const values = rows.map((row, index) =>
    toTariffSheetRow(
      { ...row, carrier: carrierCells[index] ?? row.carrier },
      timestamp,
    ),
  );

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

export function toTariffSheetRow(
  row: TariffAdjustmentRow,
  timestamp: string,
): string[] {
  return [
    timestamp,
    row.effectiveDate,
    row.pickupZone,
    row.deliveryZone,
    row.service,
    row.rule,
    row.newRule,
    row.carrier,
  ];
}

async function resolveCarrierCells(
  codes: string[],
  resolveCarrier: (granotCarrierCode: string) => Promise<string>,
): Promise<string[]> {
  const unique = [...new Set(codes)];
  const resolved = new Map<string, string>();
  for (const code of unique) {
    resolved.set(code, await resolveCarrier(code));
  }
  return codes.map((code) => resolved.get(code) ?? code);
}
