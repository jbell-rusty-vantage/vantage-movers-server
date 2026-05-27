import mongoose from "mongoose";
import { logger } from "../../logger";
import { mergeSheetSyncEntries, type SheetSyncEntry } from "../../models/schemaHelpers";

/**
 * Minimal mongoose document shape used by sheet sync persistence.
 *
 * Matches the previous `AnyDoc` shape in `v1.service.ts`: the function only
 * relies on `_id`, `sheet_sync`, mongoose `get`/`set`, and `save`. Keeping the
 * shape loose lets form, call, booked, and cancelled hydrated documents all
 * flow through without per-model casts at the call sites.
 */
export type SheetSyncDocument = mongoose.Document & {
  _id: mongoose.Types.ObjectId;
  sheet_sync?: unknown[];
  save(): Promise<unknown>;
};

export type SheetSyncFn = (doc: any) => Promise<SheetSyncEntry[]>;

/**
 * Runs a Google Sheets sync for a single document and persists the resulting
 * `sheet_sync` entries back onto the document.
 *
 * Preserves the original merge behavior: synced entries refresh row metadata,
 * failed entries retain failure state, and existing entries for targets that
 * were not touched by this sync are kept as-is.
 */
export async function syncAndStore(
  document: SheetSyncDocument,
  syncFn: SheetSyncFn,
): Promise<void> {
  const documentId = document._id.toString();
  const updates = await syncFn(document);
  document.set("sheet_sync", mergeSheetSyncEntries(document.get("sheet_sync"), updates));
  await document.save();

  const summary = updates.map((entry) => ({
    target: entry.target,
    status: entry.status,
    tabName: entry.tab_name,
    rowNumber: entry.row_number ?? null,
    lastError: entry.last_error ?? null,
  }));
  const failed = updates.filter((entry) => entry.status === "failed");

  if (failed.length > 0) {
    logger.warn({
      msg: "sheet_sync.document.partial_failure",
      documentId,
      failedTargets: failed.map((entry) => entry.target),
      sheetSync: summary,
    });
    return;
  }

  logger.info({
    msg: "sheet_sync.document.ok",
    documentId,
    sheetSync: summary,
  });
}
