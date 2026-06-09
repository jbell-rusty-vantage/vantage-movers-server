import mongoose from "mongoose";
import { logger } from "../../logger";
import {
  mergeSheetSyncEntries,
  removeSheetSyncEntries,
  type SheetSyncEntry,
} from "../../models/schemaHelpers";

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

export type SheetSyncDeleteEntry = { target: string; status: "deleted" };
export type SheetSyncUpdateEntry = SheetSyncEntry | SheetSyncDeleteEntry;
export type SheetSyncFn = (doc: any) => Promise<SheetSyncUpdateEntry[]>;

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
  const deletedTargets = updates
    .filter((entry): entry is SheetSyncDeleteEntry => entry.status === "deleted")
    .map((entry) => entry.target);
  const syncEntries = updates.filter(
    (entry): entry is SheetSyncEntry => entry.status !== "deleted",
  );
  const withoutDeleted = removeSheetSyncEntries(
    document.get("sheet_sync"),
    deletedTargets,
  );
  document.set("sheet_sync", mergeSheetSyncEntries(withoutDeleted, syncEntries));
  await document.save();

  const summary = syncEntries.map((entry) => ({
    target: entry.target,
    status: entry.status,
    tabName: entry.tab_name,
    rowNumber: entry.row_number ?? null,
    lastError: entry.last_error ?? null,
  }));
  const failed = syncEntries.filter((entry) => entry.status === "failed");

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
