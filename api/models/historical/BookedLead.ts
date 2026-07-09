import mongoose, { Schema, type Connection, type InferSchemaType, type Model } from "mongoose";
import {
  AgentAllocationSchema,
  ImportMetadataFields,
  leadModelField,
  localField,
} from "./schemaHelpers";

export const HistoricalBookedLeadSchema = new Schema(
  {
    ...ImportMetadataFields,
    timestamp: { type: Date, default: Date.now },
    book_date: { type: Date },
    job_no: { type: String, trim: true, index: true },
    normalized_job_no: { type: String, trim: true, index: true },
    customer_name_snapshot: { type: String, trim: true },
    normalized_customer_name: { type: String, trim: true, lowercase: true, index: true },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      index: true,
    },
    lead_ref: {
      type: Schema.Types.ObjectId,
      refPath: "lead_model",
      index: true,
    },
    lead_model: leadModelField,
    agent_allocations: {
      type: [AgentAllocationSchema],
      default: [],
    },
    total_binder_amount: { type: Number, min: 0 },
    deposit_amount: { type: Number },
    merchant: { type: String, trim: true },
    source: { type: String, trim: true },
    submission_id: { type: String, trim: true, index: true },
    normalized_lid: { type: String, trim: true, index: true },
    payment_notes: { type: String, trim: true },
    matched_by: { type: String, trim: true, index: true },
    match_confidence: { type: Number, min: 0, max: 1 },
    local: localField,
    over_2000: { type: Boolean, default: false },
    over_4000: { type: Boolean, default: false },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
  },
  {
    collection: "booked_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

HistoricalBookedLeadSchema.index({ lead_ref: 1, lead_model: 1 });
HistoricalBookedLeadSchema.index({ source_workbook: 1, source_tab: 1, source_row: 1 });

HistoricalBookedLeadSchema.virtual("agent").get(function () {
  return this.agent_allocations?.[0]?.agent_name_snapshot ?? "";
});

HistoricalBookedLeadSchema.virtual("binder_amount").get(function () {
  return this.total_binder_amount;
});

export type HistoricalBookedLeadDocument = InferSchemaType<typeof HistoricalBookedLeadSchema> & {
  _id: mongoose.Types.ObjectId;
};

export function registerHistoricalBookedLead(
  connection: Connection,
): Model<HistoricalBookedLeadDocument> {
  return (
    connection.models.BookedLead ??
    connection.model<HistoricalBookedLeadDocument>("BookedLead", HistoricalBookedLeadSchema)
  );
}
