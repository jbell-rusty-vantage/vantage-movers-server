import type { sheets_v4 } from "googleapis";
import { CALL_SHEET_HEADERS, FORM_SHEET_HEADERS } from "../../config/domain";
import { escapeSheetTitleForRange } from "../../utils/googleSheets/ranges";
import { withSheetsRetry } from "./retry";
import type { SheetTabConfig } from "./types";

const LEGACY_CALL_SHEET_HEADER_LENGTH = 18;
// Forms/Duplicates/Bad Leads previously carried 22 columns (before
// `Move Size`, `Lead ID`, and `Source Company Site` were removed). Clearing up
// to the legacy width self-heals stale trailing header cells on redeploy.
const LEGACY_FORM_SHEET_HEADER_LENGTH = 22;

/**
 * Tabs whose existence + header row have already been ensured in this process.
 *
 * Previously `ensureTabsAndHeaders` rewrote the header row of every tab on
 * every single row sync, which multiplied write requests (5+ wasted writes per
 * source-sheet sync) and blew through the Sheets per-minute write quota during
 * bursts — leaving later targets (notably source sheets) failing with 429 while
 * the master sheet, written first, still succeeded. Headers effectively never
 * change at runtime, so ensuring each tab at most once per process removes the
 * amplification while still self-healing across cold starts.
 */
const ensuredTabs = new Set<string>();

function ensuredTabKey(spreadsheetId: string, tabName: string): string {
  return `${spreadsheetId}:${tabName}`;
}

/** Test/maintenance helper to force re-ensuring on the next sync. */
export function resetEnsuredTabsCache(): void {
  ensuredTabs.clear();
}

export async function ensureTabsAndHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: SheetTabConfig[],
): Promise<void> {
  for (const tab of tabs) {
    const cacheKey = ensuredTabKey(spreadsheetId, tab.tabName);
    if (ensuredTabs.has(cacheKey)) {
      continue;
    }

    await ensureTab(sheets, spreadsheetId, tab.tabName);
    await clearLegacyTrailingCells(sheets, spreadsheetId, tab.tabName, tab.headers, 1);
    await withSheetsRetry("values.update.headers", () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${escapeSheetTitleForRange(tab.tabName)}!A1:${columnLetter(tab.headers.length)}1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[...tab.headers]] },
      }),
    );
    ensuredTabs.add(cacheKey);
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
  if (headers === CALL_SHEET_HEADERS) {
    return LEGACY_CALL_SHEET_HEADER_LENGTH;
  }
  if (headers === FORM_SHEET_HEADERS) {
    return LEGACY_FORM_SHEET_HEADER_LENGTH;
  }
  return headers.length;
}

async function clearSheetValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  await withSheetsRetry("values.clear", () =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    }),
  );
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
    const response = await withSheetsRetry("batchUpdate.addSheet", () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      }),
    );
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
  const response = await withSheetsRetry("spreadsheets.get", () =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    }),
  );
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
