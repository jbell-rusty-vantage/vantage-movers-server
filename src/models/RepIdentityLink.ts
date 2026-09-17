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
export const REP_IDENTITY_LINK_INDEXES = [
  {
    name: "ril_extension_current_unique",
    key: { rc_account_id: 1, rc_extension_id: 1 },
    unique: true as const,
    partialFilterExpression: { effective_to: null },
  },
  { name: "ril_agent_current", key: { agent_id: 1, effective_to: 1 } },
  { name: "ril_status", key: { status: 1 } },
] as const;

export const RepIdentityLinkSchema = new Schema(
  {
    revision: { type: Number, required: true, default: 1 },
    agent_id: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    agent_name_snapshot: { type: String, required: true, trim: true },
    rc_account_id: { type: String, required: true, trim: true },
    rc_extension_id: { type: String, required: true, trim: true },
    rc_extension_number: { type: String, default: null, trim: true },
    rc_extension_name_snapshot: { type: String, default: null, trim: true },
    rc_direct_numbers: { type: [String], default: [] }, // e164 DIDs observed on the extension
    rc_sms_sender_number: { type: String, default: null, trim: true }, // the DID with SmsSender, if any
    rc_team_messaging_person_id: { type: String, default: null, trim: true },
    rc_direct_chat_id: { type: String, default: null, trim: true }, // cached; re-resolved on send
    extension_user_id: {
      type: Schema.Types.ObjectId,
      ref: "ExtensionUser",
      default: null,
    },
    granot_username: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },
    role_kind: {
      type: String,
      required: true,
      enum: ["sales_rep", "service", "manager", "dialer", "shared", "excluded"],
    },
    status: {
      type: String,
      required: true,
      enum: ["proposed", "reviewed", "retired"],
      default: "proposed",
    },
    proposal_basis: { type: String, default: null, trim: true }, // "exact_full_name","first_token","owner"
    nudge_channels_allowed: { type: [String], default: ["team_messaging"] }, // subset of ["team_messaging","sms_to_rep","pager"]
    effective_from: { type: Date, required: true },
    effective_to: { type: Date, default: null },
    reviewed_by: { type: String, default: null, trim: true },
    reviewed_at: { type: Date, default: null },
    history: {
      type: [
        new Schema({ at: Date, by: String, change: String }, { _id: false }),
      ],
      default: [],
    },
  },
  {
    collection: "rep_identity_links",
    autoIndex: false,
    timestamps: true,
    minimize: false,
  },
);

export const getRepIdentityLinkModel = defineCsiModel(
  "RepIdentityLink",
  RepIdentityLinkSchema,
  REP_IDENTITY_LINK_INDEXES,
);
