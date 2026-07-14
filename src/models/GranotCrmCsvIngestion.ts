import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";
import {
  GRANOT_CRM_CSV_KINDS,
  getMongoDatabaseName,
} from "../config/domain";

export const GRANOT_CRM_CSV_INGESTION_TRIGGERS = [
  "extension",
  "script",
  "manual",
] as const;

export const GRANOT_CRM_CSV_INGESTION_STATUSES = [
  "uploaded",
  "skipped_unchanged",
  "failed",
] as const;

const GranotCrmCsvIngestionSchema = new Schema(
  {
    source: { type: Schema.Types.ObjectId, ref: "GranotCrmSource" },
    crm_origin: { type: String, required: true, trim: true, index: true },
    workspace_slug: { type: String, required: true, trim: true, index: true },
    granot_label: { type: String, trim: true },
    csv_kind: {
      type: String,
      enum: GRANOT_CRM_CSV_KINDS,
      required: true,
      index: true,
    },
    csv_path: { type: String, required: true, trim: true, index: true },
    content_sha256: { type: String, required: true, trim: true, index: true },
    byte_size: { type: Number, required: true, min: 0 },
    row_count: { type: Number, required: true, min: 0, default: 0 },
    data_row_count: { type: Number, required: true, min: 0, default: 0 },
    fetched_at: { type: Date },
    uploaded_at: { type: Date, required: true, default: Date.now },
    trigger: {
      type: String,
      enum: GRANOT_CRM_CSV_INGESTION_TRIGGERS,
      required: true,
      default: "extension",
    },
    status: {
      type: String,
      enum: GRANOT_CRM_CSV_INGESTION_STATUSES,
      required: true,
      default: "uploaded",
      index: true,
    },
    s3_bucket: { type: String, required: true, trim: true },
    s3_latest_key: { type: String, required: true, trim: true },
    s3_history_key: { type: String, trim: true },
    s3_meta_key: { type: String, trim: true },
    s3_version_id: { type: String, trim: true },
    error: { type: String, trim: true },
  },
  {
    collection: "granot_crm_csv_ingestions",
    timestamps: true,
  },
);

GranotCrmCsvIngestionSchema.index({
  crm_origin: 1,
  workspace_slug: 1,
  csv_kind: 1,
  uploaded_at: -1,
});
GranotCrmCsvIngestionSchema.index({
  crm_origin: 1,
  workspace_slug: 1,
  csv_kind: 1,
  content_sha256: 1,
});

export type GranotCrmCsvIngestion = InferSchemaType<
  typeof GranotCrmCsvIngestionSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export type GranotCrmCsvIngestionDocument =
  HydratedDocument<GranotCrmCsvIngestion>;

export const GranotCrmCsvIngestion: Model<GranotCrmCsvIngestionDocument> =
  mongoose.models.GranotCrmCsvIngestion ??
  mongoose.model<GranotCrmCsvIngestionDocument>(
    "GranotCrmCsvIngestion",
    GranotCrmCsvIngestionSchema,
  );

export function getGranotCrmCsvIngestionModel(): Model<GranotCrmCsvIngestionDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotCrmCsvIngestion;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.GranotCrmCsvIngestion as
      | Model<GranotCrmCsvIngestionDocument>
      | undefined) ??
    db.model<GranotCrmCsvIngestionDocument>(
      "GranotCrmCsvIngestion",
      GranotCrmCsvIngestionSchema,
    )
  );
}
