import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const CplLeadCorrectionSnapshotSchema = new Schema(
  {
    cpl: { type: Number, required: true },
    cpl_rate_period: {
      type: Schema.Types.ObjectId,
      ref: "CplRatePeriod",
      default: null,
    },
    cpl_resolution_status: { type: String, default: null },
    cpl_resolved_at: { type: Date, default: null },
    cpl_resolution_version: { type: String, default: null },
  },
  { _id: false },
);

const CplLeadCorrectionSchema = new Schema(
  {
    job_id: {
      type: Schema.Types.ObjectId,
      ref: "CplCorrectionJob",
      required: true,
      immutable: true,
    },
    lead_model: {
      type: String,
      enum: ["FormLead", "CallLead"],
      required: true,
      immutable: true,
    },
    lead_id: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    corrected_at: { type: Date, required: true, immutable: true },
    before: {
      type: CplLeadCorrectionSnapshotSchema,
      required: true,
      immutable: true,
    },
    after: {
      type: CplLeadCorrectionSnapshotSchema,
      required: true,
      immutable: true,
    },
  },
  {
    collection: "cpl_lead_corrections",
    timestamps: true,
  },
);

CplLeadCorrectionSchema.index(
  { job_id: 1, lead_model: 1, lead_id: 1 },
  { unique: true },
);
CplLeadCorrectionSchema.index({ lead_model: 1, lead_id: 1, corrected_at: -1 });

export type CplLeadCorrectionDocument = InferSchemaType<
  typeof CplLeadCorrectionSchema
>;

export function getCplLeadCorrectionModel(): Model<CplLeadCorrectionDocument> {
  return (
    (mongoose.models.CplLeadCorrection as
      | Model<CplLeadCorrectionDocument>
      | undefined) ??
    mongoose.model<CplLeadCorrectionDocument>(
      "CplLeadCorrection",
      CplLeadCorrectionSchema,
    )
  );
}

