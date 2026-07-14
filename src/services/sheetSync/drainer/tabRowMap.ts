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
export async function buildTabRowMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const mongoIdIndex = headers.indexOf("Mongo ID");

  const response = await withSheetsRetry("values.get.tabMap", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A:${SHEET_ROW_LOOKUP_END_COLUMN}`,
    }),
  );
  const rows = response.data.values ?? [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    if (mongoIdIndex >= 0) {
      const candidate = row[mongoIdIndex];
      if (typeof candidate === "string" && candidate.length > 0) {
        map.set(candidate, rowNumber);
        continue;
      }
    }
    // Fall back to scanning the row for any cell that equals a Mongo id, which
    // tolerates legacy rows whose id landed in a shifted column.
    for (const cell of row) {
      if (typeof cell === "string" && /^[a-f0-9]{24}$/i.test(cell)) {
        if (!map.has(cell)) {
          map.set(cell, rowNumber);
        }
      }
    }
  }

  return map;
}
