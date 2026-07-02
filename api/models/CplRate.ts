import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { LOCAL_TYPES } from "../config/domain/constants";
import { CPL_LEAD_TYPES } from "../config/domain/cplRateDefinitions";
import { SOURCE_COMPANIES } from "../config/domain/sources";

/**
 * Owner-editable CPL (cost-per-lead) rate for one granular lead-type slot,
 * e.g. "Best Relocation Forms" vs "Best Relocation Inbounds". One document
 * per entry in `CPL_RATE_DEFINITIONS` -- see `cplRateDefinitions.ts` for the
 * canonical 13-slot list this collection is seeded from.
 */
const CplRateSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, unique: true },
    source_company: { type: String, required: true, enum: SOURCE_COMPANIES },
    lead_type: { type: String, required: true, enum: CPL_LEAD_TYPES },
    local: { type: String, enum: LOCAL_TYPES },
    cpl: { type: Number, required: true, min: 0 },
  },
  {
    collection: "cpl_rates",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

CplRateSchema.index(
  { source_company: 1, lead_type: 1, local: 1 },
  { unique: true },
);

export type CplRateDocument = InferSchemaType<typeof CplRateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const CplRate: Model<CplRateDocument> =
  mongoose.models.CplRate ?? mongoose.model<CplRateDocument>("CplRate", CplRateSchema);
