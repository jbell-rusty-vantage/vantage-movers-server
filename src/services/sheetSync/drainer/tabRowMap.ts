import type { sheets_v4 } from "googleapis";
import { escapeSheetTitleForRange } from "../../../utils/googleSheets/ranges";
import { withSheetsRetry } from "../../googleSheets/retry";

import { columnLetter } from "../../googleSheets/tabs";

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
  headers: readonly string[],
  allowNewEmptyTab = false,
): Promise<TabRowMap> {
  const map = new Map<string, number>() as TabRowMap;
  map.duplicateRows = new Map();

  const title = escapeSheetTitleForRange(tabName);
  let idColumn = headers.indexOf("Mongo ID");
  if (idColumn < 0) throw new Error("sheet_identity_header_invalid");
  const readIdentity = async (columnIndex: number) => {
    const column = columnLetter(columnIndex + 1);
    const result = await withSheetsRetry("values.batchGet.tabIdentity", () =>
      sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [`${title}!1:1`, `${title}!${column}:${column}`] }),
    );
    const ranges = result.data.valueRanges;
    if (ranges?.length !== 2 || !ranges[0]?.range || !ranges[1]?.range) throw new Error("sheet_identity_rows_invalid");
    return { header: ranges[0].values?.[0], identities: ranges[1].values };
  };
  let { header, identities } = await readIdentity(idColumn);
  if (!header && !identities && allowNewEmptyTab) return map;
  if (!Array.isArray(header) || header.filter(value => value === "Mongo ID").length !== 1) throw new Error("sheet_identity_header_invalid");
  const actualColumn = header.indexOf("Mongo ID");
  if (actualColumn !== idColumn) {
    idColumn = actualColumn;
    ({ header, identities } = await readIdentity(idColumn));
    if (!Array.isArray(header) || header.indexOf("Mongo ID") !== idColumn || header.lastIndexOf("Mongo ID") !== idColumn) {
      throw new Error("sheet_identity_header_changed");
    }
  }
  if (!Array.isArray(identities) || identities[0]?.[0] !== "Mongo ID") throw new Error("sheet_identity_rows_invalid");
  map.idColumn = idColumn;
  for (let index = 1; index < identities.length; index += 1) {
    const row = identities[index];
    if (!Array.isArray(row) || row.length > 1) throw new Error("sheet_identity_rows_invalid");
    const rowNumber = index + 1;
    const candidate = row[0];
    if (typeof candidate === "string" && candidate.length > 0) {
      if (map.has(candidate)) {
        map.duplicateRows.set(candidate, [...(map.duplicateRows.get(candidate) ?? []), rowNumber]);
      } else map.set(candidate, rowNumber);
    }
  }

  return map;
}
