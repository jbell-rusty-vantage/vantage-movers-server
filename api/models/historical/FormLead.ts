import mongoose, { Schema, type Connection, type InferSchemaType, type Model } from "mongoose";
import { ImportMetadataFields, localField, sourceCompanyField } from "./schemaHelpers";

export const HistoricalFormLeadSchema = new Schema(
  {
    source_company: sourceCompanyField,
    ...ImportMetadataFields,
    name: { type: String, trim: true },
    normalized_name: { type: String, trim: true, lowercase: true, index: true },
    source_company_site: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
    lid: { type: String, trim: true, unique: true, sparse: true, index: true },
    normalized_lid: { type: String, trim: true, index: true },
    pickup_zip: { type: String, trim: true },
    destination_zip: { type: String, trim: true },
    pickup_state: { type: String, trim: true, uppercase: true },
    delivery_state: { type: String, trim: true, uppercase: true },
    move_size: { type: String, trim: true },
    move_date: { type: Date, default: Date.now },
    ref_no: { type: String, trim: true },
    normalized_ref_no: { type: String, trim: true, index: true },
    booked: { type: Schema.Types.ObjectId, ref: "BookedLead" },
    sheet_booked: { type: Boolean, default: false },
    over_2000: { type: Boolean, default: false },
    over_4000: { type: Boolean, default: false },
    local: localField,
    email: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, trim: true },
    normalized_phone_number: { type: String, trim: true, index: true },
    cpl: { type: Number, default: 0 },
    quoted: { type: Boolean, default: false },
    post_to_granot: { type: Boolean, default: true },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    cubic_feet: { type: Number },
  },
  {
    collection: "form_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

HistoricalFormLeadSchema.index({ source_company: 1, createdAt: -1 });
HistoricalFormLeadSchema.index({ phone_number: 1 });
HistoricalFormLeadSchema.index({ ref_no: 1 });
HistoricalFormLeadSchema.index({ email: 1 });
HistoricalFormLeadSchema.index({ source_workbook: 1, source_tab: 1, source_row: 1 });

export type HistoricalFormLeadDocument = InferSchemaType<typeof HistoricalFormLeadSchema> & {
  _id: mongoose.Types.ObjectId;
};

export function registerHistoricalFormLead(
  connection: Connection,
): Model<HistoricalFormLeadDocument> {
  return (
    connection.models.FormLead ??
    connection.model<HistoricalFormLeadDocument>("FormLead", HistoricalFormLeadSchema)
  );
}
