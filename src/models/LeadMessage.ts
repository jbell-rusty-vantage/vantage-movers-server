import mongoose, { Schema, type ClientSession, type Model } from "mongoose";
import {
  LEAD_MESSAGE_PURPOSES,
  LEAD_MESSAGE_STATUSES,
  LEAD_MESSAGING_MODES,
  getMongoDatabaseName,
  type LeadMessagePurpose,
  type LeadMessageStatus,
  type LeadMessagingMode,
} from "../config/domain";

export type LeadMessageAttempt = {
  attempt_number: number;
  started_at: Date;
  finished_at: Date | null;
  outcome: "accepted" | "retry_scheduled" | "uncertain" | "failed";
  twilio_message_sid: string | null | undefined;
  http_status: number | null;
  error_code: number | null;
  error_message: string | null;
  more_info: string | null;
};

export type LeadMessageStatusEvent = {
  twilio_message_sid: string;
  status: string;
  received_at: Date;
  error_code: number | null;
  error_message: string | null;
};

export type LeadMessageDocument = {
  _id: mongoose.Types.ObjectId;
  form_lead: mongoose.Types.ObjectId;
  provider: "twilio";
  channel: "sms";
  purpose: LeadMessagePurpose;
  message_key: string;
  template_version: number;
  to: string;
  from: string;
  body: string;
  dispatch_mode: LeadMessagingMode;
  status: LeadMessageStatus;
  skip_reason: string | null;
  twilio_message_sid: string | null;
  twilio_message_sids: string[];
  provider_status: string | null;
  attempts: LeadMessageAttempt[];
  status_history: LeadMessageStatusEvent[];
  attempt_count: number;
  next_attempt_at: Date | null;
  leased_until: Date | null;
  lease_owner: string | null;
  last_error_code: number | null;
  last_error_message: string | null;
  last_error_more_info: string | null;
  accepted_at: Date | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  manual_retry_requested_by: string | null;
  manual_retry_count: number;
  createdAt: Date;
  updatedAt: Date;
};

const attemptSchema = new Schema<LeadMessageAttempt>(
  {
    attempt_number: { type: Number, required: true },
    started_at: { type: Date, required: true },
    finished_at: { type: Date, default: null },
    outcome: {
      type: String,
      required: true,
      enum: ["accepted", "retry_scheduled", "uncertain", "failed"],
    },
    twilio_message_sid: { type: String, default: undefined },
    http_status: { type: Number, default: null },
    error_code: { type: Number, default: null },
    error_message: { type: String, default: null },
    more_info: { type: String, default: null },
  },
  { _id: false },
);

const statusEventSchema = new Schema<LeadMessageStatusEvent>(
  {
    twilio_message_sid: { type: String, required: true },
    status: { type: String, required: true },
    received_at: { type: Date, required: true },
    error_code: { type: Number, default: null },
    error_message: { type: String, default: null },
  },
  { _id: false },
);

const LeadMessageSchema = new Schema<LeadMessageDocument>(
  {
    form_lead: {
      type: Schema.Types.ObjectId,
      ref: "FormLead",
      required: true,
      index: true,
    },
    provider: { type: String, required: true, default: "twilio" },
    channel: { type: String, required: true, default: "sms" },
    purpose: { type: String, enum: LEAD_MESSAGE_PURPOSES, required: true },
    message_key: { type: String, required: true, trim: true },
    template_version: { type: Number, required: true },
    to: { type: String, required: true, trim: true },
    from: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    dispatch_mode: { type: String, enum: LEAD_MESSAGING_MODES, required: true },
    status: {
      type: String,
      enum: LEAD_MESSAGE_STATUSES,
      required: true,
      default: "pending",
    },
    skip_reason: { type: String, default: null },
    twilio_message_sid: { type: String, default: null },
    twilio_message_sids: { type: [String], default: [] },
    provider_status: { type: String, default: null },
    attempts: { type: [attemptSchema], default: [] },
    status_history: { type: [statusEventSchema], default: [] },
    attempt_count: { type: Number, required: true, default: 0 },
    next_attempt_at: { type: Date, default: null },
    leased_until: { type: Date, default: null },
    lease_owner: { type: String, default: null },
    last_error_code: { type: Number, default: null },
    last_error_message: { type: String, default: null },
    last_error_more_info: { type: String, default: null },
    accepted_at: { type: Date, default: null },
    sent_at: { type: Date, default: null },
    delivered_at: { type: Date, default: null },
    manual_retry_requested_by: { type: String, default: null },
    manual_retry_count: { type: Number, required: true, default: 0 },
  },
  {
    collection: "lead_messages",
    timestamps: true,
    minimize: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

LeadMessageSchema.index({ form_lead: 1, createdAt: -1 });
LeadMessageSchema.index(
  { twilio_message_sid: 1 },
  {
    unique: true,
    partialFilterExpression: { twilio_message_sid: { $type: "string" } },
  },
);
LeadMessageSchema.index({ twilio_message_sids: 1 });
LeadMessageSchema.index({ status: 1, next_attempt_at: 1, createdAt: 1 });
LeadMessageSchema.index({ leased_until: 1 });
LeadMessageSchema.index({ purpose: 1, status: 1, createdAt: -1 });

export const LeadMessage: Model<LeadMessageDocument> =
  (mongoose.models.LeadMessage as Model<LeadMessageDocument> | undefined) ??
  mongoose.model<LeadMessageDocument>("LeadMessage", LeadMessageSchema);

export function getLeadMessageModel(): Model<LeadMessageDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) return LeadMessage;
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.LeadMessage as Model<LeadMessageDocument> | undefined) ??
    db.model<LeadMessageDocument>("LeadMessage", LeadMessageSchema)
  );
}

export async function createLeadMessage(
  input: Omit<
    LeadMessageDocument,
    | "_id"
    | "attempts"
    | "status_history"
    | "attempt_count"
    | "next_attempt_at"
    | "leased_until"
    | "lease_owner"
    | "last_error_code"
    | "last_error_message"
    | "last_error_more_info"
    | "accepted_at"
    | "sent_at"
    | "delivered_at"
    | "manual_retry_requested_by"
    | "manual_retry_count"
    | "createdAt"
    | "updatedAt"
    | "twilio_message_sid"
    | "provider_status"
    | "twilio_message_sids"
  >,
  session?: ClientSession,
): Promise<LeadMessageDocument> {
  const Model = getLeadMessageModel();
  const message = new Model(input);
  return message.save({ session });
}
