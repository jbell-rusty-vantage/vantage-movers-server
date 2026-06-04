import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  SHEET_SYNC_ATTEMPT_ACTIONS,
  SHEET_SYNC_ATTEMPT_STATUSES,
} from "../config/domain";

/**
 * Target/batch-level outcome history for a sheet-sync run. One document per
 * target operation (lookup/update/append/delete/ensure_headers) so partial
 * failures and per-target retries are observable and auditable.
 */
const SheetSyncAttemptSchema = new Schema(
  {
    run_id: { type: Schema.Types.ObjectId, ref: "SheetSyncRun", required: true },
    job_id: { type: Schema.Types.ObjectId, ref: "SheetSyncJob" },
    target: { type: String, trim: true },
    spreadsheet_id: { type: String, trim: true },
    tab_name: { type: String, trim: true },
    action: { type: String, enum: SHEET_SYNC_ATTEMPT_ACTIONS, required: true },
    status: { type: String, enum: SHEET_SYNC_ATTEMPT_STATUSES, required: true },
    row_number: { type: Number },
    google_operation: { type: String, trim: true },
    google_status: { type: String, trim: true },
    google_reasons: { type: [String], default: [] },
    request_count_estimate: { type: Number },
    payload_bytes_estimate: { type: Number },
    error: { type: String, trim: true },
  },
  {
    collection: "sheet_sync_attempts",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

SheetSyncAttemptSchema.index({ run_id: 1, createdAt: 1 });
SheetSyncAttemptSchema.index({ job_id: 1, createdAt: 1 });
SheetSyncAttemptSchema.index({ status: 1, createdAt: -1 });

export type SheetSyncAttemptDocument = InferSchemaType<
  typeof SheetSyncAttemptSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const SheetSyncAttempt: Model<SheetSyncAttemptDocument> =
  mongoose.models.SheetSyncAttempt ??
  mongoose.model<SheetSyncAttemptDocument>(
    "SheetSyncAttempt",
    SheetSyncAttemptSchema,
  );
