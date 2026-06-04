import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Mongo-backed token bucket for Google Sheets API quota. One document per
 * (`scope`, `op_class`, `window_start`) minute window; the drainer reserves
 * tokens with an atomic `$inc` and defers work when the configured budget is
 * exhausted instead of sleeping inside an invocation.
 *
 * `scope` distinguishes the binding service-account/user budget (`user`) from
 * the project budget (`project`). Documents auto-expire an hour after their
 * window so the collection stays small.
 */
const SheetSyncQuotaBucketSchema = new Schema(
  {
    scope: { type: String, required: true, trim: true },
    op_class: { type: String, enum: ["read", "write"], required: true },
    window_start: { type: Date, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  {
    collection: "sheet_sync_quota_buckets",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

SheetSyncQuotaBucketSchema.index(
  { scope: 1, op_class: 1, window_start: 1 },
  { unique: true },
);
// Auto-clean stale windows (1h after the window starts).
SheetSyncQuotaBucketSchema.index({ window_start: 1 }, { expireAfterSeconds: 3600 });

export type SheetSyncQuotaBucketDocument = InferSchemaType<
  typeof SheetSyncQuotaBucketSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const SheetSyncQuotaBucket: Model<SheetSyncQuotaBucketDocument> =
  mongoose.models.SheetSyncQuotaBucket ??
  mongoose.model<SheetSyncQuotaBucketDocument>(
    "SheetSyncQuotaBucket",
    SheetSyncQuotaBucketSchema,
  );
