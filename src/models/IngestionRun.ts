import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { durableRunControlFields } from "../services/durableWork";

export const INGESTION_RUN_STATUSES = [
  "queued",
  "inspecting",
  "planning",
  "awaiting_approval",
  "applying",
  "completed",
  "completed_with_errors",
  "failed",
  "skipped",
] as const;

export const INGESTION_RUN_TRIGGERS = [
  "bootstrap",
  "preview",
  "manual",
  "schedule",
  "retry",
] as const;

const CounterSchema = new Schema(
  {
    read: { type: Number, required: true, default: 0, min: 0 },
    out_of_scope: { type: Number, required: true, default: 0, min: 0 },
    unchanged: { type: Number, required: true, default: 0, min: 0 },
    creates: { type: Number, required: true, default: 0, min: 0 },
    safe_updates: { type: Number, required: true, default: 0, min: 0 },
    conflicts: { type: Number, required: true, default: 0, min: 0 },
    invalid_rows: { type: Number, required: true, default: 0, min: 0 },
    leadless_bookings: { type: Number, required: true, default: 0, min: 0 },
    cancellations: { type: Number, required: true, default: 0, min: 0 },
    failures: { type: Number, required: true, default: 0, min: 0 },
    skips: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const IngestionRunSchema = new Schema(
  {
    adapter_key: { type: String, required: true, trim: true },
    schema_version: { type: Number, required: true, min: 1 },
    trigger: { type: String, required: true, enum: INGESTION_RUN_TRIGGERS },
    status: {
      type: String,
      required: true,
      enum: INGESTION_RUN_STATUSES,
      default: "queued",
    },
    connection_id: {
      type: Schema.Types.ObjectId,
      ref: "ExternalDataConnection",
      required: true,
    },
    source_snapshot: { type: Schema.Types.Mixed, default: null },
    source_read_through: { type: Date, default: null },
    cutoff: { type: Date, required: true },
    timezone: { type: String, required: true, trim: true },
    plan_snapshot: { type: Schema.Types.Mixed, default: null },
    plan_checksum: { type: String, trim: true, default: null },
    plan_locked_at: { type: Date, default: null },
    counters: { type: CounterSchema, required: true, default: () => ({}) },
    actor: { type: Schema.Types.Mixed, required: true },
    initiator: { type: Schema.Types.Mixed, required: true },
    approval: { type: Schema.Types.Mixed, default: null },
    bootstrap_reconciliation: { type: Schema.Types.Mixed, default: null },
    skip_reason: { type: Schema.Types.Mixed, default: null },
    ...durableRunControlFields(),
  },
  {
    collection: "ingestion_runs",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

IngestionRunSchema.index(
  { adapter_key: 1, createdAt: -1 },
  { name: "ingestion_run_history" },
);
IngestionRunSchema.index(
  { status: 1, createdAt: 1 },
  { name: "ingestion_run_queue_claim" },
);
IngestionRunSchema.index(
  { adapter_key: 1, status: 1, leased_until: 1 },
  { name: "ingestion_run_recovery" },
);
IngestionRunSchema.index(
  { _id: 1, plan_checksum: 1 },
  {
    unique: true,
    partialFilterExpression: { plan_checksum: { $type: "string" } },
    name: "ingestion_run_plan_identity",
  },
);

export type IngestionRunDocument = InferSchemaType<
  typeof IngestionRunSchema
> & { _id: mongoose.Types.ObjectId };

export const IngestionRun: Model<IngestionRunDocument> =
  mongoose.models.IngestionRun ??
  mongoose.model<IngestionRunDocument>("IngestionRun", IngestionRunSchema);
