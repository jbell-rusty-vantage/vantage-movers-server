import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Per-target (spreadsheet/tab) lease used to bound parallelism so two
 * concurrent drains never write the same tab at once. A lease is held while
 * `leased_until` is in the future; an expired lease is freely reclaimable.
 * Keyed uniquely by `scope` (e.g. `<spreadsheetId>:<tabName>`).
 */
const SheetSyncLeaseSchema = new Schema(
  {
    scope: { type: String, required: true, trim: true, unique: true },
    lease_owner: { type: String, trim: true },
    leased_until: { type: Date, required: true },
  },
  {
    collection: "sheet_sync_leases",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

SheetSyncLeaseSchema.index({ leased_until: 1 });

export type SheetSyncLeaseDocument = InferSchemaType<
  typeof SheetSyncLeaseSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const SheetSyncLease: Model<SheetSyncLeaseDocument> =
  mongoose.models.SheetSyncLease ??
  mongoose.model<SheetSyncLeaseDocument>("SheetSyncLease", SheetSyncLeaseSchema);
