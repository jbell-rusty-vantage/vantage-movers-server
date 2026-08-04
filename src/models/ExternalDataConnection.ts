import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const HealthSchema = new Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ["unknown", "healthy", "degraded", "unhealthy"],
      default: "unknown",
    },
    checked_at: { type: Date, default: null },
    summary: { type: String, trim: true, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const ExternalDataConnectionSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, unique: true },
    provider: {
      type: String,
      required: true,
      enum: ["google_sheets"],
      default: "google_sheets",
    },
    workbook_env_keys: {
      leads: { type: String, required: true, trim: true },
      booked: { type: String, required: true, trim: true },
    },
    resolved_workbooks: {
      leads: {
        title: { type: String, trim: true, default: null },
        masked_id: { type: String, trim: true, default: null },
      },
      booked: {
        title: { type: String, trim: true, default: null },
        masked_id: { type: String, trim: true, default: null },
      },
    },
    application_enabled: { type: Boolean, required: true, default: false },
    application_enabled_actor: { type: Schema.Types.Mixed, default: null },
    cadence_hours: {
      type: Number,
      required: true,
      enum: [24, 48],
      default: 24,
    },
    next_due_at: { type: Date, default: null },
    last_checked_at: { type: Date, default: null },
    last_successful_run_at: { type: Date, default: null },
    bootstrap_completed_at: { type: Date, default: null },
    health: {
      connection: { type: HealthSchema, default: () => ({}) },
      schema: { type: HealthSchema, default: () => ({}) },
      formula: { type: HealthSchema, default: () => ({}) },
      identity_column: { type: HealthSchema, default: () => ({}) },
    },
    created_actor: { type: Schema.Types.Mixed, required: true },
    updated_actor: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: "external_data_connections",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

ExternalDataConnectionSchema.index(
  { application_enabled: 1, next_due_at: 1 },
  { name: "external_connection_scheduler" },
);
ExternalDataConnectionSchema.index(
  { last_successful_run_at: 1 },
  { name: "external_connection_health" },
);

export type ExternalDataConnectionDocument = InferSchemaType<
  typeof ExternalDataConnectionSchema
> & { _id: mongoose.Types.ObjectId };

export const ExternalDataConnection: Model<ExternalDataConnectionDocument> =
  mongoose.models.ExternalDataConnection ??
  mongoose.model<ExternalDataConnectionDocument>(
    "ExternalDataConnection",
    ExternalDataConnectionSchema,
  );
