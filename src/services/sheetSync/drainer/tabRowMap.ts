import type { sheets_v4 } from "googleapis";
import { escapeSheetTitleForRange } from "../../../utils/googleSheets/ranges";
import { withSheetsRetry } from "../../googleSheets/retry";

const SHEET_ROW_LOOKUP_END_COLUMN = "ZZ";

/**
 * Reads a tab once and builds a `Mongo ID -> 1-based row number` map.
 *
 * Batching all of a tab's row lookups into a single `values.get` is the core
 * read-quota saving versus the legacy per-row `findRowNumberByMongoId` scan
 * (which re-read the whole tab for every document). Callers pass the resulting
 * map to the batch writer so each known row is updated in place and only truly
 * new rows are appended.
 */
export type TabRowMap = Map<string, number> & { duplicateRows: Map<string, number[]>; idColumn?: number };

export async function buildTabRowMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  _headers: readonly string[],
  allowNewEmptyTab = false,
): Promise<TabRowMap> {
  const map = new Map<string, number>() as TabRowMap;
  map.duplicateRows = new Map();

  const response = await withSheetsRetry("values.get.tabMap", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A:${SHEET_ROW_LOOKUP_END_COLUMN}`,
    }),
  );
  const rows = response.data.values;
  if (allowNewEmptyTab && (rows === undefined || (Array.isArray(rows) && rows.length === 0))) return map;
  if (!Array.isArray(rows)) throw new Error("sheet_identity_rows_invalid");
  const header = rows[0];
  if (!Array.isArray(header) || header.filter((value) => value === "Mongo ID").length !== 1) {
    throw new Error("sheet_identity_header_invalid");
  }
  const mongoIdIndex = header.indexOf("Mongo ID");
  map.idColumn = mongoIdIndex;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row)) throw new Error("sheet_identity_rows_invalid");
    const rowNumber = index + 1;
    const candidate = row[mongoIdIndex];
    if (typeof candidate === "string" && candidate.length > 0) {
      if (map.has(candidate)) {
        map.duplicateRows.set(candidate, [...(map.duplicateRows.get(candidate) ?? []), rowNumber]);
      } else map.set(candidate, rowNumber);
    }
  }

  return map;
}
