import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const INGESTION_CONFLICT_TYPES = [
  "ambiguous_lead_match",
  "changed_protected_field",
  "duplicate_source_identity",
  "missing_source_row",
  "schema_drift",
  "unmatched_refund",
  "canonical_divergence",
] as const;

const IngestionConflictSchema = new Schema(
  {
    run_id: { type: Schema.Types.ObjectId, ref: "IngestionRun", required: true },
    source_receipt_id: {
      type: Schema.Types.ObjectId,
      ref: "SourceRowReceipt",
      default: null,
    },
    connection_id: {
      type: Schema.Types.ObjectId,
      ref: "ExternalDataConnection",
      required: true,
    },
    dataset_key: { type: String, required: true, trim: true },
    stable_source_row_id: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: INGESTION_CONFLICT_TYPES },
    severity: {
      type: String,
      required: true,
      enum: ["warning", "blocking", "critical"],
    },
    status: {
      type: String,
      required: true,
      enum: ["open", "resolved", "dismissed"],
      default: "open",
    },
    source_company_key: { type: String, trim: true, default: null },
    source_granularity_key: { type: String, trim: true, default: null },
    source_company_label: { type: String, trim: true, default: null },
    source_granularity_label: { type: String, trim: true, default: null },
    provenance: { type: Schema.Types.Mixed, required: true },
    normalized_source_values: { type: Schema.Types.Mixed, default: {} },
    protected_value_diff: { type: Schema.Types.Mixed, default: null },
    ranked_candidates: { type: [Schema.Types.Mixed], required: true, default: [] },
    related_canonical_ids: { type: [String], required: true, default: [] },
    resolution: { type: Schema.Types.Mixed, default: null },
    resolver_actor: { type: Schema.Types.Mixed, default: null },
    resolved_at: { type: Date, default: null },
    origin: {
      type: String,
      required: true,
      enum: ["external_sheet_ingestion"],
      default: "external_sheet_ingestion",
    },
  },
  {
    collection: "ingestion_conflicts",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

IngestionConflictSchema.index(
  { status: 1, severity: 1, createdAt: 1 },
  { name: "ingestion_conflict_queue" },
);
IngestionConflictSchema.index(
  { run_id: 1, type: 1 },
  { name: "ingestion_conflict_run_detail" },
);
IngestionConflictSchema.index(
  { connection_id: 1, dataset_key: 1, stable_source_row_id: 1 },
  { name: "ingestion_conflict_source_identity" },
);
IngestionConflictSchema.index(
  { origin: 1, type: 1, status: 1 },
  { name: "ingestion_conflict_reconciliation" },
);
IngestionConflictSchema.index(
  { run_id: 1, dataset_key: 1, stable_source_row_id: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
    name: "ingestion_conflict_open_unique",
  },
);

export type IngestionConflictDocument = InferSchemaType<
  typeof IngestionConflictSchema
> & { _id: mongoose.Types.ObjectId };

export const IngestionConflict: Model<IngestionConflictDocument> =
  mongoose.models.IngestionConflict ??
  mongoose.model<IngestionConflictDocument>(
    "IngestionConflict",
    IngestionConflictSchema,
  );
