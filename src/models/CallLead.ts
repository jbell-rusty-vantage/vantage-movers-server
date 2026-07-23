import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";
import {
  optionalLocalField,
  sheetSyncSchema,
  sourceCompanyField,
  type SheetSyncEntry,
} from "./schemaHelpers";
import { normalizePhoneNumberForMatch } from "../utils/phone";
import { normalizeJobNo } from "../services/bookings/bookingIdentity";

/**
 * Provenance + qualification metadata for call leads created from the
 * RingCentral hybrid pipeline (telephony webhook or Call Log cron sync).
 * Manual/API-created call leads leave this undefined. `telephony_session_id`
 * is the cross-path idempotency key: a unique sparse index guarantees one
 * lead per RingCentral session no matter how many times the webhook fires or
 * the cron re-scans the same window.
 */
const ringCentralCallMetadataSchema = new Schema(
  {
    telephony_session_id: { type: String, trim: true },
    session_id: { type: String, trim: true },
    party_id: { type: String, trim: true },
    call_log_id: { type: String, trim: true },
    source_label: { type: String, trim: true },
    ingestion_source: {
      type: String,
      enum: ["webhook", "call_log_sync", "manual"],
    },
    qualification_reason: { type: String, trim: true },
    answered_at: { type: Date },
    terminal_at: { type: Date },
    duration_seconds: { type: Number },
  },
  { _id: false },
);

const CallLeadSchema = new Schema(
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
    source_company_site: { type: String, trim: true },
    timestamp: { type: Date, required: true, default: Date.now },
    job_no: { type: String, trim: true },
    normalized_job_no: { type: String, trim: true },
    name: { type: String, trim: true },
    first_name: { type: String, trim: true },
    last_name: { type: String, trim: true },
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
    // Set when the same caller phone + source_company already produced a
    // successful call lead within the duplicate window. Flagged (and zero-CPL)
    // so the owner can exclude it from lead spend rather than paying twice.
    duplicate: { type: Boolean, default: false, index: true },
    ringcentral: { type: ringCentralCallMetadataSchema, default: undefined },
    created_on_unmatched: { type: Boolean, default: false, index: true },
    pickup_city: { type: String, trim: true },
    pickup_zip: { type: String, trim: true },
    delivery_city: { type: String, trim: true },
    delivery_zip: { type: String, trim: true },
    pickup_state: { type: String, trim: true, uppercase: true },
    delivery_state: { type: String, trim: true, uppercase: true },
    cubic_feet: { type: Number },
    cpl: { type: Number, required: true, default: 0 },
    // Who originally received/worked this lead (independent of BookedLead's
    // agent_allocations, which tracks who gets commission/credit for closing
    // it). See `receiverAgentSourceEnum` for the provenance values.
    receiver_agent: { type: Schema.Types.ObjectId, ref: "Agent", index: true },
    receiver_agent_name_snapshot: { type: String, trim: true },
    receiver_agent_source: {
      type: String,
      enum: [
        "extension_match",
        "extension_selected",
        "extension_created",
        "extension_crm_username_match",
        "manual",
      ],
    },
    receiver_agent_source_value: { type: String, trim: true },
    receiver_agent_set_at: { type: Date },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
  },
  {
    collection: "call_leads",
    autoIndex: false,
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

CallLeadSchema.index({ source_company: 1, createdAt: -1 });
CallLeadSchema.index({ lead_source_company: 1, createdAt: -1 });
CallLeadSchema.index({ lead_source_company: 1, source_granularity_key: 1, createdAt: -1 });
CallLeadSchema.index({ phone_number: 1 });
CallLeadSchema.index({ normalized_phone_number: 1, createdAt: -1 });
CallLeadSchema.index({ job_no: 1 });
CallLeadSchema.index({ normalized_job_no: 1 });
CallLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  normalized_job_no: 1,
});
// Cross-path idempotency: at most one lead per RingCentral telephony session.
CallLeadSchema.index(
  { "ringcentral.telephony_session_id": 1 },
  { unique: true, sparse: true },
);
// Supports the duplicate-window lookup (same caller + source within 90 days of call timestamp).
CallLeadSchema.index({
  source_company: 1,
  normalized_phone_number: 1,
  duplicate: 1,
  timestamp: -1,
});

CallLeadSchema.pre("validate", function normalizePhoneNumber() {
  this.normalized_phone_number = normalizePhoneNumberForMatch(this.phone_number);
  this.normalized_job_no = normalizeJobNo(this.job_no);
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

export function getCallLeadModel(): Model<CallLeadDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return CallLead;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.CallLead as Model<CallLeadDocument> | undefined) ??
    db.model<CallLeadDocument>("CallLead", CallLeadSchema)
  );
}
