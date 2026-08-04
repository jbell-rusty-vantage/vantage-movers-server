import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const candidateSnapshotSchema = new Schema(
  {
    lead_model: { type: String, enum: ["FormLead", "CallLead"], required: true },
    lead_id: { type: Schema.Types.ObjectId, required: true },
    confidence: { type: String, enum: ["high", "medium", "low"], required: true },
    match_methods: {
      type: [String],
      enum: ["lid", "job_no", "phone", "email", "normalized_name"],
      default: [],
    },
    eligibility: {
      type: String,
      enum: ["eligible", "duplicate", "booked", "cancelled"],
      required: true,
    },
    source_compatibility: {
      type: String,
      enum: ["exact_granularity", "same_company", "unassigned", "conflict"],
      required: true,
    },
    warnings: { type: [String], default: [] },
    snapshot: {
      name: { type: String, trim: true },
      phone_number: { type: String, trim: true },
      email: { type: String, trim: true },
      lid: { type: String, trim: true },
      job_no: { type: String, trim: true },
      source_company: { type: String, trim: true },
      source_granularity_key: { type: String, trim: true },
      booked: { type: String, trim: true },
      cancelled: { type: String, trim: true },
      duplicate: { type: Boolean },
    },
  },
  { _id: false },
);

const matchAttemptSchema = new Schema(
  {
    attempted_at: { type: Date, required: true },
    trigger: {
      type: String,
      enum: ["initial", "delayed_retry", "owner_refresh"],
      required: true,
    },
    outcome: {
      type: String,
      enum: ["high_confidence", "conflict", "no_match", "error"],
      required: true,
    },
    reason: { type: String, required: true, trim: true },
    candidate_count: { type: Number, required: true, min: 0 },
    candidate_snapshot_hash: { type: String, required: true, trim: true },
    auto_match_policy_version: { type: String, required: true, trim: true },
    enabled_auto_match_rules: { type: [String], default: [] },
  },
  { _id: false },
);

const resolutionHistorySchema = new Schema(
  {
    action: {
      type: String,
      enum: [
        "auto_attach_delayed",
        "attach_existing",
        "create_and_attach",
        "dismiss",
        "reopen",
        "reassign",
        "update_submission",
        "booking_cancelled",
      ],
      required: true,
    },
    lead_model: { type: String, enum: ["FormLead", "CallLead"] },
    lead_id: { type: Schema.Types.ObjectId },
    source_resolution: {
      type: String,
      enum: ["preserve_lead_source", "apply_submission_source"],
    },
    overridden_warnings: { type: [String], default: [] },
    actor: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    occurred_at: { type: Date, required: true },
  },
  { _id: false },
);

const BookingLeadReconciliationCaseSchema = new Schema(
  {
    booking: {
      type: Schema.Types.ObjectId,
      ref: "BookedLead",
      required: true,
      unique: true,
      index: true,
    },
    origin: {
      type: String,
      enum: ["employee_booking", "external_sheet_ingestion"],
      required: true,
      default: "employee_booking",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "dismissed"],
      required: true,
      default: "pending",
      index: true,
    },
    reason: {
      type: String,
      enum: [
        "no_match",
        "multiple_matches",
        "identity_conflict",
        "source_conflict",
        "channel_conflict",
        "duplicate_lead",
        "lead_already_booked",
        "lead_cancelled",
        "matching_unavailable",
      ],
      required: true,
      index: true,
    },
    submission: {
      submission_id: { type: String, required: true, trim: true },
      lead_name: { type: String, required: true, trim: true },
      normalized_name: { type: String, trim: true },
      phone_number: { type: String, required: true, trim: true },
      normalized_phone_number: { type: String, required: true, trim: true },
      email: { type: String, trim: true },
      normalized_email: { type: String, trim: true },
      lid: { type: String, trim: true },
      normalized_lid: { type: String, trim: true },
      job_no: { type: String, required: true, trim: true },
      normalized_job_no: { type: String, required: true, trim: true },
      binder_amount: { type: Number, required: true, min: 0 },
      deposit_amount: { type: Number, required: true, min: 0 },
      merchant: { type: String, required: true, trim: true },
      agent: { type: String, required: true, trim: true },
      split_agent: { type: String, trim: true },
      book_date: { type: Date, required: true },
      source_assignment: {
        lead_source_company: {
          type: Schema.Types.ObjectId,
          ref: "LeadSourceCompany",
          required: true,
        },
        source_granularity_id: { type: Schema.Types.ObjectId, required: true },
        source_granularity_key: { type: String, required: true, trim: true },
        source_company: { type: String, required: true, trim: true },
        source_company_label_snapshot: { type: String, required: true, trim: true },
        source_granularity_label_snapshot: {
          type: String,
          required: true,
          trim: true,
        },
        crm_source_label_snapshot: { type: String, required: true, trim: true },
        channel: { type: String, enum: ["form", "call"], required: true },
      },
    },
    latest_candidates: { type: [candidateSnapshotSchema], default: [] },
    match_attempts: { type: [matchAttemptSchema], default: [] },
    retry: {
      attempt_count: { type: Number, required: true, default: 0 },
      next_attempt_at: { type: Date, index: true },
      leased_until: { type: Date },
      lease_owner: { type: String, trim: true },
      last_error: { type: String, trim: true },
    },
    resolution_history: { type: [resolutionHistorySchema], default: [] },
    revision: { type: Number, required: true, default: 0 },
  },
  {
    collection: "booking_lead_reconciliation_cases",
    timestamps: true,
    optimisticConcurrency: true,
  },
);

BookingLeadReconciliationCaseSchema.index({ status: 1, createdAt: -1 });
BookingLeadReconciliationCaseSchema.index({ origin: 1, status: 1, createdAt: -1 });
BookingLeadReconciliationCaseSchema.index({ status: 1, "retry.next_attempt_at": 1 });
BookingLeadReconciliationCaseSchema.index({ reason: 1, status: 1, updatedAt: -1 });
BookingLeadReconciliationCaseSchema.index({ "submission.normalized_job_no": 1, createdAt: -1 });
BookingLeadReconciliationCaseSchema.index({ "submission.normalized_phone_number": 1 });
BookingLeadReconciliationCaseSchema.index({ "submission.normalized_lid": 1 });
BookingLeadReconciliationCaseSchema.index({ "submission.normalized_email": 1 });
BookingLeadReconciliationCaseSchema.index({ "submission.normalized_name": 1 });

export type BookingLeadReconciliationCaseDocument = InferSchemaType<
  typeof BookingLeadReconciliationCaseSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const BookingLeadReconciliationCase: Model<BookingLeadReconciliationCaseDocument> =
  mongoose.models.BookingLeadReconciliationCase ??
  mongoose.model<BookingLeadReconciliationCaseDocument>(
    "BookingLeadReconciliationCase",
    BookingLeadReconciliationCaseSchema,
  );
