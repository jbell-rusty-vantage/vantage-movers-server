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
export const NUMBER_LEAD_ATTACHMENT_INDEXES = [
  {
    name: "nla_pair_unique",
    key: { contact_number_id: 1, "lead_ref.model": 1, "lead_ref.id": 1 },
    unique: true as const,
  },
  {
    name: "nla_lead_state",
    key: { "lead_ref.model": 1, "lead_ref.id": 1, state: 1 },
  },
  { name: "nla_number_state", key: { contact_number_id: 1, state: 1 } },
  { name: "nla_state_updated", key: { state: 1, updatedAt: -1 } },
] as const;

const attachmentEvidenceSchema = new Schema(
  {
    source: {
      type: String,
      required: true,
      enum: [
        "call_lead_ringcentral_identity", // exact
        "ringcentral_call_adoption", // exact
        "owner_attach", // exact
        "lead_phone_live",
        "ingested_contact_snapshot",
        "granot_contact_snapshot",
        "ringcentral_original_caller",
        "assignment_context", // reserved
      ],
    },
    field_path: { type: String, required: true, trim: true }, // e.g. "form_leads.normalized_phone_number"
    observed_at: { type: Date, required: true }, // when the evidence was true
    window_from: { type: Date, default: null },
    window_to: { type: Date, default: null },
    candidate_count_at_suggest: { type: Number, default: null },
    // CSI-05: pin exact identity to immutable, account-scoped interaction evidence.
    interaction_id: { type: Schema.Types.ObjectId, default: null },
    provider_account_id: { type: String, default: null },
    identity_kind: { type: String, enum: [null, "telephony_session_id", "session_id", "call_log_id"], default: null },
    identity_value: { type: String, default: null },
  },
  { _id: false },
);

export const NumberLeadAttachmentSchema = new Schema(
  {
    contact_number_id: {
      type: Schema.Types.ObjectId,
      ref: "ContactNumber",
      required: true,
    },
    lead_ref: {
      type: new Schema(
        {
          model: {
            type: String,
            required: true,
            enum: ["FormLead", "CallLead"],
          },
          id: { type: Schema.Types.ObjectId, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    state: {
      type: String,
      required: true,
      enum: ["candidate", "ambiguous", "attached", "rejected"],
    },
    certainty: {
      type: String,
      required: true,
      enum: ["exact", "likely", "unsure", "owner_confirmed", "rejected"],
    },
    evidence: { type: [attachmentEvidenceSchema], default: [] },
    lead_snapshot: {
      // display cache; refresh in worker, never mutate on GET
      type: new Schema(
        {
          name: { type: String, default: null },
          job_no: { type: String, default: null },
          source_label: { type: String, default: null },
          lead_timestamp: { type: Date, default: null },
          booked: { type: Boolean, default: false },
          cancelled: { type: Boolean, default: false },
          duplicate: { type: Boolean, default: false },
          bad_lead: { type: Boolean, default: false },
          receiver_agent_name: { type: String, default: null },
          refreshed_at: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    revision: { type: Number, required: true, default: 1 },
    decided_by: { type: String, default: null, trim: true }, // actor label for owner decisions
    decided_at: { type: Date, default: null },
    decision_reason: { type: String, default: null, trim: true },
    // High-confidence automatic attach. Never `decided_at`: that field marks the Owner's
    // reviewed decision, which refresh and fan-in may never revise.
    auto_decision: {
      type: new Schema(
        {
          confidence: { type: Number, required: true, min: 0, max: 1 },
          reason: { type: String, required: true, trim: true },
          decided_at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    history: {
      type: [
        new Schema(
          { from: String, to: String, at: Date, by: String, reason: String },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  {
    collection: "number_lead_attachments",
    autoIndex: false,
    timestamps: true,
    minimize: false,
  },
);

export const getNumberLeadAttachmentModel = defineCsiModel(
  "NumberLeadAttachment",
  NumberLeadAttachmentSchema,
  NUMBER_LEAD_ATTACHMENT_INDEXES,
);
