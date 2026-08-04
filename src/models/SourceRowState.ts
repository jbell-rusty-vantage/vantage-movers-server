import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const SourceRowStateSchema = new Schema(
  {
    connection_id: {
      type: Schema.Types.ObjectId,
      ref: "ExternalDataConnection",
      required: true,
    },
    dataset_key: { type: String, required: true, trim: true },
    stable_source_row_id: { type: String, required: true, trim: true },
    schema_profile: { type: String, required: true, trim: true },
    schema_version: { type: Number, required: true, min: 1 },
    workbook_id: { type: String, required: true, trim: true, select: false },
    workbook_title: { type: String, required: true, trim: true },
    tab_name: { type: String, required: true, trim: true },
    last_observed_row_number: { type: Number, required: true, min: 1 },
    latest_content_hash: { type: String, required: true, trim: true },
    latest_outcome: { type: String, required: true, trim: true },
    latest_receipt_id: {
      type: Schema.Types.ObjectId,
      ref: "SourceRowReceipt",
      required: true,
    },
    source_state: {
      type: String,
      required: true,
      enum: ["present", "source_missing"],
    },
    resulting_canonical_model: { type: String, trim: true, default: null },
    resulting_canonical_ids: { type: [String], required: true, default: [] },
    last_applied_content_hash: { type: String, trim: true, default: null },
    last_applied_source_values: { type: Schema.Types.Mixed, default: null },
    last_observed_at: { type: Date, required: true },
    last_ingestion_run_id: {
      type: Schema.Types.ObjectId,
      ref: "IngestionRun",
      required: true,
    },
  },
  {
    collection: "source_row_states",
    timestamps: true,
  },
);

SourceRowStateSchema.index(
  {
    connection_id: 1,
    dataset_key: 1,
    stable_source_row_id: 1,
    schema_version: 1,
  },
  { unique: true, name: "source_row_state_identity_unique" },
);
SourceRowStateSchema.index(
  { connection_id: 1, dataset_key: 1, source_state: 1 },
  { name: "source_row_state_missing_scan" },
);

export type SourceRowStateDocument = InferSchemaType<
  typeof SourceRowStateSchema
> & { _id: mongoose.Types.ObjectId };

export const SourceRowState: Model<SourceRowStateDocument> =
  mongoose.models.SourceRowState ??
  mongoose.model<SourceRowStateDocument>("SourceRowState", SourceRowStateSchema);
