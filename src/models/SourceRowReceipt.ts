import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const SourceRowReceiptSchema = new Schema(
  {
    connection_id: {
      type: Schema.Types.ObjectId,
      ref: "ExternalDataConnection",
      required: true,
    },
    dataset_key: { type: String, required: true, trim: true },
    stable_source_row_id: { type: String, required: true, trim: true },
    content_hash: { type: String, required: true, trim: true },
    schema_profile: { type: String, required: true, trim: true },
    schema_version: { type: Number, required: true, min: 1 },
    workbook_id: { type: String, required: true, trim: true, select: false },
    workbook_title: { type: String, required: true, trim: true },
    tab_id: { type: Number, default: null },
    tab_name: { type: String, required: true, trim: true },
    last_observed_row_number: { type: Number, required: true, min: 1 },
    range: { type: String, required: true, trim: true },
    observed_at: { type: Date, required: true },
    ingestion_run_id: {
      type: Schema.Types.ObjectId,
      ref: "IngestionRun",
      required: true,
    },
    observation_type: { type: String, required: true, trim: true },
    classification: { type: String, required: true, trim: true },
    outcome: { type: String, required: true, trim: true },
    resulting_canonical_model: { type: String, trim: true, default: null },
    resulting_canonical_ids: { type: [String], required: true, default: [] },
    last_applied_source_values: { type: Schema.Types.Mixed, default: null },
    matching: { type: Schema.Types.Mixed, default: null },
    source_state: {
      type: String,
      required: true,
      enum: ["present", "source_missing"],
      default: "present",
    },
  },
  {
    collection: "source_row_receipts",
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

SourceRowReceiptSchema.index(
  {
    connection_id: 1,
    dataset_key: 1,
    stable_source_row_id: 1,
    schema_version: 1,
    content_hash: 1,
  },
  { unique: true, name: "source_receipt_evidence_unique" },
);

SourceRowReceiptSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  function rejectReceiptMutation() {
    throw new Error("SourceRowReceipt records are append-only");
  },
);
SourceRowReceiptSchema.index(
  { connection_id: 1, dataset_key: 1, stable_source_row_id: 1, createdAt: -1 },
  { name: "source_receipt_history" },
);
SourceRowReceiptSchema.index(
  { resulting_canonical_ids: 1 },
  { name: "source_receipt_canonical_provenance" },
);
SourceRowReceiptSchema.index(
  { connection_id: 1, dataset_key: 1, source_state: 1 },
  { name: "source_receipt_missing_scan" },
);
SourceRowReceiptSchema.index(
  { ingestion_run_id: 1, classification: 1 },
  { name: "source_receipt_run_detail" },
);

export type SourceRowReceiptDocument = InferSchemaType<
  typeof SourceRowReceiptSchema
> & { _id: mongoose.Types.ObjectId };

export const SourceRowReceipt: Model<SourceRowReceiptDocument> =
  mongoose.models.SourceRowReceipt ??
  mongoose.model<SourceRowReceiptDocument>(
    "SourceRowReceipt",
    SourceRowReceiptSchema,
  );
