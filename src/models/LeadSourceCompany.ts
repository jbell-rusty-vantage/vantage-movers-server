import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName, LOCAL_TYPES } from "../config/domain";

const sourceGranularitySchema = new Schema(
  {
    granularity_key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      immutable: true,
    },
    channel: { type: String, required: true, enum: ["form", "call"] },
    owner_label: { type: String, required: true, trim: true },
    crm_label: { type: String, required: true, trim: true },
    aliases: { type: [String], default: [] },
    active: { type: Boolean, required: true, default: true, index: true },
    archived_at: { type: Date },
    cpl: { type: Number, required: true, default: 0, min: 0 },
    local: { type: String, enum: LOCAL_TYPES },
    source_sites: { type: [String], default: [] },
    inbound_phone_numbers: { type: [String], default: [] },
    priority: { type: Number, required: true, default: 0 },
    sheet_tab_name: { type: String, trim: true },
  },
  { _id: true },
);

const LeadSourceCompanySchema = new Schema(
  {
    company_slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      immutable: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    owner_label: { type: String, required: true, trim: true },
    aliases: { type: [String], default: [] },
    active: { type: Boolean, required: true, default: true, index: true },
    archived_at: { type: Date },
    default_form_granularity_key: { type: String, trim: true, lowercase: true },
    default_call_granularity_key: { type: String, trim: true, lowercase: true },
    sheet_config: {
      spreadsheet_id: { type: String, trim: true },
      has_bad_tabs: { type: Boolean, required: true, default: false },
    },
    granularities: { type: [sourceGranularitySchema], default: [] },
    created_from: { type: String, required: true, trim: true, default: "admin" },
  },
  {
    collection: "lead_source_companies",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

LeadSourceCompanySchema.index({ "granularities.granularity_key": 1 });
LeadSourceCompanySchema.index({ "granularities.crm_label": 1 });
LeadSourceCompanySchema.index({ "granularities.inbound_phone_numbers": 1 });

export type LeadSourceGranularity = InferSchemaType<typeof sourceGranularitySchema> & {
  _id: mongoose.Types.ObjectId;
};

export type LeadSourceCompanyDocument = InferSchemaType<typeof LeadSourceCompanySchema> & {
  _id: mongoose.Types.ObjectId;
  granularities: mongoose.Types.DocumentArray<LeadSourceGranularity>;
};

export const LeadSourceCompany: Model<LeadSourceCompanyDocument> =
  mongoose.models.LeadSourceCompany ??
  mongoose.model<LeadSourceCompanyDocument>(
    "LeadSourceCompany",
    LeadSourceCompanySchema,
  );

export function getLeadSourceCompanyModel(): Model<LeadSourceCompanyDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return LeadSourceCompany;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.LeadSourceCompany as Model<LeadSourceCompanyDocument> | undefined) ??
    db.model<LeadSourceCompanyDocument>(
      "LeadSourceCompany",
      LeadSourceCompanySchema,
    )
  );
}
