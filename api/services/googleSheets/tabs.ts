import type { sheets_v4 } from "googleapis";
import { CALL_SHEET_HEADERS } from "../../config/domain";
import { escapeSheetTitleForRange } from "../../utils/googleSheetsRanges";
import type { SheetTabConfig } from "./types";

const LEGACY_CALL_SHEET_HEADER_LENGTH = 18;

export async function ensureTabsAndHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: SheetTabConfig[],
): Promise<void> {
  for (const tab of tabs) {
    await ensureTab(sheets, spreadsheetId, tab.tabName);
    await clearLegacyTrailingCells(sheets, spreadsheetId, tab.tabName, tab.headers, 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tab.tabName)}!A1:${columnLetter(tab.headers.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[...tab.headers]] },
    });
  }
}

export async function clearLegacyTrailingCells(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  rowNumber: number,
): Promise<void> {
  const legacyHeaderLength = getLegacyHeaderLength(headers);
  if (legacyHeaderLength <= headers.length) {
    return;
  }

  await clearSheetValues(
    sheets,
    spreadsheetId,
    `${escapeSheetTitleForRange(tabName)}!${columnLetter(headers.length + 1)}${rowNumber}:${columnLetter(
      legacyHeaderLength,
    )}${rowNumber}`,
  );
}

function getLegacyHeaderLength(headers: readonly string[]): number {
  return headers === CALL_SHEET_HEADERS ? LEGACY_CALL_SHEET_HEADER_LENGTH : headers.length;
}

async function clearSheetValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
  });
}

async function ensureTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<number | undefined> {
  const existing = await getExistingSheetId(sheets, spreadsheetId, tabName);
  if (existing !== undefined) {
    return existing;
  }

  try {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    return response.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
  } catch (error) {
    if (!isGoogleSheetAlreadyExistsError(error)) {
      throw error;
    }
    return getExistingSheetId(sheets, spreadsheetId, tabName);
  }
}

export async function getExistingSheetId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<number | undefined> {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  return response.data.sheets?.find((sheet) => sheet.properties?.title === tabName)?.properties?.sheetId ?? undefined;
}

function isGoogleSheetAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  return status === 400 && message.toLowerCase().includes("already exists");
}

export function columnLetter(columnNumber: number): string {
  let letter = "";
  let n = columnNumber;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }

  return letter;
}
