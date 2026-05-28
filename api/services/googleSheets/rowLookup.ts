import type { sheets_v4 } from "googleapis";
import {
  escapeSheetTitleForRange,
  extractRowNumberFromRange,
} from "../../utils/googleSheets/ranges";
import { clearLegacyTrailingCells, columnLetter } from "./tabs";

const SHEET_ROW_LOOKUP_END_COLUMN = "ZZ";

export async function upsertRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  row: string[],
  mongoId: string,
  knownRowNumber?: number,
): Promise<number | undefined> {
  const rowNumber =
    knownRowNumber &&
    (await rowNumberContainsMongoId(sheets, spreadsheetId, tabName, headers, mongoId, knownRowNumber))
      ? knownRowNumber
      : await findRowNumberByMongoId(sheets, spreadsheetId, tabName, headers, mongoId);
  if (rowNumber) {
    await clearLegacyTrailingCells(sheets, spreadsheetId, tabName, headers, rowNumber);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
    return rowNumber;
  }

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A:${columnLetter(headers.length)}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return extractRowNumberFromRange(response.data.updates?.updatedRange);
}

export async function findRowNumberByMongoId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  mongoId: string,
): Promise<number | undefined> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A:${SHEET_ROW_LOOKUP_END_COLUMN}`,
  });
  const rows = response.data.values ?? [];
  const mongoIdIndex = headers.indexOf("Mongo ID");
  if (mongoIdIndex < 0) {
    return undefined;
  }

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row[mongoIdIndex] === mongoId || row.includes(mongoId)) {
      return index + 1;
    }
  }

  return undefined;
}

export async function rowNumberContainsMongoId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  mongoId: string,
  rowNumber: number,
): Promise<boolean> {
  const mongoIdIndex = headers.indexOf("Mongo ID");
  if (mongoIdIndex < 0) {
    return false;
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${SHEET_ROW_LOOKUP_END_COLUMN}${rowNumber}`,
  });
  const row = response.data.values?.[0] ?? [];
  return row[mongoIdIndex] === mongoId || row.includes(mongoId);
}
