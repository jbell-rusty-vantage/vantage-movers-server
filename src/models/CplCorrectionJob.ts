import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";

export const CPL_CORRECTION_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type CplCorrectionJobStatus =
  (typeof CPL_CORRECTION_JOB_STATUSES)[number];

export const CPL_CORRECTION_LEAD_MODELS = ["FormLead", "CallLead"] as const;

export type CplCorrectionLeadModel =
  (typeof CPL_CORRECTION_LEAD_MODELS)[number];

const CplCorrectionActorSnapshotSchema = new Schema(
  {
    actor_type: {
      type: String,
      required: true,
      enum: ["owner", "admin", "system"],
    },
    actor_id: { type: String, required: true, trim: true },
    actor_label: { type: String, required: true, trim: true },
    actor_role: { type: String, required: true, trim: true, lowercase: true },
    request_id: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const CplCorrectionCursorSchema = new Schema(
  {
    lead_model: {
      type: String,
      required: true,
      enum: CPL_CORRECTION_LEAD_MODELS,
    },
    lead_id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const CplCorrectionReviewedTargetSchema = new Schema(
  {
    lead_model: {
      type: String,
      required: true,
      enum: CPL_CORRECTION_LEAD_MODELS,
    },
    lead_id: { type: Schema.Types.ObjectId, required: true },
    source_granularity_id: { type: Schema.Types.ObjectId, required: true },
    timestamp: { type: Date, required: true },
    cpl: { type: Number, required: true },
    cpl_rate_period: { type: Schema.Types.ObjectId, default: null },
    cpl_resolution_status: { type: String, default: null },
    cpl_resolved_at: { type: Date, default: null },
    cpl_resolution_version: { type: String, default: null },
    duplicate: { type: Boolean, default: false },
  },
  { _id: false },
);

const CplCorrectionJobSchema = new Schema(
  {
    source_granularity: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceGranularity",
      required: true,
      index: true,
      immutable: true,
    },
    window_from: { type: Date, required: true, immutable: true },
    window_until: { type: Date, required: true, immutable: true },
    target_schedule_revision: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator: Number.isSafeInteger,
        message: "target_schedule_revision must be a positive safe integer",
      },
    },
    max_form_lead_id: {
      type: Schema.Types.ObjectId,
      default: null,
      immutable: true,
    },
    max_call_lead_id: {
      type: Schema.Types.ObjectId,
      default: null,
      immutable: true,
    },
    reviewed_targets: {
      type: [CplCorrectionReviewedTargetSchema],
      required: true,
      immutable: true,
      validate: {
        validator: (targets: unknown[]) => targets.length <= 250,
        message: "reviewed_targets exceeds the correction safety limit",
      },
    },
    preview_hash: { type: String, required: true, trim: true, immutable: true },
    status: {
      type: String,
      required: true,
      enum: CPL_CORRECTION_JOB_STATUSES,
      default: "pending",
      index: true,
    },
    requested_by: {
      type: CplCorrectionActorSnapshotSchema,
      required: true,
      immutable: true,
    },
    reason: { type: String, trim: true },
    matched_count: { type: Number, required: true, default: 0, min: 0 },
    changed_count: { type: Number, required: true, default: 0, min: 0 },
    no_op_count: { type: Number, required: true, default: 0, min: 0 },
    failed_count: { type: Number, required: true, default: 0, min: 0 },
    cursor: { type: CplCorrectionCursorSchema },
    leased_until: { type: Date, index: true },
    lease_owner: { type: String, trim: true },
    last_error: { type: String, trim: true },
    started_at: { type: Date },
    completed_at: { type: Date },
  },
  {
    collection: "cpl_correction_jobs",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

CplCorrectionJobSchema.index({ status: 1, leased_until: 1, createdAt: 1 });
CplCorrectionJobSchema.index({ source_granularity: 1, createdAt: -1 });
CplCorrectionJobSchema.index({ "requested_by.request_id": 1 });

export type CplCorrectionJobDocument = InferSchemaType<
  typeof CplCorrectionJobSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const CplCorrectionJob: Model<CplCorrectionJobDocument> =
  mongoose.models.CplCorrectionJob ??
  mongoose.model<CplCorrectionJobDocument>(
    "CplCorrectionJob",
    CplCorrectionJobSchema,
  );

export function getCplCorrectionJobModel(): Model<CplCorrectionJobDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return CplCorrectionJob;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.CplCorrectionJob as Model<CplCorrectionJobDocument> | undefined) ??
    db.model<CplCorrectionJobDocument>("CplCorrectionJob", CplCorrectionJobSchema)
  );
}
