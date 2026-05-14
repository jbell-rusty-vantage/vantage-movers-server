import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { MOVE_SIZES } from "../config/domain";
import {
  localField,
  sheetSyncSchema,
  sourceCompanyField,
  type SheetSyncEntry,
} from "./schemaHelpers";

const FormLeadSchema = new Schema(
  {
    source_company: sourceCompanyField,
    name: { type: String, required: true, trim: true },
    source_company_site: { type: String, trim: true },
    timestamp: { type: Date, required: true, default: Date.now },
    lid: { type: String, trim: true, unique: true, sparse: true, index: true },
    pickup_zip: { type: String, required: true, trim: true },
    destination_zip: { type: String, required: true, trim: true },
    pickup_state: { type: String, required: true, trim: true, uppercase: true },
    delivery_state: { type: String, required: true, trim: true, uppercase: true },
    move_size: { type: String, required: true, enum: MOVE_SIZES },
    move_date: { type: Date, required: true, default: Date.now },
    ref_no: { type: String, required: true, trim: true, default: "not provided" },
    booked: { type: Schema.Types.ObjectId, ref: "BookedLead" },
    over_2000: { type: Boolean, default: false },
    over_4000: { type: Boolean, default: false },
    local: localField,
    email: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, required: true, trim: true },
    cpl: { type: Number, required: true, default: 0 },
    quoted: { type: Boolean, default: false },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    cubic_feet: { type: Number },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
  },
  {
    collection: "form_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

FormLeadSchema.index({ source_company: 1, createdAt: -1 });
FormLeadSchema.index({ phone_number: 1 });
FormLeadSchema.index({ ref_no: 1 });
FormLeadSchema.index({ email: 1 });

export type FormLeadDocument = InferSchemaType<typeof FormLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const FormLead: Model<FormLeadDocument> =
  mongoose.models.FormLead ??
  mongoose.model<FormLeadDocument>("FormLead", FormLeadSchema);
