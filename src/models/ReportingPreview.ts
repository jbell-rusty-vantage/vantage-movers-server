import mongoose, { Schema, type Model } from "mongoose";

const ReportingPreviewSchema = new Schema<Record<string, any>>(
  {
    draft_checksum: { type: String, required: true, index: true },
    dataset_key: { type: String, required: true },
    dataset_schema_version: { type: Number, required: true, enum: [1] },
    resolved_window: { type: Schema.Types.Mixed, required: true },
    destination_snapshot: { type: Schema.Types.Mixed, required: true },
    destination_snapshot_checksum: { type: String, required: true },
    source_read_through: { type: Date, required: true },
    estimate: { type: Schema.Types.Mixed, required: true },
    projected: { type: Schema.Types.Mixed, required: true },
    capacity: { type: Schema.Types.Mixed, required: true },
    batches: { type: Schema.Types.Mixed, required: true },
    warnings: { type: [Schema.Types.Mixed], default: [] },
    pii_column_ids: { type: [String], default: [] },
    destination_ownership: { type: String, required: true },
    intended_changes: { type: Schema.Types.Mixed, required: true },
    sample_count: { type: Number, required: true, min: 0, max: 50 },
    sample_token: { type: String, required: true },
    sample_evidence: { type: String, required: true },
    preview_checksum: { type: String, required: true },
    created_by: { type: Schema.Types.Mixed, required: true },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "reporting_previews",
    timestamps: { createdAt: "created_at", updatedAt: false },
  },
);
ReportingPreviewSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export type ReportingPreviewDocument = mongoose.Document & Record<string, any>;
export const ReportingPreview: Model<any> =
  mongoose.models.ReportingPreview ??
  mongoose.model("ReportingPreview", ReportingPreviewSchema);
