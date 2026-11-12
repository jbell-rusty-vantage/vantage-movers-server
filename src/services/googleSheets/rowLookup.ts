import { logger } from "../../logger";
import type { sheets_v4 } from "googleapis";
import {
  escapeSheetTitleForRange,
  extractRowNumberFromRange,
} from "../../utils/googleSheets/ranges";
import { withSheetsRetry } from "./retry";
import { clearLegacyTrailingCells, columnLetter, getExistingSheetId } from "./tabs";

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
  const rowNumbers = await findRowNumbersByMongoId(sheets, spreadsheetId, tabName, headers, mongoId);
  const rowNumber = rowNumbers[0];
  if (rowNumber) {
    await clearLegacyTrailingCells(sheets, spreadsheetId, tabName, headers, rowNumber);
    await withSheetsRetry("values.update.row", () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      }),
    );
    if (rowNumbers.length > 1) {
      await deleteSheetRowsByNumbers(sheets, spreadsheetId, tabName, rowNumbers.slice(1));
      logger.info({ msg: "sheets.duplicate_rows_repaired", mongoId, tabName, removed: rowNumbers.length - 1 });
    }
    return rowNumber;
  }

  const response = await withSheetsRetry("values.append.row", () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A:${columnLetter(headers.length)}`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    }),
  );

  const appended = extractRowNumberFromRange(response.data.updates?.updatedRange);
  if (appended === undefined) throw new Error("append_confirmation_missing");
  return appended;
}

export async function findRowNumberByMongoId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  mongoId: string,
): Promise<number | undefined> {
  return (await findRowNumbersByMongoId(sheets, spreadsheetId, tabName, headers, mongoId))[0];
}

export async function findRowNumbersByMongoId(
  sheets: sheets_v4.Sheets, spreadsheetId: string, tabName: string,
  headers: readonly string[], mongoId: string,
): Promise<number[]> {
  const response = await withSheetsRetry("values.get.lookup", () => sheets.spreadsheets.values.get({
    spreadsheetId, range: `${escapeSheetTitleForRange(tabName)}!A:${SHEET_ROW_LOOKUP_END_COLUMN}`,
  }));
  const rows = response.data.values ?? [];
  const mongoIdIndex = (rows[0] ?? []).indexOf("Mongo ID");
  const idColumn = mongoIdIndex >= 0 ? mongoIdIndex : headers.indexOf("Mongo ID");
  if (idColumn < 0) return [];
  return rows.flatMap((row, index) => index > 0 && row[idColumn] === mongoId ? [index + 1] : []);
}

export async function deleteSheetRowsByNumbers(sheets: sheets_v4.Sheets, spreadsheetId: string, tabName: string, rowNumbers: number[]): Promise<void> {
  if (!rowNumbers.length) return;
  const sheetId = await getExistingSheetId(sheets, spreadsheetId, tabName);
  if (sheetId === undefined) return;
  const ordered = [...new Set(rowNumbers)].sort((left, right) => right - left);
  // Keep each request bounded, with descending indices across chunks.
  for (let offset = 0; offset < ordered.length; offset += 100) {
    await withSheetsRetry("batchUpdate.deleteRows", () => sheets.spreadsheets.batchUpdate({
      spreadsheetId, requestBody: { requests: ordered.slice(offset, offset + 100).map((rowNumber) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber } } })) },
    }));
  }
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

  const response = await withSheetsRetry("values.get.rowCheck", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${SHEET_ROW_LOOKUP_END_COLUMN}${rowNumber}`,
    }),
  );
  const row = response.data.values?.[0] ?? [];
  return row[mongoIdIndex] === mongoId;
}
