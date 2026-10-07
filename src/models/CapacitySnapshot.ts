import mongoose, { Schema, type Model } from "mongoose";

/**
 * `capacity_snapshots` — one row per New York day (doc 11b, R2), written by `/api/cron/capacity-snapshot`.
 * The Systems capacity cards fit their growth rate to these rows. Unique on `day`, so a second run on the same
 * day writes nothing. No TTL: one small row a day is about 30 KB a year.
 */
export const CAPACITY_WORKBOOKS = ["master_leads", "master_booked"] as const;
export type CapacityWorkbook = (typeof CAPACITY_WORKBOOKS)[number];

export type CapacityDatabaseReading = {
  fs_used_bytes: number;
  fs_total_bytes: number;
  /** Storage plus indexes, summed over every database except `local` (the capped oplog is reported on its own). */
  data_bytes: number;
  oplog_storage_bytes: number;
  oplog_max_bytes: number;
};

export type CapacityTabReading = { name: string; filled_rows: number; grid_cells: number };
export type CapacitySheetReading = { workbook: CapacityWorkbook; grid_cells: number; tabs: CapacityTabReading[] };

export type CapacitySnapshotDocument = {
  _id: mongoose.Types.ObjectId;
  /** New York calendar date, `YYYY-MM-DD`. */
  day: string;
  taken_at: Date;
  database: CapacityDatabaseReading | null;
  sheets: CapacitySheetReading[];
};

const DatabaseSchema = new Schema(
  {
    fs_used_bytes: { type: Number, required: true },
    fs_total_bytes: { type: Number, required: true },
    data_bytes: { type: Number, required: true },
    oplog_storage_bytes: { type: Number, required: true },
    oplog_max_bytes: { type: Number, required: true },
  },
  { _id: false },
);

const TabSchema = new Schema(
  {
    name: { type: String, required: true },
    filled_rows: { type: Number, required: true },
    grid_cells: { type: Number, required: true },
  },
  { _id: false },
);

const SheetSchema = new Schema(
  {
    workbook: { type: String, required: true, enum: CAPACITY_WORKBOOKS },
    grid_cells: { type: Number, required: true },
    tabs: { type: [TabSchema], default: [] },
  },
  { _id: false },
);

const CapacitySnapshotSchema = new Schema(
  {
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    taken_at: { type: Date, required: true },
    database: { type: DatabaseSchema, default: null },
    sheets: { type: [SheetSchema], default: [] },
  },
  { collection: "capacity_snapshots", versionKey: false },
);

CapacitySnapshotSchema.index({ day: 1 }, { unique: true, name: "capacity_snapshot_day_unique" });

export const CapacitySnapshot: Model<CapacitySnapshotDocument> =
  (mongoose.models.CapacitySnapshot as Model<CapacitySnapshotDocument> | undefined) ??
  mongoose.model<CapacitySnapshotDocument>("CapacitySnapshot", CapacitySnapshotSchema);
