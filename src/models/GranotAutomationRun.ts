import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { durableRunControlFields } from "../services/durableWork";

export const GRANOT_RUN_STATUSES = [
  "queued",
  "planning",
  "awaiting_approval",
  "applying",
  "completed",
  "completed_with_errors",
  "failed",
  "expired",
] as const;

const GranotAutomationRunSchema = new Schema(
  {
    schema_version: { type: Number, required: true, default: 1, min: 1 },
    operation: {
      type: String,
      required: true,
      enum: ["form_leads", "call_leads"],
    },
    workflow: {
      type: String,
      required: true,
      enum: ["preview", "apply"],
    },
    status: {
      type: String,
      required: true,
      enum: GRANOT_RUN_STATUSES,
      default: "queued",
    },
    request_snapshot: { type: Schema.Types.Mixed, required: true },
    initiator: { type: Schema.Types.Mixed, required: true },
    collection_summary: { type: Schema.Types.Mixed, default: null },
    plan_snapshot: { type: Schema.Types.Mixed, default: null },
    plan_checksum: { type: String, trim: true, default: null },
    plan_locked_at: { type: Date, default: null },
    expires_at: { type: Date, required: true, index: true },
    purge_at: { type: Date, required: true },
    approval: { type: Schema.Types.Mixed, default: null },
    receipts: { type: [Schema.Types.Mixed], default: [] },
    counters: { type: Schema.Types.Mixed, default: {} },
    ...durableRunControlFields(),
  },
  {
    collection: "granot_automation_runs",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

GranotAutomationRunSchema.index(
  { status: 1, createdAt: 1 },
  { name: "granot_run_queue_claim" },
);
GranotAutomationRunSchema.index(
  { purge_at: 1 },
  {
    expireAfterSeconds: 0,
    name: "granot_run_retention_ttl",
  },
);
GranotAutomationRunSchema.index(
  { status: 1, leased_until: 1 },
  { name: "granot_run_recovery" },
);
GranotAutomationRunSchema.index(
  { _id: 1, plan_checksum: 1 },
  {
    unique: true,
    partialFilterExpression: { plan_checksum: { $type: "string" } },
    name: "granot_run_plan_identity",
  },
);

export type GranotAutomationRunDocument = InferSchemaType<
  typeof GranotAutomationRunSchema
> & { _id: mongoose.Types.ObjectId };

export const GranotAutomationRun: Model<GranotAutomationRunDocument> =
  mongoose.models.GranotAutomationRun ??
  mongoose.model<GranotAutomationRunDocument>(
    "GranotAutomationRun",
    GranotAutomationRunSchema,
  );
