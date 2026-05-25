import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  optionalLocalField,
  sheetSyncSchema,
  sourceCompanyField,
  type SheetSyncEntry,
} from "./schemaHelpers";
import { normalizePhoneNumberForMatch } from "../utils/phone";

const CallLeadSchema = new Schema(
  {
    source_company: sourceCompanyField,
    source_company_site: { type: String, trim: true },
    timestamp: { type: Date, required: true, default: Date.now },
    job_no: { type: String, trim: true },
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, trim: true },
    normalized_phone_number: { type: String, trim: true },
    duration: { type: Number },
    start_time: { type: Date },
    end_time: { type: Date },
    booked: { type: Schema.Types.ObjectId, ref: "BookedLead" },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    over_2000: { type: Boolean, default: false },
    over_4000: { type: Boolean, default: false },
    local: optionalLocalField,
    form_fill: { type: Boolean, default: false },
    created_on_unmatched: { type: Boolean, default: false, index: true },
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
CallLeadSchema.index({ normalized_phone_number: 1, createdAt: -1 });
CallLeadSchema.index({ job_no: 1 });

CallLeadSchema.pre("validate", function normalizePhoneNumber() {
  this.normalized_phone_number = normalizePhoneNumberForMatch(this.phone_number);
});

CallLeadSchema.pre("validate", function requireLeadIdentity() {
  if (!this.phone_number?.trim() && !this.job_no?.trim()) {
    this.invalidate("phone_number", "Call lead requires either phone_number or job_no");
  }
});

export type CallLeadDocument = InferSchemaType<typeof CallLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const CallLead: Model<CallLeadDocument> =
  mongoose.models.CallLead ?? mongoose.model<CallLeadDocument>("CallLead", CallLeadSchema);
