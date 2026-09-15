# 02 — Domain models

Status: implementation-ready. Pack index: [`README.md`](README.md). Rules: [`01-specification.md`](01-specification.md).

## 0. Conventions

- Runtime Mongoose models live in `src/models/`, `snake_case` fields, `autoIndex: false`, `timestamps: true`, `minimize: false`, and a `getXModel()` accessor that honours `getMongoDatabaseName()` (the `TEST_MODE` DB boundary), exactly like `src/models/LeadConversation.ts`.
- Index definitions are exported as `X_INDEXES` arrays and applied by `scripts/migrations/sales-intelligence-indexes.ts` (`--report | --apply --confirm-production=<db> | --verify`), mirroring `scripts/migrations/lead-conversation-indexes.ts`. Runtime never creates indexes and fails closed when a unique fence is missing.
- Enum constants live in `src/config/domain/salesIntelligence.ts` (barrel-exported via `domain.ts`).
- Raw provider payloads keep using the existing `ringcentral_webhook_events` capture (with its `_test` suffix mode). New collections below do **not** use the `_test` suffix; they rely on the DB boundary.
- Phone normalization: `normalizePhoneNumberForStorage` / `normalizePhoneNumberForMatch` from `src/utils/phone.ts` for parity with Leads; add `toE164(value, defaultCountry="US")` and `toNationalTenDigit()` in `src/services/numberActivity/phone.ts`. Store provider originals untouched.

Collections in this pack:

| Collection | Model | Purpose |
| --- | --- | --- |
| `contact_numbers` | `ContactNumber` | Endpoint identity, classification, eligibility, search terms, rollups |
| `call_interactions` | `CallInteraction` | Canonical telephony session with parties, legs, recording pointer |
| `number_lead_attachments` | `NumberLeadAttachment` | Number↔Lead evidence edges |
| `outreach_records` | `OutreachRecord` | Outreach state per Lead or Number Review, events, next action |
| `outreach_followups` | `OutreachFollowup` | Follow-up rows |
| `intelligence_findings` | `IntelligenceFinding` | Versioned, cited extractions per Lead Conversation |
| `rep_identity_links` | `RepIdentityLink` | Agent ↔ RingCentral User extension |
| `ringcentral_directory_snapshots` | `RingCentralDirectorySnapshot` | Extensions / company numbers / queues, versioned |
| `owner_rep_nudges` | `OwnerRepNudge` | Nudge command audit + provider result |
| `sales_intelligence_sync_state` | `SalesIntelligenceSyncState` | Per-stream cursor + lease (all-direction reconcile, directory, media) |
| `sales_intelligence_sync_windows` | `SalesIntelligenceSyncWindow` | Backfill window manifests |
| `sales_intelligence_ai_budget` | `SalesIntelligenceAiBudget` | Monthly reserve/actual ledger |
| `lead_conversations` (extended) | `LeadConversation` | Adds interaction ref, contact type, `unavailable`, intelligence block |

## 1. `ContactNumber` — `contact_numbers`

```ts
// src/models/ContactNumber.ts
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import {
  CONTACT_NUMBER_CLASSIFICATIONS,   // ["unknown","customer","company","non_customer"]
  CONTACT_ELIGIBILITY_STATES,        // ["allowed","temporarily_blocked","suppressed","unknown"]
  CONTACT_NUMBER_KINDS,              // ["external","company_did","extension","service_code","withheld","malformed"]
} from "../config/domain/salesIntelligence";

export const CONTACT_NUMBER_INDEXES = [
  { name: "contact_number_e164_unique", key: { e164: 1 }, unique: true as const },
  { name: "contact_number_digits_reversed", key: { digits_reversed: 1 } },        // suffix search (last 4/7)
  { name: "contact_number_search_terms", key: { search_terms: 1 } },              // names, job numbers
  { name: "contact_number_last_activity", key: { last_activity_at: -1, _id: -1 } },
  { name: "contact_number_classification_activity", key: { classification: 1, last_activity_at: -1 } },
  { name: "contact_number_eligibility", key: { "contact_eligibility.state": 1 } },
] as const;

const contactEligibilitySchema = new Schema(
  {
    state: { type: String, required: true, enum: CONTACT_ELIGIBILITY_STATES, default: "allowed" },
    reason: { type: String, default: null, trim: true },
    until: { type: Date, default: null },                 // temporarily_blocked only
    evidence_ref: { type: String, default: null, trim: true }, // finding id or owner action id
    set_by: { type: String, default: null, trim: true },  // "system" | actor label
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

const ContactNumberSchema = new Schema(
  {
    e164: { type: String, required: true, trim: true },              // "+17573180143"
    national_ten: { type: String, default: null, trim: true },       // "7573180143" (NANP only)
    digits_reversed: { type: String, required: true, trim: true },   // "3410813757" for suffix search
    country: { type: String, required: true, trim: true, default: "US" },
    kind: { type: String, required: true, enum: CONTACT_NUMBER_KINDS, default: "external" },
    classification: { type: String, required: true, enum: CONTACT_NUMBER_CLASSIFICATIONS, default: "unknown" },
    classification_reason: { type: String, default: null, trim: true },
    classification_set_by: { type: String, default: null, trim: true },
    classification_set_at: { type: Date, default: null },
    contact_eligibility: { type: contactEligibilitySchema, required: true, default: () => ({ state: "allowed" }) },
    provider_names: { type: [String], default: [] },        // caller-ID names observed, deduped, bounded 10
    search_terms: { type: [String], default: [] },          // lowercased: lead names, job numbers, provider names
    first_observed_at: { type: Date, required: true },
    last_activity_at: { type: Date, required: true },
    rollups: { type: rollupsSchema, required: true, default: () => ({}) },
    running_summary: {                                       // Finding-derived, versioned (see IntelligenceFinding kind "number_summary")
      type: new Schema({
        text: { type: String, required: true },
        finding_id: { type: Schema.Types.ObjectId, required: true },
        evidence_digest: { type: String, required: true },
        computed_at: { type: Date, required: true },
      }, { _id: false }),
      default: null,
    },
  },
  { collection: "contact_numbers", autoIndex: false, timestamps: true, minimize: false },
);
```

Rules:

- `e164` is the identity. `national_ten` is only for RingCentral `phoneNumber=` query parity (the API wants 10 digits).
- `kind` other than `external` is set from the directory snapshot (company DID, extension) or the normalizer (withheld, malformed, service code). Non-`external` numbers are hidden from Attention and Numbers by default, visible in Coverage → Hygiene.
- `search_terms` is rebuilt by `numberActivity/searchTerms.ts` whenever an attachment changes or a provider name is observed. Never store transcript text here.
- `rollups` are maintained by `numberActivity/rollups.ts` inside the same transaction as the interaction upsert and are re-derivable by `POST /rebuild`.

## 2. `CallInteraction` — `call_interactions`

```ts
// src/models/CallInteraction.ts
export const CALL_INTERACTION_INDEXES = [
  { name: "call_interaction_session_unique", key: { provider: 1, telephony_session_id: 1 }, unique: true as const,
    partialFilterExpression: { telephony_session_id: { $type: "string" } } },
  { name: "call_interaction_session_id", key: { provider: 1, session_id: 1 }, sparse: true },
  { name: "call_interaction_call_log_ids", key: { provider: 1, call_log_ids: 1 } },
  { name: "call_interaction_number_started", key: { contact_number_id: 1, started_at: -1 } },
  { name: "call_interaction_started_window", key: { started_at: -1, _id: -1 } },
  { name: "call_interaction_extension_started", key: { "parties.extension_id": 1, started_at: -1 } },
  { name: "call_interaction_recording", key: { "recording.provider_recording_id": 1 }, sparse: true },
  { name: "call_interaction_provider_modified", key: { provider_last_modified_at: -1 } },
  { name: "call_interaction_updated", key: { updatedAt: -1, _id: -1 } },   // SSE watermark
] as const;

const partySchema = new Schema(
  {
    party_id: { type: String, default: null, trim: true },
    role: { type: String, required: true, enum: ["external", "user", "queue", "ivr", "voicemail", "monitoring", "unknown"] },
    direction: { type: String, default: null, enum: [null, "Inbound", "Outbound"] },
    extension_id: { type: String, default: null, trim: true },
    extension_number: { type: String, default: null, trim: true },
    phone_number_raw: { type: String, default: null, trim: true },
    e164: { type: String, default: null, trim: true },
    name_raw: { type: String, default: null, trim: true },
    connected: { type: Boolean, required: true, default: false },
    answered_at: { type: Date, default: null },
    terminal_at: { type: Date, default: null },
    terminal_status: { type: String, default: null, trim: true },   // provider status code as observed
  },
  { _id: false },
);

const legSchema = new Schema(
  {
    call_log_id: { type: String, default: null, trim: true },
    leg_type: { type: String, default: null, trim: true },       // RC legType
    direction: { type: String, default: null, trim: true },
    result: { type: String, default: null, trim: true },           // RC result
    start_time: { type: Date, default: null },
    duration_seconds: { type: Number, default: null },
    extension_id: { type: String, default: null, trim: true },
    transfer_target_session_id: { type: String, default: null, trim: true },
    recording_id: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const CallInteractionSchema = new Schema(
  {
    provider: { type: String, required: true, enum: ["ringcentral"], default: "ringcentral" },
    provider_account_id: { type: String, default: null, trim: true },
    telephony_session_id: { type: String, default: null, trim: true },
    session_id: { type: String, default: null, trim: true },
    call_log_ids: { type: [String], default: [] },                 // record + leg ids observed
    identity_basis: { type: String, required: true, enum: ["telephony_session_id", "session_id", "call_log_id"] },

    direction: { type: String, required: true, enum: ["Inbound", "Outbound", "Internal", "Unknown"] },
    contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", default: null },   // external endpoint, null when internal
    external_e164: { type: String, default: null, trim: true },
    company_e164: { type: String, default: null, trim: true },      // the Vantage number/DID on our side
    inbound_route_id: { type: Schema.Types.ObjectId, ref: "RingCentralInboundRoute", default: null }, // read-only join, when mapped

    started_at: { type: Date, required: true },
    answered_at: { type: Date, default: null },
    ended_at: { type: Date, default: null },
    duration_seconds: { type: Number, default: null },              // record-level provider duration
    provider_result: { type: String, default: null, trim: true },   // "Call connected", "Voicemail", "Missed", ...
    provider_connected: { type: Boolean, required: true, default: false },
    contact_type: { type: String, required: true, enum: ["unknown", "voicemail", "human_conversation"], default: "unknown" },
    contact_type_basis: { type: String, default: null, trim: true }, // "rule:duration_lt_20s", "transcript:v1", "owner"

    parties: { type: [partySchema], default: [] },
    legs: { type: [legSchema], default: [] },                       // bounded 40; overflow_count below
    legs_overflow_count: { type: Number, required: true, default: 0 },
    connected_user_extension_ids: { type: [String], default: [] },
    queue_fanout: { type: Boolean, required: true, default: false },
    transfer: { type: Boolean, required: true, default: false },
    monitoring: { type: Boolean, required: true, default: false },

    recording: {
      type: new Schema({
        provider_recording_id: { type: String, required: true, trim: true },
        recording_type: { type: String, default: null, trim: true },
        observed_at: { type: Date, required: true },
        lead_conversation_id: { type: Schema.Types.ObjectId, ref: "LeadConversation", default: null },
      }, { _id: false }),
      default: null,
    },

    // provenance
    sources: { type: [String], default: [] },                       // ["webhook","call_log_reconcile","backfill"]
    provider_last_modified_at: { type: Date, default: null },
    terminal: { type: Boolean, required: true, default: false },
    projection_revision: { type: Number, required: true, default: 1 },
    last_webhook_sequence: { type: Number, default: null },
    first_observed_at: { type: Date, required: true },
    last_observed_at: { type: Date, required: true },
  },
  { collection: "call_interactions", autoIndex: false, timestamps: true, minimize: false },
);
```

Rules:

- Identity: `telephony_session_id` first; `session_id` if that is absent; a Call Log record id only when neither exists. `identity_basis` records which. Never merge two rows by phone + time.
- `projection_revision` increments on every projection change; a webhook event with `sequence` ≤ `last_webhook_sequence` for the same party is ignored. A Call Log reconcile that carries `lastModifiedTime` ≤ `provider_last_modified_at` and no new legs is a no-op.
- `terminal` flips true once and never back. Late events may add legs, a recording, or `ended_at`, never un-terminate.
- `contact_type` may only be set to `human_conversation` by transcript evidence or Owner; rules may set `voicemail`.

## 3. `NumberLeadAttachment` — `number_lead_attachments`

```ts
export const NUMBER_LEAD_ATTACHMENT_INDEXES = [
  { name: "nla_pair_unique", key: { contact_number_id: 1, "lead_ref.model": 1, "lead_ref.id": 1 }, unique: true as const },
  { name: "nla_lead_state", key: { "lead_ref.model": 1, "lead_ref.id": 1, state: 1 } },
  { name: "nla_number_state", key: { contact_number_id: 1, state: 1 } },
  { name: "nla_state_updated", key: { state: 1, updatedAt: -1 } },
] as const;

const attachmentEvidenceSchema = new Schema(
  {
    source: { type: String, required: true, enum: [
      "call_lead_ringcentral_identity",   // exact
      "ringcentral_call_adoption",        // exact
      "owner_attach",                     // exact
      "lead_phone_live",
      "ingested_contact_snapshot",
      "granot_contact_snapshot",
      "ringcentral_original_caller",
      "assignment_context",               // reserved
    ] },
    field_path: { type: String, required: true, trim: true },       // e.g. "form_leads.normalized_phone_number"
    observed_at: { type: Date, required: true },                     // when the evidence was true
    window_from: { type: Date, default: null },
    window_to: { type: Date, default: null },
    candidate_count_at_suggest: { type: Number, default: null },
  },
  { _id: false },
);

const NumberLeadAttachmentSchema = new Schema(
  {
    contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", required: true },
    lead_ref: { type: new Schema({ model: { type: String, required: true, enum: ["FormLead", "CallLead"] }, id: { type: Schema.Types.ObjectId, required: true } }, { _id: false }), required: true },
    state: { type: String, required: true, enum: ["candidate", "ambiguous", "attached", "rejected"] },
    certainty: { type: String, required: true, enum: ["exact", "likely", "unsure", "owner_confirmed", "rejected"] },
    evidence: { type: [attachmentEvidenceSchema], default: [] },
    lead_snapshot: {                                                  // display only, refreshed on read when stale
      type: new Schema({
        name: { type: String, default: null }, job_no: { type: String, default: null },
        source_label: { type: String, default: null }, lead_timestamp: { type: Date, default: null },
        booked: { type: Boolean, default: false }, cancelled: { type: Boolean, default: false },
        duplicate: { type: Boolean, default: false }, bad_lead: { type: Boolean, default: false },
        receiver_agent_name: { type: String, default: null },
        refreshed_at: { type: Date, default: null },
      }, { _id: false }),
      default: null,
    },
    decided_by: { type: String, default: null, trim: true },          // actor label for owner decisions
    decided_at: { type: Date, default: null },
    decision_reason: { type: String, default: null, trim: true },
    history: { type: [new Schema({ from: String, to: String, at: Date, by: String, reason: String }, { _id: false })], default: [] },
  },
  { collection: "number_lead_attachments", autoIndex: false, timestamps: true, minimize: false },
);
```

## 4. `OutreachRecord` — `outreach_records`

```ts
export const OUTREACH_RECORD_INDEXES = [
  { name: "outreach_subject_unique", key: { "subject.kind": 1, "subject.model": 1, "subject.id": 1, "subject.contact_number_id": 1 }, unique: true as const },
  { name: "outreach_state_due", key: { state: 1, first_action_due_at: 1 } },
  { name: "outreach_state_next_due", key: { state: 1, "next_action.due_at": 1 } },
  { name: "outreach_agent_state", key: { responsible_agent_id: 1, state: 1 } },
  { name: "outreach_primary_number", key: { primary_contact_number_id: 1 } },
  { name: "outreach_updated", key: { updatedAt: -1, _id: -1 } },    // SSE watermark
  { name: "outreach_trigger", key: { trigger_at: -1 } },
] as const;

const outreachSubjectSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["lead", "number_review"] },
    model: { type: String, default: null, enum: [null, "FormLead", "CallLead"] },
    id: { type: Schema.Types.ObjectId, default: null },
    contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", default: null },
  },
  { _id: false },
);

const nextActionSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["call", "text_customer_via_lead_message", "review", "wait", "reconcile_identity"] },
    due_at: { type: Date, required: true },
    note: { type: String, default: null, trim: true },
    followup_id: { type: Schema.Types.ObjectId, ref: "OutreachFollowup", default: null },
    set_by: { type: String, required: true, trim: true },
    set_at: { type: Date, required: true },
  },
  { _id: false },
);

const outreachEventSchema = new Schema(
  {
    at: { type: Date, required: true },
    kind: { type: String, required: true, enum: [
      "created", "state_changed", "attributable_outbound", "inbound_observed", "voicemail_left",
      "human_conversation", "finding_accepted", "finding_dismissed", "next_action_set", "followup_completed",
      "owner_note", "nudge_sent", "attachment_changed", "closed", "reopened",
    ] },
    from_state: { type: String, default: null },
    to_state: { type: String, default: null },
    actor: { type: String, required: true, trim: true },              // "system" | actor label
    interaction_id: { type: Schema.Types.ObjectId, ref: "CallInteraction", default: null },
    finding_id: { type: Schema.Types.ObjectId, ref: "IntelligenceFinding", default: null },
    nudge_id: { type: Schema.Types.ObjectId, ref: "OwnerRepNudge", default: null },
    note: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const OutreachRecordSchema = new Schema(
  {
    subject: { type: outreachSubjectSchema, required: true },
    primary_contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", default: null },
    state: { type: String, required: true, enum: ["unworked", "open", "waiting_on_customer", "identity_review", "closed"] },
    state_before_identity_review: { type: String, default: null },
    trigger_kind: { type: String, required: true, enum: ["lead_arrival", "unanswered_inbound", "owner_open", "reopen"] },
    trigger_at: { type: Date, required: true },
    first_action_due_at: { type: Date, default: null },
    first_attributable_outbound_at: { type: Date, default: null },
    next_action: { type: nextActionSchema, default: null },
    wait_until: { type: Date, default: null },
    wait_reason: { type: String, default: null, trim: true },
    closed_reason: { type: String, default: null, enum: [null, "booked", "cancelled", "lost", "duplicate", "bad_lead", "suppressed", "not_sales", "no_sync", "owner_dismissed"] },
    closed_at: { type: Date, default: null },
    responsible_agent_id: { type: Schema.Types.ObjectId, ref: "Agent", default: null },   // explicit Owner assignment only; never copied from receiver_agent
    responsible_set_by: { type: String, default: null },
    sales_assignment_id: { type: Schema.Types.ObjectId, default: null },                  // reserved, later phase
    blocking_attachment_ids: { type: [Schema.Types.ObjectId], default: [] },
    outbound_attempts_24h: { type: Number, required: true, default: 0 },                  // maintained for cooldown
    last_meaningful_contact_at: { type: Date, default: null },
    events: { type: [outreachEventSchema], default: [] },                                  // bounded 200; older moved to outreach_followups? no: archived to events_archive_count
    events_archived_count: { type: Number, required: true, default: 0 },
    policy_version: { type: String, required: true, trim: true },
    revision: { type: Number, required: true, default: 1 },
  },
  { collection: "outreach_records", autoIndex: false, timestamps: true, minimize: false, optimisticConcurrency: true },
);
```

Rules:

- Owner commands carry `expected_revision`; mismatch returns 409 with the refreshed record.
- `responsible_agent_id` is set only by an Owner command. The subject Lead's `receiver_agent` is displayed as "Received by" but never copied here (provenance is not ownership).
- Derived signals are **not** stored. `outreach/derive.ts` computes them on read with `policy_version` so a policy change re-derives instantly.

## 5. `OutreachFollowup` — `outreach_followups`

```ts
export const OUTREACH_FOLLOWUP_INDEXES = [
  { name: "followup_record_status_due", key: { outreach_record_id: 1, status: 1, due_at: 1 } },
  { name: "followup_agent_status_due", key: { responsible_agent_id: 1, status: 1, due_at: 1 } },
  { name: "followup_status_due", key: { status: 1, due_at: 1 } },
] as const;

const OutreachFollowupSchema = new Schema(
  {
    outreach_record_id: { type: Schema.Types.ObjectId, ref: "OutreachRecord", required: true },
    kind: { type: String, required: true, enum: ["call", "text_customer_via_lead_message", "review", "wait", "reconcile_identity"] },
    due_at: { type: Date, required: true },
    responsible_agent_id: { type: Schema.Types.ObjectId, ref: "Agent", default: null },
    status: { type: String, required: true, enum: ["due", "completed", "snoozed", "cancelled"], default: "due" },
    disposition: { type: String, default: null, enum: [null, "spoke", "voicemail", "no_answer", "wrong_number", "customer_declined", "booked_elsewhere", "other"] },
    note: { type: String, default: null, trim: true },
    evidence_interaction_id: { type: Schema.Types.ObjectId, ref: "CallInteraction", default: null },
    origin: { type: String, required: true, enum: ["owner", "accepted_finding", "system_default"] },
    origin_finding_id: { type: Schema.Types.ObjectId, ref: "IntelligenceFinding", default: null },
    created_by: { type: String, required: true, trim: true },
    completed_by: { type: String, default: null, trim: true },
    completed_at: { type: Date, default: null },
    snoozed_until: { type: Date, default: null },
  },
  { collection: "outreach_followups", autoIndex: false, timestamps: true, minimize: false },
);
```

## 6. `LeadConversation` — extend `lead_conversations`

Additive fields only. Existing indexes, uniqueness (`provider` + `provider_recording_id`), redaction, and Owner-only reads stay.

```ts
// additions to LeadConversationSchema
call_interaction_id: { type: Schema.Types.ObjectId, ref: "CallInteraction", default: null },
contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", default: null },
contact_type: { type: String, required: true, enum: ["unknown", "voicemail", "human_conversation"], default: "unknown" },
contact_type_basis: { type: String, default: null, trim: true },
sales_relevance: {
  type: new Schema({
    score_band: { type: String, required: true, enum: ["high", "medium", "low", "sample"] },
    reasons: { type: [String], default: [] },          // closed set: "form_linked","outbound_connected","duration_ge_90s","promised_callback_pending","unbiased_sample"
    decided_at: { type: Date, required: true },
    policy_version: { type: String, required: true },
  }, { _id: false }),
  default: null,
},
media_digest_sha256: { type: String, default: null, trim: true },
transcript_segments: {                                   // sentence-level, redacted; sentence ids are the citation namespace
  type: [new Schema({
    sid: { type: Number, required: true },               // 1-based sentence id
    start_ms: { type: Number, default: null },
    end_ms: { type: Number, default: null },
    speaker: { type: String, default: null, enum: [null, "rep", "customer", "unknown"] },
    speaker_confidence: { type: Number, default: null },
    text: { type: String, required: true },              // redacted
  }, { _id: false })],
  default: [],
},
intelligence: {
  type: new Schema({
    extraction_version: { type: String, default: null },
    extraction_model: { type: String, default: null },
    evidence_digest: { type: String, default: null },    // sha256 of the redacted transcript segments
    findings_count: { type: Number, required: true, default: 0 },
    last_extracted_at: { type: Date, default: null },
    unavailable_reason: { type: String, default: null, enum: [null, "permission_denied", "throttled", "budget_exhausted", "media_too_large", "media_404"] },
    unavailable_until: { type: Date, default: null },
  }, { _id: false }),
  default: null,
},
```

State enum gains `"unavailable"` in `src/config/domain/conversations.ts` (`LEAD_CONVERSATION_STATES`). `match_method` enum gains `"call_interaction_number_candidate"` (form-lead window match now flows through attachment edges) and `LEAD_CONVERSATION_MATCH_CONFIDENCES` gains `"low"` for number-only conversations with `lead_ref: null`.

The existing `summary` block stays for the sectioned Owner summary; findings are the structured layer beneath it.

## 7. `IntelligenceFinding` — `intelligence_findings`

```ts
export const INTELLIGENCE_FINDING_INDEXES = [
  { name: "finding_conversation_version_unique", key: { lead_conversation_id: 1, extraction_version: 1, evidence_digest: 1, kind: 1, ordinal: 1 }, unique: true as const },
  { name: "finding_conversation_review", key: { lead_conversation_id: 1, review_state: 1 } },
  { name: "finding_number_kind", key: { contact_number_id: 1, kind: 1, review_state: 1 } },
  { name: "finding_outreach_pending", key: { outreach_record_id: 1, review_state: 1 } },
  { name: "finding_kind_due", key: { kind: 1, "resolved.due_at": 1 }, sparse: true },
] as const;

const citationSchema = new Schema(
  { sid: { type: Number, required: true }, text: { type: String, required: true } },   // text copied from the redacted segment at extraction time
  { _id: false },
);

const IntelligenceFindingSchema = new Schema(
  {
    lead_conversation_id: { type: Schema.Types.ObjectId, ref: "LeadConversation", required: true },
    call_interaction_id: { type: Schema.Types.ObjectId, ref: "CallInteraction", default: null },
    contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", default: null },
    outreach_record_id: { type: Schema.Types.ObjectId, ref: "OutreachRecord", default: null },
    extraction_version: { type: String, required: true, trim: true },   // prompt+schema version, e.g. "csi-extract-v1"
    extraction_model: { type: String, required: true, trim: true },
    evidence_digest: { type: String, required: true, trim: true },
    ordinal: { type: Number, required: true },
    kind: { type: String, required: true, enum: [
      "contact_type",            // voicemail | human_conversation
      "intent",                  // moving_inquiry | service_request | not_sales | unknown
      "move_fact",               // stated move facts (from/to/date/size)
      "objection",
      "quoted_amount",
      "promised_callback",       // rep promised to call
      "customer_will_call",      // customer said they will call
      "next_step",
      "booking_claim",           // "booked" said on the call — never a Booking
      "contact_restriction",     // do not call / wrong number / opt-out
      "competitor_mention",
      "number_summary",          // running cross-call summary (recomputed from evidence set)
      "coaching_note",
    ] },
    claim: { type: String, required: true, trim: true },                 // one atomic sentence
    actor: { type: String, default: null, enum: [null, "rep", "customer", "unknown"] },
    action_status: { type: String, default: null, enum: [null, "requested", "promised", "completed", "conditional"] },
    resolved: {                                                            // typed payload by kind; validated by Zod per kind
      type: new Schema({
        due_at: { type: Date, default: null },                             // promised_callback / customer_will_call, after date resolution
        due_at_unresolved_text: { type: String, default: null },
        amount_cents: { type: Number, default: null },
        amount_meaning: { type: String, default: null },                   // "quote_total","deposit","competitor_quote"
        value: { type: Schema.Types.Mixed, default: null },
      }, { _id: false }),
      default: null,
    },
    citations: { type: [citationSchema], default: [] },                   // ≥ 1 required except number_summary
    model_confidence: { type: Number, default: null },                     // informational only; not calibration
    validation: {
      type: new Schema({
        schema_ok: { type: Boolean, required: true },
        citations_exist: { type: Boolean, required: true },
        entailment_check: { type: String, required: true, enum: ["not_run", "pass", "fail", "unsure"] },
      }, { _id: false }),
      required: true,
    },
    review_state: { type: String, required: true, enum: ["pending", "accepted", "dismissed", "superseded"], default: "pending" },
    reviewed_by: { type: String, default: null, trim: true },
    reviewed_at: { type: Date, default: null },
    review_note: { type: String, default: null, trim: true },
    superseded_by: { type: Schema.Types.ObjectId, ref: "IntelligenceFinding", default: null },
    applied_effect: { type: String, default: null, enum: [null, "followup_created", "waiting_set", "eligibility_set", "number_classified", "none"] },
    applied_ref: { type: String, default: null },
  },
  { collection: "intelligence_findings", autoIndex: false, timestamps: true, minimize: false },
);
```

Rules:

- A finding with `validation.citations_exist = false` is persisted with `review_state: "dismissed"` and `review_note: "citation_missing"`; it is never shown as pending.
- Accepting a finding is an Owner command (`POST .../findings/:id/accept`) that applies exactly one bounded effect from `applied_effect`, in a transaction with the Outreach Record revision check.
- `number_summary` is recomputed from the evidence set (all `accepted` + `pending` findings on the number) and supersedes the previous summary. Never summarize summaries.

## 8. `RepIdentityLink` — `rep_identity_links`

```ts
export const REP_IDENTITY_LINK_INDEXES = [
  { name: "ril_extension_current_unique", key: { rc_extension_id: 1 }, unique: true as const,
    partialFilterExpression: { effective_to: null } },
  { name: "ril_agent_current", key: { agent_id: 1, effective_to: 1 } },
  { name: "ril_status", key: { status: 1 } },
] as const;

const RepIdentityLinkSchema = new Schema(
  {
    agent_id: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    agent_name_snapshot: { type: String, required: true, trim: true },
    rc_account_id: { type: String, required: true, trim: true },
    rc_extension_id: { type: String, required: true, trim: true },
    rc_extension_number: { type: String, default: null, trim: true },
    rc_extension_name_snapshot: { type: String, default: null, trim: true },
    rc_direct_numbers: { type: [String], default: [] },                 // e164 DIDs observed on the extension
    rc_sms_sender_number: { type: String, default: null, trim: true },  // the DID with SmsSender, if any
    rc_team_messaging_person_id: { type: String, default: null, trim: true },
    rc_direct_chat_id: { type: String, default: null, trim: true },     // cached; re-resolved on send
    extension_user_id: { type: Schema.Types.ObjectId, ref: "ExtensionUser", default: null },
    granot_username: { type: String, default: null, trim: true, uppercase: true },
    role_kind: { type: String, required: true, enum: ["sales_rep", "service", "manager", "dialer", "shared", "excluded"] },
    status: { type: String, required: true, enum: ["proposed", "reviewed", "retired"], default: "proposed" },
    proposal_basis: { type: String, default: null, trim: true },        // "exact_full_name","first_token","owner"
    nudge_channels_allowed: { type: [String], default: ["team_messaging"] },  // subset of ["team_messaging","sms_to_rep","pager"]
    effective_from: { type: Date, required: true },
    effective_to: { type: Date, default: null },
    reviewed_by: { type: String, default: null, trim: true },
    reviewed_at: { type: Date, default: null },
    history: { type: [new Schema({ at: Date, by: String, change: String }, { _id: false })], default: [] },
  },
  { collection: "rep_identity_links", autoIndex: false, timestamps: true, minimize: false },
);
```

Rules: an Agent may hold several current links (multiple extensions). One extension has at most one current link. `proposed` links never satisfy nudge or metric preconditions. `role_kind !== "sales_rep"` links are visible in Reps but excluded from Attention "Message rep" pickers.

## 9. `RingCentralDirectorySnapshot` — `ringcentral_directory_snapshots`

One document per successful directory sync (daily cron + on-demand). Bounded to the last 30.

```ts
{
  taken_at: Date,
  extensions: [{ id, extension_number, type /* User|Department|... */, name, status, direct_numbers: [e164], sms_sender_numbers: [e164] }],
  company_numbers: [{ id, e164, usage_type, extension_id }],
  queues: [{ id, extension_number, name, member_extension_ids: [] }],
  counts: { extensions, users, departments, company_numbers, queues },
  digest: String,          // sha256 of the normalized payload; identical digest → no new doc
}
```

Index: `{ taken_at: -1 }`, unique `{ digest: 1 }`. Consumers: `kind` classification of Contact Numbers, party role resolution, Rep Identity Link proposals, Coverage hygiene.

## 10. `OwnerRepNudge` — `owner_rep_nudges`

```ts
export const OWNER_REP_NUDGE_INDEXES = [
  { name: "nudge_idempotency_unique", key: { idempotency_key: 1 }, unique: true as const },
  { name: "nudge_outreach_created", key: { outreach_record_id: 1, createdAt: -1 } },
  { name: "nudge_link_created", key: { rep_identity_link_id: 1, createdAt: -1 } },   // per-rep rate limit
  { name: "nudge_status", key: { status: 1, createdAt: -1 } },
] as const;

const OwnerRepNudgeSchema = new Schema(
  {
    idempotency_key: { type: String, required: true, trim: true },
    actor: { type: registryActorSnapshotSchema, required: true },           // reuse Operations Registry actor snapshot shape
    outreach_record_id: { type: Schema.Types.ObjectId, ref: "OutreachRecord", required: true },
    contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", required: true },
    lead_ref: { type: leadRefSchema, default: null },
    rep_identity_link_id: { type: Schema.Types.ObjectId, ref: "RepIdentityLink", required: true },
    agent_id: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    channel: { type: String, required: true, enum: ["team_messaging", "sms_to_rep", "pager"] },
    destination: { type: String, required: true, trim: true },            // chat id, rep DID e164, or extension number — validated ≠ any customer number
    template_key: { type: String, required: true, trim: true },
    template_version: { type: Number, required: true },
    body_as_sent: { type: String, required: true },                         // ≤ 1,000 chars; masked customer number policy applies (last 4 only)
    preconditions_snapshot: {                                              // what was true at send time
      type: new Schema({
        outreach_state: String, overdue: Boolean, attachment_certainty: String,
        rep_link_status: String, policy_version: String,
      }, { _id: false }),
      required: true,
    },
    status: { type: String, required: true, enum: ["pending", "sent", "failed", "fallback_sent"], default: "pending" },
    provider_message_id: { type: String, default: null, trim: true },
    provider_response_status: { type: Number, default: null },
    fallback_channel: { type: String, default: null, enum: [null, "pager"] },
    error_code: { type: String, default: null, trim: true },              // bounded closed set; never provider body
    sent_at: { type: Date, default: null },
  },
  { collection: "owner_rep_nudges", autoIndex: false, timestamps: true, minimize: false },
);
```

## 11. `SalesIntelligenceSyncState` — `sales_intelligence_sync_state`

One row per stream, `key` unique. Streams: `call_log_all_directions`, `directory`, `media_fetch`, `transcription`, `extraction`, `attachment_suggest`, `outreach_derive`.

```ts
{
  key: String,                                   // unique
  lease_owner: String | null, leased_until: Date | null, lease_epoch: Number,   // MongoLeaseStore-compatible (src/services/durableWork/leases.ts)
  cursor: { last_sync_from: Date | null, last_sync_to: Date | null, provider_modified_watermark: Date | null },
  known_complete_through: Date | null,           // Coverage Watermark for call_log_all_directions
  last_run: { started_at, finished_at, runtime_ms, pages, records, upserts, throttled_count, error_code: String | null },
  gaps: [{ from: Date, to: Date, reason: String, opened_at: Date }],          // bounded 50; closed gaps removed on repair
  consecutive_failures: Number,
}
```

Unique index `{ key: 1 }` named `sales_intelligence_sync_state_key_unique`; runtime fails closed when absent (same posture as the Call Log sync state).

## 12. `SalesIntelligenceSyncWindow` — `sales_intelligence_sync_windows`

Backfill manifests. `{ stream, window_from, window_to, status: planned|running|complete|partial|failed, pages_done, records, checkpoint_page, attempts, last_error_code, completed_at }`. Unique `{ stream, window_from }`. Backfill runs oldest-first in fixed 24-hour windows; a window is `complete` only after every page persisted.

## 13. `SalesIntelligenceAiBudget` — `sales_intelligence_ai_budget`

One doc per `YYYY-MM`. `{ month, ceiling_cents, reserved_cents, actual_cents, reservations: [{ job_ref, kind: stt|extract|classify|summary, estimated_cents, actual_cents|null, at }] (bounded; older folded into totals) }`. Reserve atomically with `$inc` guarded by `reserved_cents + estimate ≤ ceiling_cents`; reconcile actual after the provider response. Depleted budget → conversations enter `unavailable` with `budget_exhausted`.

## 14. Read-only joins (no schema change)

| Existing model | Fields read | Purpose |
| --- | --- | --- |
| `FormLead` | `_id`, `timestamp`, `createdAt`, `name`, `phone_number`, `normalized_phone_number`, `ingested_contact_snapshot.normalized_phone_number`, `granot_contact_snapshot.*`, `receiver_agent`, `receiver_agent_name_snapshot`, `booked`, `cancelled`, `duplicate`, `bad_lead`, `no_sync`, `job_no`, source labels | Attachment suggestion, eligibility, display |
| `CallLead` | same plus `ringcentral.telephony_session_id`, `session_id`, `call_log_id`, `original_caller.normalized_phone_number` | Exact attachment |
| `BookedLead`, `CancelledLead` | ids, `booked_at`, `job_no`, allocations (names) | Closed reason + context |
| `LeadMessage` | `lead_ref`, `to`, `status`, `sent_at`, `delivered_at`, `body` (masked in DTO) | Timeline entries, `last_meaningful_contact_at` |
| `Agent` | `_id`, `name`, `active`, `name_aliases`, `granot_crm_username` | Rep Identity Link proposals and display |
| `ExtensionUser` | `_id`, `email`, `roles` | Optional link |
| `RingCentralInboundRoute` (+ assignments) | `phone_number`, `active`, effective dates | `inbound_route_id` on interactions; hygiene |
| `ringcentral_webhook_events` | raw capture | Replay / repair |

Change streams or `updatedAt` watermarks on `form_leads` / `call_leads` / `booked_leads` / `cancelled_leads` drive the attachment and eligibility refresh (see 03 §4). No hooks are added to Lead write paths.
