import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { getMongoDatabaseName } from "../config/domain";

export const GRANOT_CRM_SYNC_RUN_MODES = ["dry_run", "apply"] as const;
export const GRANOT_CRM_SYNC_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
] as const;

const outcomeCountsSchema = new Schema(
  {
    updated: { type: Number, default: 0, min: 0 },
    unchanged: { type: Number, default: 0, min: 0 },
    skipped: { type: Number, default: 0, min: 0 },
    invalid: { type: Number, default: 0, min: 0 },
    no_match: { type: Number, default: 0, min: 0 },
    conflict: { type: Number, default: 0, min: 0 },
    duplicate: { type: Number, default: 0, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const GranotCrmSyncRunSchema = new Schema(
  {
    mode: {
      type: String,
      enum: GRANOT_CRM_SYNC_RUN_MODES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: GRANOT_CRM_SYNC_RUN_STATUSES,
      required: true,
      default: "running",
      index: true,
    },
    workspace_slug: { type: String, trim: true, index: true },
    csv_kind: { type: String, trim: true, index: true },
    ingestion_ids: [{ type: Schema.Types.ObjectId, ref: "GranotCrmCsvIngestion" }],
    started_at: { type: Date, required: true, default: Date.now },
    completed_at: { type: Date },
    row_count: { type: Number, required: true, min: 0, default: 0 },
    outcome_counts: { type: outcomeCountsSchema, default: {} },
    error_summaries: [{ type: String, trim: true }],
    options: { type: Schema.Types.Mixed },
  },
  {
    collection: "granot_crm_sync_runs",
    timestamps: true,
  },
);

GranotCrmSyncRunSchema.index({ started_at: -1 });

export type GranotCrmSyncRun = InferSchemaType<typeof GranotCrmSyncRunSchema> & {
  _id: mongoose.Types.ObjectId;
};

export type GranotCrmSyncRunDocument = HydratedDocument<GranotCrmSyncRun>;

export const GranotCrmSyncRun: Model<GranotCrmSyncRunDocument> =
  mongoose.models.GranotCrmSyncRun ??
  mongoose.model<GranotCrmSyncRunDocument>(
    "GranotCrmSyncRun",
    GranotCrmSyncRunSchema,
  );

export function getGranotCrmSyncRunModel(): Model<GranotCrmSyncRunDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotCrmSyncRun;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.GranotCrmSyncRun as Model<GranotCrmSyncRunDocument> | undefined) ??
    db.model<GranotCrmSyncRunDocument>(
      "GranotCrmSyncRun",
      GranotCrmSyncRunSchema,
    )
  );
}
