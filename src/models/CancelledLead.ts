import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { leadModelField, sheetSyncSchema, type SheetSyncEntry } from "./schemaHelpers";

const CancelledLeadSchema = new Schema(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    booked_lead: { type: Schema.Types.ObjectId, ref: "BookedLead", required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    lead_ref: { type: Schema.Types.ObjectId, refPath: "lead_model", index: true },
    lead_model: leadModelField,
    reason: { type: String, trim: true },
    notes: { type: String, trim: true },
    cancelled_by: { type: String, trim: true },
    cancel_date: { type: Date, required: true },
    agent: { type: String, trim: true },
    book_date: { type: Date },
    job_no: { type: String, trim: true },
    customer_name: { type: String, trim: true },
    refund_amount: { type: Number, required: true },
    merchant: { type: String, trim: true },
    source: { type: String, trim: true },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
  },
  {
    collection: "cancelled_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export type CancelledLeadDocument = InferSchemaType<typeof CancelledLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const CancelledLead: Model<CancelledLeadDocument> =
  mongoose.models.CancelledLead ??
  mongoose.model<CancelledLeadDocument>("CancelledLead", CancelledLeadSchema);
