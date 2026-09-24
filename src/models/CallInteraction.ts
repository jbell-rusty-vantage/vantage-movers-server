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
// src/models/CallInteraction.ts
export const CALL_INTERACTION_INDEXES = [
  {
    name: "call_interaction_session_unique",
    key: { provider: 1, provider_account_id: 1, telephony_session_id: 1 },
    unique: true as const,
    partialFilterExpression: { telephony_session_id: { $type: "string" } },
  },
  {
    name: "call_interaction_session_id",
    key: { provider: 1, provider_account_id: 1, session_id: 1 },
    sparse: true,
  },
  {
    name: "call_interaction_call_log_ids",
    key: { provider: 1, provider_account_id: 1, call_log_ids: 1 },
  },
  // `_id` completes the timeline's total order so the keyset read needs no sort stage (14 §9).
  {
    name: "call_interaction_number_started_id",
    key: { contact_number_id: 1, started_at: -1, _id: -1 },
  },
  // Serves the Coverage discovery counters without a collection scan (14 §1).
  {
    name: "call_interaction_discovery_state",
    key: { merged_into_id: 1, terminal: 1, "recording_discovery.state": 1 },
  },
  { name: "call_interaction_started_window", key: { started_at: -1, _id: -1 } },
  {
    name: "call_interaction_extension_started",
    key: { "parties.extension_id": 1, started_at: -1 },
  },
  {
    name: "call_interaction_recording",
    key: { "recordings.provider_recording_id": 1 },
    sparse: true,
  },
  {
    name: "call_interaction_provider_modified",
    key: { provider_last_modified_at: -1 },
  },
  { name: "call_interaction_updated", key: { updatedAt: -1, _id: -1 } }, // repair/read index; SSE uses the durable audit stream
  // CC-04: the reconcile finds provisional rows (oldest first) to re-read and to bound
  // `known_complete_through`; Coverage counts them.
  {
    name: "call_interaction_call_log_state_started",
    key: { call_log_state: 1, started_at: 1 },
  },
] as const;

const partySchema = new Schema(
  {
    party_id: { type: String, default: null, trim: true },
    last_webhook_sequence: { type: Number, default: null }, // sequence is tracked per party
    last_event_at: { type: Date, default: null },
    role: {
      type: String,
      required: true,
      enum: [
        "external",
        "user",
        "queue",
        "ivr",
        "voicemail",
        "monitoring",
        "unknown",
      ],
    },
    direction: {
      type: String,
      default: null,
      enum: [null, "Inbound", "Outbound"],
    },
    extension_id: { type: String, default: null, trim: true },
    extension_number: { type: String, default: null, trim: true },
    phone_number_raw: { type: String, default: null, trim: true },
    e164: { type: String, default: null, trim: true },
    name_raw: { type: String, default: null, trim: true },
    connected: { type: Boolean, required: true, default: false },
    answered_at: { type: Date, default: null },
    terminal_at: { type: Date, default: null },
    terminal_status: { type: String, default: null, trim: true }, // provider status code as observed
  },
  { _id: false },
);

const legSchema = new Schema(
  {
    call_log_id: { type: String, default: null, trim: true },
    leg_type: { type: String, default: null, trim: true }, // RC legType
    direction: { type: String, default: null, trim: true },
    result: { type: String, default: null, trim: true }, // RC result
    start_time: { type: Date, default: null },
    duration_seconds: { type: Number, default: null },
    extension_id: { type: String, default: null, trim: true },
    transfer_target_session_id: { type: String, default: null, trim: true },
    recording_id: { type: String, default: null, trim: true },
  },
  { _id: false },
);

export const CallInteractionSchema = new Schema(
  {
    purged_at: { type: Date, default: null },
    merged_into_id: { type: Schema.Types.ObjectId, default: null },
    provider: {
      type: String,
      required: true,
      enum: ["ringcentral"],
      default: "ringcentral",
    },
    provider_account_id: { type: String, required: true, trim: true },
    telephony_session_id: { type: String, default: null, trim: true },
    session_id: { type: String, default: null, trim: true },
    call_log_ids: { type: [String], default: [] }, // record + leg ids observed
    identity_basis: {
      type: String,
      required: true,
      enum: ["telephony_session_id", "session_id", "call_log_id"],
    },

    direction: {
      type: String,
      required: true,
      enum: ["Inbound", "Outbound", "Internal", "Unknown"],
    },
    contact_number_id: {
      type: Schema.Types.ObjectId,
      ref: "ContactNumber",
      default: null,
    }, // external endpoint, null when internal
    external_e164: { type: String, default: null, trim: true },
    // CSI-02 additive: honest classification of the counterparty endpoint even
    // when no Contact Number exists (withheld/malformed/service code/company).
    external_endpoint_kind: {
      type: String,
      default: null,
      enum: [null, ...CONTACT_NUMBER_KINDS],
    },
    company_e164: { type: String, default: null, trim: true }, // the Vantage number/DID on our side
    inbound_route_id: {
      type: Schema.Types.ObjectId,
      ref: "RingCentralInboundRoute",
      default: null,
    }, // read-only join, when mapped

    started_at: { type: Date, required: true },
    answered_at: { type: Date, default: null },
    ended_at: { type: Date, default: null },
    duration_seconds: { type: Number, default: null }, // record-level provider duration
    provider_result: { type: String, default: null, trim: true }, // "Call connected", "Voicemail", "Missed", ...
    provider_connected: { type: Boolean, required: true, default: false },
    contact_type: {
      type: String,
      required: true,
      enum: ["unknown", "voicemail", "human_conversation"],
      default: "unknown",
    },
    contact_type_basis: { type: String, default: null, trim: true }, // "provider:voicemail", "transcript:<version>", "owner"; duration alone proves neither voicemail nor human

    parties: { type: [partySchema], default: [] },
    legs: { type: [legSchema], default: [] }, // bounded 40; overflow_count below
    legs_overflow_count: { type: Number, required: true, default: 0 },
    connected_user_extension_ids: { type: [String], default: [] },
    queue_fanout: { type: Boolean, required: true, default: false },
    transfer: { type: Boolean, required: true, default: false },
    monitoring: { type: Boolean, required: true, default: false },

    recordings: {
      type: [
        new Schema(
          {
            provider_recording_id: { type: String, required: true, trim: true },
            recording_type: { type: String, default: null, trim: true },
            observed_at: { type: Date, required: true },
            lead_conversation_id: {
              type: Schema.Types.ObjectId,
              ref: "LeadConversation",
              default: null,
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // provenance
    recording_discovery: {
      type: new Schema({ state: { type: String, enum: ["pending", "discovered", "no_recording"] }, reason: String, checked_at: Date, next_attempt_at: Date }, { _id: false }),
      default: null,
    },
    sources: { type: [String], default: [] }, // ["webhook","call_log_reconcile","backfill"]
    provider_last_modified_at: { type: Date, default: null },
    // CC-04: null = never seen in the Call Log; "provisional" = the latest Call Log
    // record looks like a mid-call snapshot (terminal stays false, no downstream work);
    // "settled" = final by shape or by the settle horizon. Never settled → provisional.
    call_log_state: {
      type: String,
      default: null,
      enum: [null, "provisional", "settled"],
    },
    terminal: { type: Boolean, required: true, default: false },
    projection_revision: { type: Number, required: true, default: 1 },
    max_observed_webhook_sequence: { type: Number, default: null }, // diagnostic only, never filters other parties
    first_observed_at: { type: Date, required: true },
    last_observed_at: { type: Date, required: true },
  },
  {
    collection: "call_interactions",
    autoIndex: false,
    timestamps: true,
    minimize: false,
  },
);

export const getCallInteractionModel = defineCsiModel(
  "CallInteraction",
  CallInteractionSchema,
  CALL_INTERACTION_INDEXES,
);
