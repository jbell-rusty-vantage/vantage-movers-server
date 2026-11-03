import { getSheetsClient } from "./auth";
import { assertLeadTargetWritesAllowed } from "../sheetSync/writerFence";
import { findRowNumbersByMongoId, deleteSheetRowsByNumbers } from "./rowLookup";
import { getDeleteTargets } from "./targets";
import { getExistingSheetId } from "./tabs";
import type { SyncableDocument, SyncTarget } from "./types";

export async function deleteRowsFromTargets(
  document: SyncableDocument,
  fallbackTargets: SyncTarget[],
  syncedTargets: readonly string[],
): Promise<string[]> {
  const targets = getDeleteTargets(document, fallbackTargets, syncedTargets);
  await assertLeadTargetWritesAllowed(targets);
  const sheets = getSheetsClient();
  const deletedTargets: string[] = [];
  for (const target of targets) {
    // A missing transitional title is a no-op. Do not auto-provision deletes.
    if (await getExistingSheetId(sheets, target.spreadsheetId, target.tabName) === undefined) continue;
    const rows = await findRowNumbersByMongoId(sheets, target.spreadsheetId, target.tabName, target.headers, document._id.toString());
    if (!rows.length) continue;
    await deleteSheetRowsByNumbers(sheets, target.spreadsheetId, target.tabName, rows);
    deletedTargets.push(target.target);
  }

  return deletedTargets;
}
