import mongoose, { Schema, type Model } from "mongoose";

const ReportingDefinitionSchema = new Schema<Record<string, any>>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, default: "" },
    dataset_key: {
      type: String,
      required: true,
      enum: ["lead_outcome_detail", "lead_quality_exceptions", "source_performance"],
    },
    state: { type: String, required: true, enum: ["active", "archived"], default: "active" },
    current_revision_id: { type: Schema.Types.ObjectId, ref: "ReportingDefinitionRevision", default: null },
    current_revision_number: { type: Number, required: true, default: 0, min: 0 },
    next_revision_number: { type: Number, required: true, default: 1, min: 1 },
    created_by: { type: Schema.Types.Mixed, required: true },
    updated_by: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: "reporting_definitions",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

ReportingDefinitionSchema.index({ state: 1, updated_at: -1, _id: 1 });
ReportingDefinitionSchema.index({ current_revision_id: 1 });

export type ReportingDefinitionDocument = mongoose.Document & Record<string, any>;
export const ReportingDefinition: Model<any> =
  mongoose.models.ReportingDefinition ??
  mongoose.model("ReportingDefinition", ReportingDefinitionSchema);
