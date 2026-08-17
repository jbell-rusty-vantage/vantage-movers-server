import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  FORM_LEAD_BAD_LEAD_REASONS,
  getMongoDatabaseName,
  MOVE_SIZES,
} from "../config/domain";
import {
  aggregateRevisionSchemaFields,
  applyAggregateRevisionGuards,
  applyLeadProvenanceGuards,
  formLeadProvenanceSchemaFields,
  RECEIVER_AGENT_SOURCES,
} from "./granotLifecycleSchemas";
import { normalizeJobNo } from "../services/bookings/bookingIdentity";
import {
  localField,
  sheetSyncSchema,
  sourceCompanyField,
  type SheetSyncEntry,
} from "./schemaHelpers";
import {
  normalizeComparisonName,
  normalizeSubmissionLid,
} from "../services/bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../utils/phone";

export const FORM_LEAD_UNKNOWN_STATE = "not_found";

const FormLeadSchema = new Schema(
  {
    source_company: sourceCompanyField,
    lead_source_company: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceCompany",
      index: true,
    },
    source_granularity_id: { type: Schema.Types.ObjectId, index: true },
    source_granularity_key: { type: String, trim: true, lowercase: true, index: true },
    source_company_label_snapshot: { type: String, trim: true },
    source_granularity_label_snapshot: { type: String, trim: true },
    crm_source_label_snapshot: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    first_name: { type: String, trim: true },
    last_name: { type: String, trim: true },
    source_company_site: { type: String, trim: true },
    timestamp: { type: Date, required: true, default: Date.now },
    lid: { type: String, trim: true },
    normalized_lid: { type: String, trim: true },
    pickup_city: { type: String, trim: true },
    pickup_zip: { type: String, required: true, trim: true },
    delivery_city: { type: String, trim: true },
    destination_zip: { type: String, required: true, trim: true },
    pickup_state: { type: String, trim: true, default: FORM_LEAD_UNKNOWN_STATE },
    delivery_state: { type: String, trim: true, default: FORM_LEAD_UNKNOWN_STATE },
    move_size: { type: String, enum: MOVE_SIZES },
    move_date: { type: Date, required: true, default: Date.now },
    ref_no: { type: String, trim: true, default: "not provided" },
    booked: { type: Schema.Types.ObjectId, ref: "BookedLead" },
    over_2000: { type: Boolean, default: false },
    over_4000: { type: Boolean, default: false },
    local: localField,
    email: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, required: true, trim: true },
    normalized_phone_number: { type: String, trim: true },
    normalized_contact_name: { type: String, trim: true },
    cpl: { type: Number, required: true, default: 0 },
    cpl_rate_period: {
      type: Schema.Types.ObjectId,
      ref: "CplRatePeriod",
      index: true,
    },
    cpl_resolution_status: {
      type: String,
      enum: ["resolved", "missing_rate", "duplicate_zero", "not_applicable"],
      index: true,
    },
    cpl_resolved_at: { type: Date },
    cpl_resolution_version: { type: String, trim: true },
    cpl_correction: {
      job_id: { type: Schema.Types.ObjectId, ref: "CplCorrectionJob" },
      corrected_at: { type: Date },
      previous_cpl: { type: Number },
    },
    quoted: { type: Boolean, default: false },
    duplicate: { type: Boolean, default: false, index: true },
    bad_lead: {
      type: String,
      enum: FORM_LEAD_BAD_LEAD_REASONS,
      trim: true,
      index: true,
    },
    post_to_granot: { type: Boolean, required: true, default: true },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    cubic_feet: { type: Number },
    // Who originally received/worked this lead (independent of BookedLead's
    // agent_allocations, which tracks who gets commission/credit for closing
    // it). See `receiver_agent_source` enum for the provenance values.
    receiver_agent: { type: Schema.Types.ObjectId, ref: "Agent", index: true },
    receiver_agent_name_snapshot: { type: String, trim: true },
    receiver_agent_source: {
      type: String,
      enum: RECEIVER_AGENT_SOURCES,
    },
    receiver_agent_source_value: { type: String, trim: true },
    receiver_agent_set_at: { type: Date },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
    ...formLeadProvenanceSchemaFields,
    ...aggregateRevisionSchemaFields,
  },
  {
    collection: "form_leads",
    autoIndex: false,
    optimisticConcurrency: true,
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

FormLeadSchema.index({ source_company: 1, createdAt: -1 });
FormLeadSchema.index({ lead_source_company: 1, createdAt: -1 });
FormLeadSchema.index({ lead_source_company: 1, source_granularity_key: 1, createdAt: -1 });
FormLeadSchema.index({ phone_number: 1 });
FormLeadSchema.index({ ref_no: 1 });
FormLeadSchema.index({ email: 1 });
FormLeadSchema.index({ normalized_lid: 1 }, { sparse: true });
FormLeadSchema.index({ normalized_phone_number: 1 });
FormLeadSchema.index({ normalized_contact_name: 1 });
FormLeadSchema.index({ source_granularity_id: 1, timestamp: 1, _id: 1 });
FormLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  normalized_lid: 1,
});
FormLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  normalized_phone_number: 1,
});
FormLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  email: 1,
  normalized_contact_name: 1,
});
FormLeadSchema.index({ normalized_job_no: 1 });
FormLeadSchema.index({ source_granularity_id: 1, normalized_job_no: 1 });
FormLeadSchema.index({
  source_granularity_id: 1,
  normalized_phone_number: 1,
  duplicate: 1,
});
FormLeadSchema.index({ ref_no: 1, duplicate: 1 });

applyLeadProvenanceGuards(FormLeadSchema);
applyAggregateRevisionGuards(FormLeadSchema);

FormLeadSchema.pre("validate", function normalizeEmployeeBookingFields() {
  this.normalized_lid = normalizeSubmissionLid(this.lid);
  this.normalized_phone_number = normalizePhoneNumberForMatch(this.phone_number);
  this.normalized_contact_name = normalizeComparisonName(this.name);
  this.normalized_job_no = normalizeJobNo(this.job_no);
});

export type FormLeadDocument = InferSchemaType<typeof FormLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const FormLead: Model<FormLeadDocument> =
  mongoose.models.FormLead ??
  mongoose.model<FormLeadDocument>("FormLead", FormLeadSchema);

export function getFormLeadModel(): Model<FormLeadDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return FormLead;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.FormLead as Model<FormLeadDocument> | undefined) ??
    db.model<FormLeadDocument>("FormLead", FormLeadSchema)
  );
}
