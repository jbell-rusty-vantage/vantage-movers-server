import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";
import {
  aggregateRevisionSchemaFields,
  applyAggregateRevisionGuards,
  applyLeadProvenanceGuards,
  callLeadProvenanceSchemaFields,
  RECEIVER_AGENT_SOURCES,
} from "./granotLifecycleSchemas";
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
const ringCentralOriginalCallerSchema = new Schema(
  {
    phone_number: { type: String, required: true, trim: true },
    normalized_phone_number: { type: String, required: true, trim: true },
    captured_at: { type: Date, required: true },
  },
  { _id: false },
);

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
    start_time: { type: Date },
    end_time: { type: Date },
    answered_at: { type: Date },
    terminal_at: { type: Date },
    duration_seconds: { type: Number },
    route_id: {
      type: Schema.Types.ObjectId,
      ref: "RingCentralInboundRoute",
      index: true,
    },
    route_assignment_id: {
      type: Schema.Types.ObjectId,
      ref: "RingCentralInboundRouteAssignment",
      index: true,
    },
    target_phone_number: { type: String, trim: true, index: true },
    target_name: { type: String, trim: true },
    original_caller: {
      type: ringCentralOriginalCallerSchema,
      immutable: true,
    },
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
    post_to_granot: {
      type: Boolean,
      default: false,
      validate: {
        validator: function (
          this: { ingestion_origin?: string },
          value: boolean | undefined,
        ) {
          return this.ingestion_origin !== "granot_lead_created" || value !== true;
        },
        message: "Granot-created CallLead post_to_granot must remain false",
      },
    },
    // Set when the same caller phone + source_company already produced a
    // successful call lead within the duplicate window. Flagged (and zero-CPL)
    // so the owner can exclude it from lead spend rather than paying twice.
    duplicate: { type: Boolean, default: false, index: true },
    ringcentral: { type: ringCentralCallMetadataSchema, default: undefined },
    created_on_unmatched: { type: Boolean, default: false, index: true },
    no_sync: { type: Boolean, default: false },
    pickup_city: { type: String, trim: true },
    pickup_zip: { type: String, trim: true },
    delivery_city: { type: String, trim: true },
    delivery_zip: { type: String, trim: true },
    pickup_state: { type: String, trim: true, uppercase: true },
    delivery_state: { type: String, trim: true, uppercase: true },
    cubic_feet: { type: Number },
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
    // Who originally received/worked this lead (independent of BookedLead's
    // agent_allocations, which tracks who gets commission/credit for closing
    // it). See `receiverAgentSourceEnum` for the provenance values.
    receiver_agent: { type: Schema.Types.ObjectId, ref: "Agent", index: true },
    receiver_agent_name_snapshot: { type: String, trim: true },
    receiver_agent_source: {
      type: String,
      enum: RECEIVER_AGENT_SOURCES,
    },
    receiver_agent_source_value: { type: String, trim: true },
    receiver_agent_set_at: { type: Date },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
    ...callLeadProvenanceSchemaFields,
    ...aggregateRevisionSchemaFields,
  },
  {
    collection: "call_leads",
    autoIndex: false,
    timestamps: true,
    optimisticConcurrency: true,
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
CallLeadSchema.index({ source_granularity_id: 1, timestamp: 1, _id: 1 });
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
export const CALL_LEAD_S08_INDEXES = [
  {
    name: "call_lead_source_granularity_normalized_job_no",
    key: { source_granularity_id: 1, normalized_job_no: 1 },
    accepted_names: [
      "call_lead_source_granularity_normalized_job_no",
      "source_granularity_id_1_normalized_job_no_1",
    ],
  },
  {
    name: "call_lead_source_granularity_normalized_phone_created",
    key: {
      source_granularity_id: 1,
      normalized_phone_number: 1,
      createdAt: -1,
    },
    accepted_names: [
      "call_lead_source_granularity_normalized_phone_created",
      "source_granularity_id_1_normalized_phone_number_1_createdAt_-1",
    ],
  },
  {
    name: "call_lead_origin_source_ingested_phone_created",
    key: {
      ingestion_origin: 1,
      source_granularity_id: 1,
      "ingested_contact_snapshot.normalized_phone_number": 1,
      createdAt: -1,
    },
    accepted_names: [
      "call_lead_origin_source_ingested_phone_created",
      "ingestion_origin_1_source_granularity_id_1_ingested_contact_snapshot.normalized_phone_number_1_createdAt_-1",
    ],
  },
] as const;

for (const index of CALL_LEAD_S08_INDEXES) {
  CallLeadSchema.index(index.key, { name: index.name });
}

applyLeadProvenanceGuards(CallLeadSchema);
applyAggregateRevisionGuards(CallLeadSchema);

CallLeadSchema.pre("validate", function normalizePhoneNumber() {
  this.normalized_phone_number = normalizePhoneNumberForMatch(this.phone_number);
  this.normalized_job_no = normalizeJobNo(this.job_no);
});

CallLeadSchema.pre("validate", function requireLeadIdentity() {
  if (!this.phone_number?.trim() && !this.job_no?.trim()) {
    this.invalidate("phone_number", "Call lead requires either phone_number or job_no");
  }
});

CallLeadSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"],
  function rejectRingCentralCallerReplacement() {
    const update = this.getUpdate() as
      | {
          ringcentral?: unknown;
          $set?: { ringcentral?: unknown };
        }
      | null;
    const replacesRingCentral =
      update?.ringcentral != null || update?.$set?.ringcentral != null;
    if (!replacesRingCentral) return;
    const callerGuard = (
      this.getFilter() as Record<string, unknown>
    )["ringcentral.original_caller"];
    const explicitlyAbsent =
      callerGuard != null &&
      typeof callerGuard === "object" &&
      "$exists" in callerGuard &&
      (callerGuard as { $exists?: unknown }).$exists === false;
    if (!explicitlyAbsent) {
      throw new Error(
        "RingCentral metadata with original caller evidence is immutable.",
      );
    }
  },
);

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
