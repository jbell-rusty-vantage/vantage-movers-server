import type { SheetSyncAttemptAction } from "../../../config/domain";

/**
 * A single sheet operation the drainer intends to perform for one document at
 * one target. The planner produces these; the batch writer groups them by
 * `spreadsheetId`+`tabName` and executes them with as few API calls as
 * possible.
 */
export type PlannedWrite = {
  /** SheetSyncJob id this write belongs to (for attempt linkage / status). */
  jobId: string;
  /** Stable document identity (`Model:id`) used to merge sheet_sync entries. */
  docKey: string;
  /** Mongo id string that identifies the row inside the tab. */
  mongoId: string;
  /** sheet_sync `target` key (e.g. `master_calls`). */
  target: string;
  spreadsheetId: string;
  tabName: string;
  headers: readonly string[];
  /** Row values for an upsert; ignored for deletes. */
  row: string[];
  /** Row number recorded on a prior sync, used as a fast-path / validation. */
  knownRowNumber?: number;
  op: "upsert" | "delete";
};

export type PlannedWriteOutcome = {
  write: PlannedWrite;
  status: "synced" | "failed" | "deferred";
  action: SheetSyncAttemptAction;
  rowNumber?: number;
  error?: string;
  readsUsed: number;
  writesUsed: number;
};
