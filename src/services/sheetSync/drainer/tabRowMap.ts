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
export type TabRowMap = Map<string, number> & { duplicateRows: Map<string, number[]> };

export async function buildTabRowMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
): Promise<TabRowMap> {
  const map = new Map<string, number>() as TabRowMap;
  map.duplicateRows = new Map();


  const response = await withSheetsRetry("values.get.tabMap", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A:${SHEET_ROW_LOOKUP_END_COLUMN}`,
    }),
  );
  const rows = response.data.values ?? [];
  const actualIdColumn = (rows[0] ?? []).indexOf("Mongo ID");
  const mongoIdIndex = actualIdColumn >= 0 ? actualIdColumn : headers.indexOf("Mongo ID");
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    if (mongoIdIndex >= 0) {
      const candidate = row[mongoIdIndex];
      if (typeof candidate === "string" && candidate.length > 0) {
        if (map.has(candidate)) {
          map.duplicateRows.set(candidate, [...(map.duplicateRows.get(candidate) ?? []), rowNumber]);
        } else map.set(candidate, rowNumber);
        continue;
      }
    }

  }

  return map;
}
