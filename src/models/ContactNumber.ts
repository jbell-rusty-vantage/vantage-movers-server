import { Schema } from "mongoose";
import { defineCsiModel } from "./salesIntelligence/common";
// src/models/ContactNumber.ts

/**
 * G7 (reconciliation addendum §3.5): how the Number came to exist. `form_lead` / `call_lead` are
 * written only when a Lead's phone creates the row (`ensureLeadContactNumber` in the Lead's
 * `lead_link` job, `ops/numbers-v2/mint-lead-numbers.ts`, and for Form Leads the S10 step-1 stamp;
 * `call_lead` since outreach lifecycle repair C2b). Capture never writes it: absent or null means `call`.
 */
export const CONTACT_NUMBER_CREATED_VIA = ["call", "form_lead", "call_lead"] as const;
export type ContactNumberCreatedVia = (typeof CONTACT_NUMBER_CREATED_VIA)[number];
/** The served source (All Numbers CONTRACT §4 `source: "call" | "form_lead"`); the stored value can be wider. */
export type ContactNumberSource = "call" | "form_lead";
/**
 * Null path: a row without the field (every historical and every call-created row) is `call`. A Call
 * Lead's minted number is also served as `call`: a Call Lead is a phone call by origin, and the admin's
 * `source` enum must not see a new value.
 */
export function resolveCreatedVia(value: unknown): ContactNumberSource {
  return value === "form_lead" ? "form_lead" : "call";
}

/**
 * All Numbers v2 (all-numbers CONTRACT §2). The retired analysis fields (`kind`, `classification*`,
 * `contact_eligibility`, `rollups`) left the schema in phase B; `ops/numbers-v2/cleanup.ts` unsets them
 * on stored rows and drops their indexes. Until it runs, reads ignore them (a stored path the schema
 * does not declare is never written: `strict: "throw"` refuses only writes).
 *
 * The All Numbers list sorts `(last_activity_at desc, _id desc)`, so each
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

export const ContactNumberSchema = new Schema(
  {
    purged_at: { type: Date, default: null },
    revision: { type: Number, required: true, default: 1 },
    e164: { type: String, required: true, trim: true }, // "+17573180143"
    national_ten: { type: String, default: null, trim: true }, // "7573180143" (NANP only)
    digits_reversed: { type: String, required: true, trim: true }, // "3410813757" for suffix search
    country: { type: String, required: true, trim: true, default: "US" },
    provider_names: { type: [String], default: [] }, // caller-ID names observed, deduped, bounded 10
    search_terms: { type: [String], default: [] }, // lowercased: lead names, job numbers, provider names
    first_observed_at: { type: Date, required: true },
    last_activity_at: { type: Date, required: true },
    /** G7: optional, no default, so call-created and historical rows stay without it (= `call`). */
    created_via: { type: String, enum: CONTACT_NUMBER_CREATED_VIA, required: false },
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
