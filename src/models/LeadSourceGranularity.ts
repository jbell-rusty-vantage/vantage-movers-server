import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName, LOCAL_TYPES } from "../config/domain";

const LeadSourceGranularitySchema = new Schema(
  {
    source_company: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceCompany",
      required: true,
      index: true,
      immutable: true,
    },
    granularity_key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      immutable: true,
      unique: true,
    },
    channel: {
      type: String,
      required: true,
      enum: ["form", "call"],
    },
    owner_label: { type: String, required: true, trim: true },
    crm_label: { type: String, required: true, trim: true },
    aliases: { type: [String], default: [] },
    active: { type: Boolean, required: true, default: false, index: true },
    activated_at: { type: Date },
    archived_at: { type: Date },
    deactivation_reason: { type: String, trim: true },
    local: { type: String, enum: LOCAL_TYPES },
    source_sites: { type: [String], default: [] },
    priority: { type: Number, required: true, default: 0 },
    sheet_tab_name: { type: String, trim: true },
    schedule_revision: { type: Number, required: true, default: 0, min: 0 },
    created_from: { type: String, required: true, trim: true, default: "admin" },
  },
  {
    collection: "lead_source_granularities",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

LeadSourceGranularitySchema.index({ source_company: 1, channel: 1, active: 1 });
LeadSourceGranularitySchema.index({ crm_label: 1 });
LeadSourceGranularitySchema.index({ source_sites: 1 });
LeadSourceGranularitySchema.index({ source_company: 1, priority: -1 });

export type LeadSourceGranularityDocument =
  InferSchemaType<typeof LeadSourceGranularitySchema> & {
    _id: mongoose.Types.ObjectId;
  };

export const LeadSourceGranularity: Model<LeadSourceGranularityDocument> =
  mongoose.models.LeadSourceGranularity ??
  mongoose.model<LeadSourceGranularityDocument>(
    "LeadSourceGranularity",
    LeadSourceGranularitySchema,
  );

export function getLeadSourceGranularityModel(): Model<LeadSourceGranularityDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return LeadSourceGranularity;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.LeadSourceGranularity as
      | Model<LeadSourceGranularityDocument>
      | undefined) ??
    db.model<LeadSourceGranularityDocument>(
      "LeadSourceGranularity",
      LeadSourceGranularitySchema,
    )
  );
}
