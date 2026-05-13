import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  optionalLocalField,
  sheetSyncSchema,
  sourceCompanyField,
  type SheetSyncEntry,
} from "./schemaHelpers";

const CallLeadSchema = new Schema(
  {
    source_company: sourceCompanyField,
    source_company_site: { type: String, trim: true },
    timestamp: { type: Date, required: true, default: Date.now },
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, required: true, trim: true },
    duration: { type: Number },
    start_time: { type: Date },
    end_time: { type: Date },
    booked: { type: Schema.Types.ObjectId, ref: "BookedLead" },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    over_2000: { type: Boolean, default: false },
    over_4000: { type: Boolean, default: false },
    local: optionalLocalField,
    pickup_zip: { type: String, trim: true },
    delivery_zip: { type: String, trim: true },
    pickup_state: { type: String, trim: true, uppercase: true },
    delivery_state: { type: String, trim: true, uppercase: true },
    cubic_feet: { type: Number },
    cpl: { type: Number, required: true, default: 0 },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
  },
  {
    collection: "call_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

CallLeadSchema.index({ source_company: 1, createdAt: -1 });
CallLeadSchema.index({ phone_number: 1 });

export type CallLeadDocument = InferSchemaType<typeof CallLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const CallLead: Model<CallLeadDocument> =
  mongoose.models.CallLead ?? mongoose.model<CallLeadDocument>("CallLead", CallLeadSchema);
