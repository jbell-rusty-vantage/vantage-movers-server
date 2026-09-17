import { Schema } from "mongoose";
import {
  defineCsiModel,
  actor as registryActorSnapshotSchema,
  leadRef as leadRefSchema,
} from "./salesIntelligence/common";
import {
  CONTACT_NUMBER_CLASSIFICATIONS,
  CONTACT_ELIGIBILITY_STATES,
  CONTACT_NUMBER_KINDS,
} from "../config/domain/salesIntelligence";
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
  }, // per-rep rate limit
  { name: "nudge_status", key: { status: 1, createdAt: -1 } },
] as const;

export const OwnerRepNudgeSchema = new Schema(
  {
    idempotency_key: { type: String, required: true, trim: true },
    actor: { type: registryActorSnapshotSchema, required: true }, // reuse Operations Registry actor snapshot shape
    outreach_record_id: {
      type: Schema.Types.ObjectId,
      ref: "OutreachRecord",
      required: true,
    },
    contact_number_id: {
      type: Schema.Types.ObjectId,
      ref: "ContactNumber",
      required: true,
    },
    lead_ref: { type: leadRefSchema, default: null },
    rep_identity_link_id: {
      type: Schema.Types.ObjectId,
      ref: "RepIdentityLink",
      required: true,
    },
    agent_id: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
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
