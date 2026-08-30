import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import {
  LEAD_CONVERSATION_COLLECTION,
  LEAD_CONVERSATION_DIRECTIONS,
  LEAD_CONVERSATION_LEAD_MODELS,
  LEAD_CONVERSATION_MATCH_CONFIDENCES,
  LEAD_CONVERSATION_MATCH_METHODS,
  LEAD_CONVERSATION_PROVIDERS,
  LEAD_CONVERSATION_STATES,
} from "../config/domain/conversations";

export const LEAD_CONVERSATION_INDEXES = [
  {
    name: "lead_conversation_recording_unique",
    key: { provider: 1, provider_recording_id: 1 },
    unique: true as const,
  },
  {
    name: "lead_conversation_lead",
    key: { "lead_ref.model": 1, "lead_ref.id": 1, started_at: -1 },
  },
  {
    name: "lead_conversation_booking",
    key: { booking_ref: 1, started_at: -1 },
  },
  {
    name: "lead_conversation_work",
    key: { state: 1, next_attempt_at: 1 },
  },
  {
    name: "lead_conversation_window",
    key: { started_at: -1, _id: -1 },
  },
  {
    name: "lead_conversation_agent",
    key: { receiver_agent: 1, started_at: -1 },
  },
  {
    name: "lead_conversation_call_log",
    key: { call_log_id: 1 },
  },
] as const;

const leadRefSchema = new Schema(
  {
    model: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_LEAD_MODELS,
    },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const matchEvidenceSchema = new Schema(
  {
    queried_phone_national: { type: String, default: null, trim: true },
    window_from: { type: Date, default: null },
    window_to: { type: Date, default: null },
    candidate_count: { type: Number, default: null },
    chosen_reason: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const mediaSchema = new Schema(
  {
    blob_pathname: { type: String, default: null, trim: true },
    blob_url: { type: String, default: null, trim: true },
    bytes: { type: Number, default: null },
    content_type: { type: String, default: null, trim: true },
    stored_at: { type: Date, default: null },
    purged_at: { type: Date, default: null },
  },
  { _id: false },
);

const transcriptSchema = new Schema(
  {
    text: { type: String, required: true },
    model: { type: String, required: true, trim: true },
    chars: { type: Number, required: true },
    redactions: { type: Number, required: true },
    created_at: { type: Date, required: true },
  },
  { _id: false },
);

const summarySchema = new Schema(
  {
    text: { type: String, required: true },
    model: { type: String, required: true, trim: true },
    prompt_version: { type: String, required: true, trim: true },
    created_at: { type: Date, required: true },
  },
  { _id: false },
);

const lastErrorSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const costCentsSchema = new Schema(
  {
    stt: { type: Number, required: true },
    summary: { type: Number, required: true },
  },
  { _id: false },
);

const LeadConversationSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_PROVIDERS,
    },
    provider_recording_id: { type: String, required: true, trim: true },
    call_log_id: { type: String, required: true, trim: true },
    telephony_session_id: { type: String, default: null, trim: true },
    lead_ref: { type: leadRefSchema, default: null },
    booking_ref: {
      type: Schema.Types.ObjectId,
      ref: "BookedLead",
      default: null,
    },
    normalized_job_no: { type: String, default: null, trim: true },
    lead_source_company: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceCompany",
      default: null,
    },
    source_granularity_id: { type: Schema.Types.ObjectId, default: null },
    receiver_agent: {
      type: Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    receiver_agent_name_snapshot: { type: String, default: null, trim: true },
    match_method: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_MATCH_METHODS,
    },
    match_confidence: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_MATCH_CONFIDENCES,
    },
    match_evidence: { type: matchEvidenceSchema, default: undefined },
    direction: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_DIRECTIONS,
    },
    rc_result: { type: String, required: true, trim: true },
    started_at: { type: Date, required: true },
    duration_seconds: { type: Number, required: true },
    from_phone_masked: { type: String, required: true, trim: true },
    to_phone_masked: { type: String, required: true, trim: true },
    media: { type: mediaSchema, default: null },
    transcript: { type: transcriptSchema, default: null },
    summary: { type: summarySchema, default: null },
    state: {
      type: String,
      required: true,
      enum: LEAD_CONVERSATION_STATES,
      default: "discovered",
    },
    attempts: { type: Number, required: true, default: 0 },
    next_attempt_at: { type: Date, default: null },
    claimed_by: { type: String, default: null, trim: true },
    claim_expires_at: { type: Date, default: null },
    last_error: { type: lastErrorSchema, default: null },
    cost_cents: { type: costCentsSchema, default: null },
  },
  {
    collection: LEAD_CONVERSATION_COLLECTION,
    autoIndex: false,
    timestamps: true,
    minimize: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

for (const index of LEAD_CONVERSATION_INDEXES) {
  LeadConversationSchema.index(index.key, {
    name: index.name,
    ...("unique" in index && index.unique ? { unique: true } : {}),
  });
}

export type LeadConversationDocument = InferSchemaType<typeof LeadConversationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const LeadConversation: Model<LeadConversationDocument> =
  (mongoose.models.LeadConversation as Model<LeadConversationDocument> | undefined) ??
  mongoose.model<LeadConversationDocument>("LeadConversation", LeadConversationSchema);

export function getLeadConversationModel(): Model<LeadConversationDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return LeadConversation;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.LeadConversation as Model<LeadConversationDocument> | undefined) ??
    db.model<LeadConversationDocument>("LeadConversation", LeadConversationSchema)
  );
}
