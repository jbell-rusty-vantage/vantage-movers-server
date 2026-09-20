import { Schema } from "mongoose";
import {
  defineCsiModel,
  actor as registryActorSnapshotSchema,
  leadRef as leadRefSchema,
  revision,
  validatedJson,
} from "./salesIntelligence/common";
import { csiNudgeCommandSchema } from "../validation/v1/salesIntelligence";
export const OWNER_REP_NUDGE_INDEXES = [
  {
    name: "nudge_idempotency_unique",
    key: { idempotency_key: 1 },
    unique: true as const,
  },
  {
    name: "nudge_outreach_created",
    key: { outreach_record_id: 1, createdAt: -1 },
  },
  {
    name: "nudge_link_created",
    key: { rep_identity_link_id: 1, createdAt: -1 },
  },
  {
    name: "nudge_extension_created",
    key: { rc_account_id: 1, rc_extension_id: 1, createdAt: -1 },
  }, // per-User rate limit
  { name: "nudge_status", key: { status: 1, createdAt: -1 } },
] as const;

export const OwnerRepNudgeSchema = new Schema(
  {
    idempotency_key: { type: String, required: true, trim: true },
    revision,
    command_id: { type: Schema.Types.ObjectId, default: null },
    authorized_command: { ...validatedJson(csiNudgeCommandSchema), required: false },
    send_expires_at: { type: Date, default: null },
    submission_started_at: { type: Date, default: null },
    provider_receipt_at: { type: Date, default: null },
    expected_outreach_revision: { type: Number, default: null },
    recipient_person_id: { type: String, default: null },
    sender_person_id: { type: String, default: null },
    sender_extension_id: { type: String, default: null },
    sender_did: { type: String, default: null },
    sender_extension_number: { type: String, default: null },
    provider_account_id: { type: String, default: null },
    purpose: { type: String, enum: ["call_suggestion", "review_context"], default: "review_context" },
    actor: { type: registryActorSnapshotSchema, required: true }, // reuse Operations Registry actor snapshot shape
    outreach_record_id: {
      type: Schema.Types.ObjectId,
      ref: "OutreachRecord",
      default: null,
    },
    contact_number_id: {
      type: Schema.Types.ObjectId,
      ref: "ContactNumber",
      default: null,
    },
    lead_ref: { type: leadRefSchema, default: null },
    rc_account_id: { type: String, required: true, trim: true },
    rc_extension_id: { type: String, required: true, trim: true },
    rc_extension_number: { type: String, default: null, trim: true },
    rc_extension_name_snapshot: { type: String, default: null, trim: true },
    rep_identity_link_id: {
      type: Schema.Types.ObjectId,
      ref: "RepIdentityLink",
      default: null,
    },
    agent_id: { type: Schema.Types.ObjectId, ref: "Agent", default: null },
    channel: {
      type: String,
      required: true,
      enum: ["team_messaging", "sms_to_rep", "pager"],
    },
    destination: { type: String, required: true, trim: true }, // chat id, rep DID e164, or extension number — validated ≠ any customer number
    template_key: { type: String, required: true, trim: true },
    template_version: { type: Number, required: true },
    body_as_sent: { type: String, required: true }, // ≤ 1,000 chars; masked customer number policy applies (last 4 only)
    preconditions_snapshot: {
      // what was true at send time
      type: new Schema(
        {
          outreach_state: String,
          overdue: Boolean,
          attachment_certainty: String,
          rep_link_status: String,
          policy_version: String,
        },
        { _id: false },
      ),
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["pending", "sent", "failed", "unknown_delivery", "fallback_sent"],
      default: "pending",
    },
    provider_message_id: { type: String, default: null, trim: true },
    provider_response_status: { type: Number, default: null },
    fallback_channel: { type: String, default: null, enum: [null, "pager"] },
    error_code: { type: String, default: null, trim: true }, // bounded closed set; never provider body
    sent_at: { type: Date, default: null },
  },
  {
    collection: "owner_rep_nudges",
    autoIndex: false,
    timestamps: true,
    minimize: false,
  },
);

export const getOwnerRepNudgeModel = defineCsiModel(
  "OwnerRepNudge",
  OwnerRepNudgeSchema,
  OWNER_REP_NUDGE_INDEXES,
);
