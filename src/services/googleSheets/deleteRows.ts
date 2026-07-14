import type { sheets_v4 } from "googleapis";
import { getSheetsClient } from "./auth";
import { withSheetsRetry } from "./retry";
import { findRowNumberByMongoId, rowNumberContainsMongoId } from "./rowLookup";
import { getDeleteTargets } from "./targets";
import { getExistingSheetId } from "./tabs";
import type { SyncableDocument, SyncTarget } from "./types";

export async function deleteRowsFromTargets(
  document: SyncableDocument,
  fallbackTargets: SyncTarget[],
  syncedTargets: readonly string[],
): Promise<string[]> {
  const sheets = getSheetsClient();
  const targets = getDeleteTargets(document, fallbackTargets, syncedTargets);
  const deletedTargets: string[] = [];
  for (const target of targets) {
    const rowNumber =
      target.knownRowNumber &&
      (await rowNumberContainsMongoId(
        sheets,
        target.spreadsheetId,
        target.tabName,
        target.headers,
        document._id.toString(),
        target.knownRowNumber,
      ))
        ? target.knownRowNumber
        : await findRowNumberByMongoId(
            sheets,
            target.spreadsheetId,
            target.tabName,
            target.headers,
            document._id.toString(),
          );
    if (!rowNumber) {
      continue;
    }

    await deleteSheetRow(sheets, target.spreadsheetId, target.tabName, rowNumber);
    deletedTargets.push(target.target);
  }

  return deletedTargets;
}

async function deleteSheetRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
): Promise<void> {
  const sheetId = await getExistingSheetId(sheets, spreadsheetId, tabName);
  if (sheetId === undefined) {
    return;
  }

  await withSheetsRetry("batchUpdate.deleteRow", () =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowNumber - 1,
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    }),
  );
}
