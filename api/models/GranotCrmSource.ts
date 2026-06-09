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
import { sourceCompanyField } from "./schemaHelpers";

export const GRANOT_CRM_CHANNELS = ["form", "call", "unknown"] as const;

const csvPathsSchema = new Schema(
  {
    follow_up: { type: String, trim: true },
    booked: { type: String, trim: true },
  },
  { _id: false },
);

const lastIngestionSchema = new Schema(
  {
    content_sha256: { type: String, trim: true },
    ingestion_id: { type: Schema.Types.ObjectId, ref: "GranotCrmCsvIngestion" },
    s3_key: { type: String, trim: true },
    imported_at: { type: Date },
  },
  { _id: false },
);

const GranotCrmSourceSchema = new Schema(
  {
    crm_origin: { type: String, required: true, trim: true, index: true },
    workspace_slug: { type: String, required: true, trim: true, index: true },
    granot_label: { type: String, required: true, trim: true },
    default_channel: {
      type: String,
      enum: GRANOT_CRM_CHANNELS,
      required: true,
      default: "unknown",
    },
    source_company: sourceCompanyField,
    csv_paths: { type: csvPathsSchema, default: {} },
    enabled: { type: Boolean, required: true, default: true, index: true },
    notes: { type: String, trim: true },
    last_ingestions: {
      follow_up: { type: lastIngestionSchema },
      booked: { type: lastIngestionSchema },
    },
  },
  {
    collection: "granot_crm_sources",
    timestamps: true,
  },
);

GranotCrmSourceSchema.index(
  { crm_origin: 1, workspace_slug: 1 },
  { unique: true },
);
for (const csvKind of GRANOT_CRM_CSV_KINDS) {
  GranotCrmSourceSchema.index({ [`csv_paths.${csvKind}`]: 1 });
}

export type GranotCrmSource = InferSchemaType<typeof GranotCrmSourceSchema> & {
  _id: mongoose.Types.ObjectId;
};

export type GranotCrmSourceDocument = HydratedDocument<GranotCrmSource>;

export const GranotCrmSource: Model<GranotCrmSourceDocument> =
  mongoose.models.GranotCrmSource ??
  mongoose.model<GranotCrmSourceDocument>(
    "GranotCrmSource",
    GranotCrmSourceSchema,
  );

export function getGranotCrmSourceModel(): Model<GranotCrmSourceDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotCrmSource;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.GranotCrmSource as Model<GranotCrmSourceDocument> | undefined) ??
    db.model<GranotCrmSourceDocument>(
      "GranotCrmSource",
      GranotCrmSourceSchema,
    )
  );
}
