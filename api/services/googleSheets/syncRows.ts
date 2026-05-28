import { logger } from "../../logger";
import type { SheetSyncEntry } from "../../models/schemaHelpers";
import {
  formatGoogleApiError,
  redactSpreadsheetId,
  resolveAuthConfigSummary,
} from "./diagnostics";
import { getSheetsClient } from "./auth";
import { upsertRow } from "./rowLookup";
import { ensureTabsAndHeaders } from "./tabs";
import type { SyncableDocument, SyncTarget } from "./types";

export async function syncRowToTargets(
  document: SyncableDocument,
  targets: SyncTarget[],
  row: string[],
): Promise<SheetSyncEntry[]> {
  const sheets = getSheetsClient();
  const authSummary = resolveAuthConfigSummary();
  const documentId = document._id.toString();
  const results: SheetSyncEntry[] = [];

  logger.info({
    msg: "sheets.sync.started",
    documentId,
    targetCount: targets.length,
    targets: targets.map((target) => ({
      target: target.target,
      spreadsheetId: redactSpreadsheetId(target.spreadsheetId),
      tabName: target.tabName,
    })),
    clientEmail: authSummary.clientEmail ?? null,
  });

  for (const target of targets) {
    try {
      await ensureTabsAndHeaders(sheets, target.spreadsheetId, target.ensureTabs);
      const existingSync = document.sheet_sync?.find((entry) => entry.target === target.target);
      const rowNumber = await upsertRow(
        sheets,
        target.spreadsheetId,
        target.tabName,
        target.headers,
        row,
        documentId,
        existingSync?.row_number,
      );
      results.push({
        target: target.target,
        spreadsheet_id: target.spreadsheetId,
        tab_name: target.tabName,
        row_number: rowNumber,
        status: "synced",
        last_synced_at: new Date(),
        updated_since_last_sync: false,
      });
      logger.info({
        msg: "sheets.sync.target.ok",
        documentId,
        target: target.target,
        spreadsheetId: redactSpreadsheetId(target.spreadsheetId),
        tabName: target.tabName,
        rowNumber: rowNumber ?? null,
      });
    } catch (error) {
      const details = formatGoogleApiError(error);
      const lastError = details.hint ? `${details.message} — ${details.hint}` : details.message;

      logger.error(
        {
          err: error,
          msg: "sheets.sync.target.failed",
          documentId,
          target: target.target,
          spreadsheetId: redactSpreadsheetId(target.spreadsheetId),
          tabName: target.tabName,
          clientEmail: authSummary.clientEmail ?? null,
          googleCode: details.code ?? null,
          googleStatus: details.status ?? null,
          googleReasons: details.reasons,
          hint: details.hint ?? null,
          lastError,
        },
        "Google Sheets sync failed for target",
      );

      results.push({
        target: target.target,
        spreadsheet_id: target.spreadsheetId,
        tab_name: target.tabName,
        status: "failed",
        last_error: lastError,
        updated_since_last_sync: true,
      });
    }
  }

  const failed = results.filter((entry) => entry.status === "failed").length;
  logger.info({
    msg: "sheets.sync.finished",
    documentId,
    synced: results.length - failed,
    failed,
  });

  return results;
}
