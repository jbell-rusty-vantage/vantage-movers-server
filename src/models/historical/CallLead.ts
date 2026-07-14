import mongoose, {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import {
  ImportMetadataFields,
  optionalLocalField,
  sourceCompanyField,
} from "./schemaHelpers";

export const HistoricalCallLeadSchema = new Schema(
  {
    source_company: sourceCompanyField,
    ...ImportMetadataFields,
    source_company_site: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
    job_no: { type: String, trim: true },
    normalized_job_no: { type: String, trim: true, index: true },
    name: { type: String, trim: true },
    normalized_name: { type: String, trim: true, lowercase: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, trim: true },
    normalized_phone_number: { type: String, trim: true },
    duration: { type: Number },
    start_time: { type: Date },
    end_time: { type: Date },
    booked: { type: Schema.Types.ObjectId, ref: "BookedLead" },
    sheet_booked: { type: Boolean, default: false },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    over_2000: { type: Boolean, default: false },
    over_4000: { type: Boolean, default: false },
    local: optionalLocalField,
    pickup_city: { type: String, trim: true },
    pickup_zip: { type: String, trim: true },
    delivery_city: { type: String, trim: true },
    delivery_zip: { type: String, trim: true },
    pickup_state: { type: String, trim: true, uppercase: true },
    delivery_state: { type: String, trim: true, uppercase: true },
    cubic_feet: { type: Number },
    cpl: { type: Number, default: 0 },
  },
  {
    collection: "call_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

HistoricalCallLeadSchema.index({ source_company: 1, createdAt: -1 });
HistoricalCallLeadSchema.index({ phone_number: 1 });
HistoricalCallLeadSchema.index({ normalized_phone_number: 1, createdAt: -1 });
HistoricalCallLeadSchema.index({
  source_workbook: 1,
  source_tab: 1,
  source_row: 1,
});

HistoricalCallLeadSchema.pre("validate", function normalizePhoneNumber() {
  if (this.phone_number) {
    this.normalized_phone_number = normalizePhoneNumberForMatch(
      this.phone_number,
    );
  }
});

export type HistoricalCallLeadDocument = InferSchemaType<
  typeof HistoricalCallLeadSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export function registerHistoricalCallLead(
  connection: Connection,
): Model<HistoricalCallLeadDocument> {
  return (
    connection.models.CallLead ??
    connection.model<HistoricalCallLeadDocument>(
      "CallLead",
      HistoricalCallLeadSchema,
    )
  );
}
