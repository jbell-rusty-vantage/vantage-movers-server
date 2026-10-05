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

/**
 * G7 (reconciliation addendum §3.5): how the Number came to exist. `form_lead` is written only
 * when a Form Lead's submitted phone creates the row (`ensureFormLeadContactNumber`, its
 * backfill, and the S10 step-1 stamp). Capture never writes it: absent or null means `call`.
 */
export const CONTACT_NUMBER_CREATED_VIA = ["call", "form_lead"] as const;
export type ContactNumberCreatedVia = (typeof CONTACT_NUMBER_CREATED_VIA)[number];
/** Null path: a row without the field (every historical and every call-created row) is `call`. */
export function resolveCreatedVia(value: unknown): ContactNumberCreatedVia {
  return value === "form_lead" ? "form_lead" : "call";
}

/**
 * Every filtered listing sorts `(last_activity_at desc, _id desc)`, so each
 * selective prefix carries that order in the index and the common Owner
 * searches run as index scans with no blocking in-memory sort (14 §8).
 *
 * `contact_number_terms_activity` is multikey on `search_terms`: Mongo will
 * still not use index order to sort on a field that follows the array field,
 * so that one shape keeps a sort stage. It is here because the compound index
 * narrows the candidate set the sort has to touch; the others remove the sort.
 */
export const CONTACT_NUMBER_INDEXES = [
  {
    name: "contact_number_e164_unique",
    key: { e164: 1 },
    unique: true as const,
  },
  // Suffix search (last 4/7), carrying the listing sort.
  {
    name: "contact_number_digits_activity",
    key: { digits_reversed: 1, last_activity_at: -1, _id: -1 },
  },
  // Names, job numbers, agent names.
  {
    name: "contact_number_terms_activity",
    key: { search_terms: 1, last_activity_at: -1, _id: -1 },
  },
  {
    name: "contact_number_last_activity",
    key: { last_activity_at: -1, _id: -1 },
  },
  {
    name: "contact_number_classification_activity_id",
    key: { classification: 1, last_activity_at: -1, _id: -1 },
  },
  // `kind` is always in the search filter (`external`, or `$ne` under hygiene).
  {
    name: "contact_number_kind_activity",
    key: { kind: 1, last_activity_at: -1, _id: -1 },
  },
  // LP-06 (§14.2) time sorts. `kind` is always filtered; each index serves
  // its sort in both directions (scanned backwards for `asc`) and the
  // `field: null` segment keyed on `_id`.
  {
    name: "contact_number_kind_human_conversation",
    key: { kind: 1, "rollups.last_human_conversation_at": -1, _id: -1 },
  },
  {
    name: "contact_number_kind_first_observed",
    key: { kind: 1, first_observed_at: -1, _id: -1 },
  },
  // Data spec §4.2 / V14: Numbers `sort=interactions`, with the same
  // two-segment (value, then null) paging as the time sorts above.
  {
    name: "contact_number_kind_interactions",
    key: { kind: 1, "rollups.interactions_total": -1, _id: -1 },
  },
  {
    name: "contact_number_eligibility",
    key: { "contact_eligibility.state": 1 },
  },
  // All Numbers v2 (all-numbers CONTRACT §2, §4.1): "Waiting on us", longest wait first.
  {
    name: "contact_number_waiting",
    key: { waiting_since: 1, _id: 1 },
    partialFilterExpression: { waiting_since: { $type: "date" } },
  },
  // The numbers a Lead is linked to (lead-side recompute, desk subject `contact_number_ids`).
  { name: "contact_number_lead", key: { "lead.id": 1 } },
  { name: "contact_number_other_leads", key: { "other_leads.id": 1 } },
] as const;

/** A Lead as a Number's link copies it (CONTRACT §2). The snapshot fields refresh on every recompute. */
export const CONTACT_NUMBER_LEAD_STATES = ["open", "booked", "cancelled"] as const;
export const numberLeadSchema = new Schema(
  {
    model: { type: String, required: true, enum: ["FormLead", "CallLead"] },
    id: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, default: null },
    job_no: { type: String, default: null },
    receiver_agent_id: { type: Schema.Types.ObjectId, default: null },
    receiver_agent_name: { type: String, default: null },
    received_at: { type: Date, required: true },
    state: { type: String, required: true, enum: CONTACT_NUMBER_LEAD_STATES },
  },
  { _id: false },
);

const leadLinkSchema = new Schema(
  {
    /** `owner`: the Owner picked `lead` by hand; it holds until a newer candidate is received. */
    source: { type: String, required: true, enum: ["automatic", "owner"], default: "automatic" },
    set_at: { type: Date, default: null },
    set_by: { type: String, default: null, trim: true },
    /** Leads the Owner said are not this number (Unlink). Never linked automatically again. */
    excluded: {
      type: [new Schema({ model: { type: String, required: true, enum: ["FormLead", "CallLead"] },
        id: { type: Schema.Types.ObjectId, required: true } }, { _id: false })],
      default: [],
    },
  },
  { _id: false },
);

const lastCallSchema = new Schema(
  {
    interaction_id: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
    direction: { type: String, required: true, enum: ["inbound", "outbound"] },
    result: { type: String, required: true, enum: ["answered", "missed", "voicemail"] },
    duration_seconds: { type: Number, default: null },
    /** Our side of the call; the read resolves the Agent through the reviewed Rep Identity Link at `at`. */
    rc_extension_id: { type: String, default: null },
  },
  { _id: false },
);

const callCountsSchema = new Schema(
  {
    inbound: { type: Number, required: true, default: 0 },
    outbound: { type: Number, required: true, default: 0 },
    /** Inbound calls nobody answered, voicemail included. */
    missed: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

/** Stamped by v2 code when the summary and link fields were computed (the migration marker). */
export const CONTACT_NUMBER_SUMMARY_VERSION = 1 as const;

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
    attached_lead_count: { type: Number, required: true, default: 0 },
    candidate_lead_count: { type: Number, required: true, default: 0 },
    /** Σ `recordings.length` over canonical interactions (not merged, not purged): provider metadata only. */
    recordings_total: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

export const ContactNumberSchema = new Schema(
  {
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
    /** G7: optional, no default, so call-created and historical rows stay without it (= `call`). */
    created_via: { type: String, enum: CONTACT_NUMBER_CREATED_VIA, required: false },
    rollups: { type: rollupsSchema, required: true, default: () => ({}) },
    // ── All Numbers v2 (CONTRACT §2). Written by `numberActivity/callSummary.ts` and `leadLink.ts`. ──
    lead: { type: numberLeadSchema, default: null },
    /** Other matching Leads, newest first, at most 10. */
    other_leads: { type: [numberLeadSchema], default: [] },
    lead_link: { type: leadLinkSchema, default: null },
    last_call: { type: lastCallSchema, default: null },
    calls: { type: callCountsSchema, default: () => ({}) },
    last_inbound_at: { type: Date, default: null },
    last_outbound_at: { type: Date, default: null },
    /** Start of the earliest missed/voicemail inbound call after the latest handled call. */
    waiting_since: { type: Date, default: null },
    summary_version: { type: Number, default: null },
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
