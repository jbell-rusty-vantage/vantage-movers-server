import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";

export const CPL_BUSINESS_TIME_ZONE = "America/New_York" as const;

const CplActorSnapshotSchema = new Schema(
  {
    actor_type: {
      type: String,
      required: true,
      enum: ["owner", "admin", "system"],
    },
    actor_id: { type: String, required: true, trim: true },
    actor_label: { type: String, required: true, trim: true },
    actor_role: { type: String, required: true, trim: true, lowercase: true },
  },
  { _id: false },
);

const CplRatePeriodSchema = new Schema(
  {
    source_granularity: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceGranularity",
      required: true,
      immutable: true,
    },
    amount_cents: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "amount_cents must be a non-negative safe integer",
      },
    },
    effective_from: { type: Date, required: true, immutable: true },
    effective_until: { type: Date, immutable: true },
    effective_from_date: {
      type: String,
      required: true,
      immutable: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    effective_until_date_exclusive: {
      type: String,
      immutable: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    business_timezone: {
      type: String,
      required: true,
      enum: [CPL_BUSINESS_TIME_ZONE],
      default: CPL_BUSINESS_TIME_ZONE,
      immutable: true,
    },
    schedule_revision: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "schedule_revision must be a positive safe integer",
      },
    },
    supersedes: {
      type: Schema.Types.ObjectId,
      ref: "CplRatePeriod",
      immutable: true,
    },
    change_reason: { type: String, trim: true },
    archived_at: { type: Date },
    created_by: {
      type: CplActorSnapshotSchema,
      required: true,
      immutable: true,
    },
  },
  {
    collection: "cpl_rate_periods",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

CplRatePeriodSchema.index({ source_granularity: 1, effective_from: 1 });
CplRatePeriodSchema.index({ source_granularity: 1, effective_until: 1 });
CplRatePeriodSchema.index({ source_granularity: 1, archived_at: 1 });

export type CplRatePeriodDocument = InferSchemaType<
  typeof CplRatePeriodSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const CplRatePeriod: Model<CplRatePeriodDocument> =
  mongoose.models.CplRatePeriod ??
  mongoose.model<CplRatePeriodDocument>(
    "CplRatePeriod",
    CplRatePeriodSchema,
  );

export function getCplRatePeriodModel(): Model<CplRatePeriodDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return CplRatePeriod;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.CplRatePeriod as Model<CplRatePeriodDocument> | undefined) ??
    db.model<CplRatePeriodDocument>("CplRatePeriod", CplRatePeriodSchema)
  );
}
