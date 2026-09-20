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
// src/models/ContactNumber.ts

export const CONTACT_NUMBER_INDEXES = [
  {
    name: "contact_number_e164_unique",
    key: { e164: 1 },
    unique: true as const,
  },
  { name: "contact_number_digits_reversed", key: { digits_reversed: 1 } }, // suffix search (last 4/7)
  { name: "contact_number_search_terms", key: { search_terms: 1 } }, // names, job numbers
  {
    name: "contact_number_last_activity",
    key: { last_activity_at: -1, _id: -1 },
  },
  {
    name: "contact_number_classification_activity",
    key: { classification: 1, last_activity_at: -1 },
  },
  {
    name: "contact_number_eligibility",
    key: { "contact_eligibility.state": 1 },
  },
] as const;

const contactEligibilitySchema = new Schema(
  {
    state: {
      type: String,
      required: true,
      enum: CONTACT_ELIGIBILITY_STATES,
      default: "allowed",
    },
    reason: { type: String, default: null, trim: true },
    until: { type: Date, default: null }, // temporarily_blocked only
    evidence_ref: { type: String, default: null, trim: true }, // finding id or owner action id
    set_by: { type: String, default: null, trim: true }, // "system" | actor label
    set_at: { type: Date, default: null },
  },
  { _id: false },
);

const rollupsSchema = new Schema(
  {
    interactions_total: { type: Number, required: true, default: 0 },
    inbound_total: { type: Number, required: true, default: 0 },
    outbound_total: { type: Number, required: true, default: 0 },
    human_conversations_total: { type: Number, required: true, default: 0 },
    last_inbound_at: { type: Date, default: null },
    last_outbound_at: { type: Date, default: null },
    last_human_conversation_at: { type: Date, default: null },
    last_meaningful_contact_at: { type: Date, default: null },
    attached_lead_count: { type: Number, required: true, default: 0 },
    candidate_lead_count: { type: Number, required: true, default: 0 },
    open_outreach_count: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

export const ContactNumberSchema = new Schema(
  {
    content_purge_pending: { type: Boolean, default: false },
    retention_epoch: { type: Number, default: 0 },
    evidence_fence: { type: Number, default: 0 },
    purged_at: { type: Date, default: null },
    revision: { type: Number, required: true, default: 1 },
    e164: { type: String, required: true, trim: true }, // "+17573180143"
    national_ten: { type: String, default: null, trim: true }, // "7573180143" (NANP only)
    digits_reversed: { type: String, required: true, trim: true }, // "3410813757" for suffix search
    country: { type: String, required: true, trim: true, default: "US" },
    kind: {
      type: String,
      required: true,
      enum: CONTACT_NUMBER_KINDS,
      default: "external",
    },
    classification: {
      type: String,
      required: true,
      enum: CONTACT_NUMBER_CLASSIFICATIONS,
      default: "unknown",
    },
    classification_reason: { type: String, default: null, trim: true },
    classification_set_by: { type: String, default: null, trim: true },
    classification_set_at: { type: Date, default: null },
    contact_eligibility: {
      type: contactEligibilitySchema,
      required: true,
      default: () => ({ state: "allowed" }),
    },
    provider_names: { type: [String], default: [] }, // caller-ID names observed, deduped, bounded 10
    search_terms: { type: [String], default: [] }, // lowercased: lead names, job numbers, provider names
    first_observed_at: { type: Date, required: true },
    last_activity_at: { type: Date, required: true },
    rollups: { type: rollupsSchema, required: true, default: () => ({}) },
    running_summary: {
      // projection from a completed number-level analysis run
      type: new Schema(
        {
          text: { type: String, required: true },
          run_id: {
            type: Schema.Types.ObjectId,
            ref: "IntelligenceRun",
            required: true,
          },
          evidence_digest: { type: String, required: true },
          computed_at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    intelligence_schedule: {
      type: new Schema({ fingerprint: { type: String, required: true }, generation: { type: Number, required: true },
        job_id: { type: Schema.Types.ObjectId, required: true } }, { _id: false, strict: "throw" }),
      default: null,
    },
  },
  {
    collection: "contact_numbers",
    autoIndex: false,
    timestamps: true,
    minimize: false,
  },
);

export const getContactNumberModel = defineCsiModel(
  "ContactNumber",
  ContactNumberSchema,
  CONTACT_NUMBER_INDEXES,
);
