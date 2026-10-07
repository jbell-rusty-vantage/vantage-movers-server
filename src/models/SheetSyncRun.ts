import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { SHEET_SYNC_RUN_STATUSES, SHEET_SYNC_RUN_TRIGGERS } from "../config/domain";

/**
 * Drainer-level history. One document per drain invocation (queue wake-up,
 * cron safety net, admin retry, or script). Holds the run-level counters and
 * quota/error summaries used by the admin health surface.
 */
const SheetSyncRunSchema = new Schema(
  {
    trigger: { type: String, enum: SHEET_SYNC_RUN_TRIGGERS, required: true },
    status: {
      type: String,
      enum: SHEET_SYNC_RUN_STATUSES,
      required: true,
      default: "running",
    },
    started_at: { type: Date, required: true, default: Date.now },
    finished_at: { type: Date },
    claimed_job_count: { type: Number, required: true, default: 0 },
    synced_job_count: { type: Number, required: true, default: 0 },
    failed_job_count: { type: Number, required: true, default: 0 },
    deferred_job_count: { type: Number, required: true, default: 0 },
    quota_summary: { type: Schema.Types.Mixed },
    error_summary: { type: String, trim: true },
  },
  {
    collection: "sheet_sync_runs",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

SheetSyncRunSchema.index({ started_at: -1 });
SheetSyncRunSchema.index({ status: 1, started_at: -1 });
/**
 * Disk trim (2026-10-07): the admin run list reads the newest page only, so a
 * run expires 90 days after it started. The outbox (`sheet_sync_jobs`) has no
 * TTL; this is history, not work.
 */
export const SHEET_SYNC_RUN_RETENTION_SECONDS = 90 * 24 * 60 * 60;
export const SHEET_SYNC_RUN_TTL_INDEX = {
  name: "sheet_sync_run_started_ttl",
  key: { started_at: 1 } as const,
  expireAfterSeconds: SHEET_SYNC_RUN_RETENTION_SECONDS,
};
SheetSyncRunSchema.index(SHEET_SYNC_RUN_TTL_INDEX.key, {
  name: SHEET_SYNC_RUN_TTL_INDEX.name,
  expireAfterSeconds: SHEET_SYNC_RUN_TTL_INDEX.expireAfterSeconds,
});

export type SheetSyncRunDocument = InferSchemaType<typeof SheetSyncRunSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SheetSyncRun: Model<SheetSyncRunDocument> =
  mongoose.models.SheetSyncRun ??
  mongoose.model<SheetSyncRunDocument>("SheetSyncRun", SheetSyncRunSchema);
