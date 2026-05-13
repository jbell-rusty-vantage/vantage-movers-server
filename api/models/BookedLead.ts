import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { leadModelField, localField, sheetSyncSchema, type SheetSyncEntry } from "./schemaHelpers";

const BookedLeadSchema = new Schema(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    agent: { type: String, required: true, trim: true },
    book_date: { type: Date, required: true },
    job_no: { type: String, required: true, trim: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    lead_ref: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "lead_model",
      index: true,
    },
    lead_model: leadModelField,
    binder_amount: { type: Number, required: true },
    deposit_amount: { type: Number, required: true },
    merchant: { type: String, required: true, trim: true },
    source: { type: String, required: true, trim: true },
    local: localField,
    over_2000: { type: Boolean, required: true, default: false },
    over_4000: { type: Boolean, required: true, default: false },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
  },
  {
    collection: "booked_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

BookedLeadSchema.index({ lead_ref: 1, lead_model: 1 });

export type BookedLeadDocument = InferSchemaType<typeof BookedLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const BookedLead: Model<BookedLeadDocument> =
  mongoose.models.BookedLead ??
  mongoose.model<BookedLeadDocument>("BookedLead", BookedLeadSchema);
