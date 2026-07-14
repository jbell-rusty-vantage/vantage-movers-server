import { Schema } from "mongoose";
import {
  LEAD_MODELS,
  LOCAL_TYPES,
  SHEET_SYNC_STATUSES,
} from "../config/domain";

export const sourceCompanyField = {
  type: String,
  required: true,
  default: "not_provided",
  index: true,
} as const;

export const localField = {
  type: String,
  enum: LOCAL_TYPES,
  required: true,
  index: true,
} as const;

export const optionalLocalField = {
  type: String,
  enum: LOCAL_TYPES,
  index: true,
} as const;

export const leadModelField = {
  type: String,
  enum: LEAD_MODELS,
  required: true,
  index: true,
} as const;

export const sheetSyncSchema = new Schema(
  {
    target: {
      type: String,
      required: true,
      trim: true,
    },
    spreadsheet_id: {
      type: String,
      required: true,
      trim: true,
    },
    tab_name: {
      type: String,
      required: true,
      trim: true,
    },
    row_number: {
      type: Number,
    },
    status: {
      type: String,
      enum: SHEET_SYNC_STATUSES,
      required: true,
      default: "pending",
    },
    last_synced_at: {
      type: Date,
    },
    last_error: {
      type: String,
      trim: true,
    },
    updated_since_last_sync: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { _id: false },
);

export type SheetSyncEntry = {
  target: string;
  spreadsheet_id: string;
  tab_name: string;
  row_number?: number;
  status: "pending" | "synced" | "failed";
  last_synced_at?: Date;
  last_error?: string;
  updated_since_last_sync: boolean;
};

export function removeSheetSyncEntries(
  existing: SheetSyncEntry[] | undefined,
  targets: readonly string[],
): SheetSyncEntry[] {
  const targetSet = new Set(targets);
  return (existing ?? []).filter((entry) => !targetSet.has(entry.target));
}

export function mergeSheetSyncEntries(
  existing: SheetSyncEntry[] | undefined,
  updates: SheetSyncEntry[],
): SheetSyncEntry[] {
  const byTarget = new Map<string, SheetSyncEntry>();
  for (const entry of existing ?? []) {
    byTarget.set(entry.target, entry);
  }
  for (const entry of updates) {
    byTarget.set(entry.target, entry);
  }

  return [...byTarget.values()];
}
