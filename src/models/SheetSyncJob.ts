import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  SHEET_SYNC_CREATED_BY,
  SHEET_SYNC_ENTITY_MODELS,
  SHEET_SYNC_JOB_STATUSES,
  SHEET_SYNC_RESOURCES,
} from "../config/domain";

/**
 * Snapshot of a single sheet target that a delete tombstone must remove. Row
 * numbers may be stale by the time the worker runs, so the worker validates
 * the Mongo ID and can rebuild a tab map; `target_hints` on the job preserve
 * enough information to recompute fallback targets.
 */
const sheetSyncTombstoneTargetSchema = new Schema(
  {
    target: { type: String, required: true, trim: true },
    spreadsheet_id: { type: String, required: true, trim: true },
    tab_name: { type: String, required: true, trim: true },
    row_number: { type: Number },
  },
  { _id: false },
);

/**
 * Durable delete metadata captured before a domain document is hard-deleted.
 * The worker cannot reload a deleted document, so everything it needs to find
 * and remove the row(s) lives here.
 */
const sheetSyncTombstoneSchema = new Schema(
  {
    mongo_id: { type: String, required: true, trim: true },
    source_company: { type: String, trim: true },
    duplicate: { type: Boolean },
    previous_targets: { type: [sheetSyncTombstoneTargetSchema], default: [] },
    linked_booking_id: { type: String, trim: true },
    linked_cancellation_id: { type: String, trim: true },
    linked_lead_id: { type: String, trim: true },
    linked_lead_model: { type: String, trim: true },
  },
  { _id: false },
);

/**
 * Durable outbox row for Google Sheets sync. MongoDB is the source of truth;
 * these jobs are domain-level intents that the drainer reloads against current
 * Mongo state (or tombstone data) before building sheet writes. Repeated
 * intents for the same entity collapse onto one row via `coalescing_key`.
 */
const SheetSyncJobSchema = new Schema(
  {
    status: {
      type: String,
      enum: SHEET_SYNC_JOB_STATUSES,
      required: true,
      default: "pending",
    },
    priority: { type: Number, required: true, default: 0 },
    resource: { type: String, enum: SHEET_SYNC_RESOURCES, required: true },
    operation: { type: String, required: true, trim: true },
    entity_model: { type: String, enum: SHEET_SYNC_ENTITY_MODELS },
    entity_id: { type: String, required: true, trim: true },
    coalescing_key: { type: String, required: true, trim: true },
    target_hints: { type: [String], default: [] },
    tombstone: { type: sheetSyncTombstoneSchema, default: undefined },
    due_at: { type: Date, required: true, default: Date.now },
    leased_until: { type: Date },
    lease_owner: { type: String, trim: true },
    attempts: { type: Number, required: true, default: 0 },
    last_error: { type: String, trim: true },
    last_error_at: { type: Date },
    created_by: {
      type: String,
      enum: SHEET_SYNC_CREATED_BY,
      required: true,
      default: "api",
    },
    run_id: { type: Schema.Types.ObjectId, ref: "SheetSyncRun" },
  },
  {
    collection: "sheet_sync_jobs",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Drainer due-job query: pick live jobs whose due_at has passed, highest
// priority first, then oldest.
SheetSyncJobSchema.index({ status: 1, due_at: 1, priority: -1, createdAt: 1 });
// Coalescing upsert lookup.
SheetSyncJobSchema.index({ coalescing_key: 1, status: 1 });
// Lease reclamation sweep.
SheetSyncJobSchema.index({ leased_until: 1 });
// Per-entity history / admin filtering.
SheetSyncJobSchema.index({ entity_model: 1, entity_id: 1, status: 1 });

export type SheetSyncJobDocument = InferSchemaType<typeof SheetSyncJobSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SheetSyncJob: Model<SheetSyncJobDocument> =
  mongoose.models.SheetSyncJob ??
  mongoose.model<SheetSyncJobDocument>("SheetSyncJob", SheetSyncJobSchema);
