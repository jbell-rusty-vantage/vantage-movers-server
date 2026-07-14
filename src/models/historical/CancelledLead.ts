import mongoose, { Schema, type Connection, type InferSchemaType, type Model } from "mongoose";
import { ImportMetadataFields, leadModelField } from "./schemaHelpers";

export const HistoricalCancelledLeadSchema = new Schema(
  {
    ...ImportMetadataFields,
    timestamp: { type: Date, default: Date.now },
    booked_lead: { type: Schema.Types.ObjectId, ref: "BookedLead", index: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    lead_ref: { type: Schema.Types.ObjectId, refPath: "lead_model", index: true },
    lead_model: leadModelField,
    reason: { type: String, trim: true },
    notes: { type: String, trim: true },
    cancelled_by: { type: String, trim: true },
    cancel_date: { type: Date },
    agent: { type: String, trim: true },
    book_date: { type: Date },
    job_no: { type: String, trim: true },
    normalized_job_no: { type: String, trim: true, index: true },
    customer_name: { type: String, trim: true },
    normalized_customer_name: { type: String, trim: true, lowercase: true, index: true },
    refund_amount: { type: Number },
    merchant: { type: String, trim: true },
    source: { type: String, trim: true },
  },
  {
    collection: "cancelled_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

HistoricalCancelledLeadSchema.index({ source_workbook: 1, source_tab: 1, source_row: 1 });

export type HistoricalCancelledLeadDocument = InferSchemaType<
  typeof HistoricalCancelledLeadSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export function registerHistoricalCancelledLead(
  connection: Connection,
): Model<HistoricalCancelledLeadDocument> {
  return (
    connection.models.CancelledLead ??
    connection.model<HistoricalCancelledLeadDocument>(
      "CancelledLead",
      HistoricalCancelledLeadSchema,
    )
  );
}
