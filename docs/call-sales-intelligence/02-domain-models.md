# 02 — Domain models

CSI-14 destination addendum (September 19): Owner send destinations are current User extensions on the stored directory snapshot for that RingCentral account. `rep_identity_link_id` and `agent_id` are optional when the Owner chose a directory User with no reviewed Agent match. Rate admission is per `(rc_account_id, rc_extension_id)` in the rolling hour, not per link. Reviewed identity remains required for metrics, automatic assignment, and reviewed-rep outbound analysis. See [01 §3/§9](01-specification.md).

CSI-14 implementation addendum (September 18): the existing OwnerRepNudge collection/indexes now carry revision, durable Owner command ID/payload, submission deadline/boundary, account/sender/recipient snapshots and a separately persisted exact provider receipt. No second nudge collection is introduced. The September 18 per-link rolling-hour wording is superseded by the destination addendum above. See [runtime Service](../knowledge/services/sales-intelligence-nudges.md) and [concrete contract](workspace/evidence/csi-14/API-CONTRACT.md).

Status: build contract, not implemented. Revised September 17, 2026. Pack index: [`README.md`](README.md). Rules: [`01-specification.md`](01-specification.md).

CSI-06 additive schema coordination (September 18): `OutreachFollowup.source_interaction_id` and `SalesIntelligenceContactRestriction.source_interaction_id` are nullable immutable ObjectId references. `OutreachFollowup.source_due_at` retains the original nullable source date independently of Owner rescheduling. These retain the source commitment/restriction independently of later completion evidence or Owner resolution, preventing cross-run replay from recreating fulfilled/corrected work while preserving separately dated actions. Existing indexes remain sufficient because writes serialize through the Outreach aggregate and Contact Number; no new migration/index is introduced. Default-deadline policy versions remain in each action's `date_resolution.policy_version`.

## 0. Conventions

- Runtime Mongoose models live in `src/models/`, `snake_case` fields, `autoIndex: false`, `timestamps: true`, `minimize: false`, and a `getXModel()` accessor that honours `getMongoDatabaseName()` (the `TEST_MODE` DB boundary), exactly like `src/models/LeadConversation.ts`.
- Index definitions are exported as `X_INDEXES` arrays and applied by `scripts/migrations/sales-intelligence-indexes.ts` (`--report | --apply --confirm-production=<db> | --verify`), mirroring `scripts/migrations/lead-conversation-indexes.ts`. Runtime never creates indexes and fails closed when a unique fence is missing.
- Enum constants live in `src/config/domain/salesIntelligence.ts` (barrel-exported via `domain.ts`).
- Raw provider payloads keep using the existing `ringcentral_webhook_events` capture (with its `_test` suffix mode). New collections below do **not** use the `_test` suffix; they rely on the DB boundary.
- Phone normalization: `normalizePhoneNumberForStorage` / `normalizePhoneNumberForMatch` from `src/utils/phone.ts` for parity with Leads; add `toE164(value, defaultCountry="US")` and `toNationalTenDigit()` in `src/services/numberActivity/phone.ts`. Store provider originals untouched.

Capture and core collections below; run/evidence/application/review/job/policy collections are specified in §15:

| Collection | Model | Purpose |
| --- | --- | --- |
| `contact_numbers` | `ContactNumber` | Endpoint identity, classification, eligibility, search terms, rollups |
| `call_interactions` | `CallInteraction` | Canonical telephony session with parties, legs, recording pointers |
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
    revision: { type: Number, required: true, default: 1 },
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
    running_summary: {                                       // projection from a completed number-level analysis run
      type: new Schema({
        text: { type: String, required: true },
        run_id: { type: Schema.Types.ObjectId, ref: "IntelligenceRun", required: true },
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
  { name: "call_interaction_session_unique", key: { provider: 1, provider_account_id: 1, telephony_session_id: 1 }, unique: true as const,
    partialFilterExpression: { telephony_session_id: { $type: "string" } } },
  { name: "call_interaction_session_id", key: { provider: 1, provider_account_id: 1, session_id: 1 }, sparse: true },
  { name: "call_interaction_call_log_ids", key: { provider: 1, provider_account_id: 1, call_log_ids: 1 } },
  { name: "call_interaction_number_started", key: { contact_number_id: 1, started_at: -1 } },
  { name: "call_interaction_started_window", key: { started_at: -1, _id: -1 } },
  { name: "call_interaction_extension_started", key: { "parties.extension_id": 1, started_at: -1 } },
  { name: "call_interaction_recording", key: { "recordings.provider_recording_id": 1 }, sparse: true },
  { name: "call_interaction_provider_modified", key: { provider_last_modified_at: -1 } },
  { name: "call_interaction_updated", key: { updatedAt: -1, _id: -1 } },   // repair/read index; SSE uses the durable audit stream
] as const;

const partySchema = new Schema(
  {
    party_id: { type: String, default: null, trim: true },
    last_webhook_sequence: { type: Number, default: null }, // sequence is tracked per party
    last_event_at: { type: Date, default: null },
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
    provider_account_id: { type: String, required: true, trim: true },
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
    contact_type_basis: { type: String, default: null, trim: true }, // "provider:voicemail", "transcript:<version>", "owner"; duration alone proves neither voicemail nor human

    parties: { type: [partySchema], default: [] },
    legs: { type: [legSchema], default: [] },                       // bounded 40; overflow_count below
    legs_overflow_count: { type: Number, required: true, default: 0 },
    connected_user_extension_ids: { type: [String], default: [] },
    queue_fanout: { type: Boolean, required: true, default: false },
    transfer: { type: Boolean, required: true, default: false },
    monitoring: { type: Boolean, required: true, default: false },

    recordings: {
      type: [new Schema({
        provider_recording_id: { type: String, required: true, trim: true },
        recording_type: { type: String, default: null, trim: true },
        observed_at: { type: Date, required: true },
        lead_conversation_id: { type: Schema.Types.ObjectId, ref: "LeadConversation", default: null },
      }, { _id: false })],
      default: [],
    },

    // provenance
    sources: { type: [String], default: [] },                       // ["webhook","call_log_reconcile","backfill"]
    provider_last_modified_at: { type: Date, default: null },
    terminal: { type: Boolean, required: true, default: false },
    projection_revision: { type: Number, required: true, default: 1 },
    max_observed_webhook_sequence: { type: Number, default: null }, // diagnostic only, never filters other parties
    first_observed_at: { type: Date, required: true },
    last_observed_at: { type: Date, required: true },
  },
  { collection: "call_interactions", autoIndex: false, timestamps: true, minimize: false },
);
```

Rules:

- Identity is account-scoped: required provider account comes from the payload or verified configured account, never a shared null value. Use telephony session, then session id, then Call Log id. Store each observed alias in `call_interaction_aliases` with unique `(provider,provider_account_id,kind,value)` → interaction id. Reserve aliases and upsert the interaction transactionally so fallback identities are also uniquely fenced. A later exact provider bridge can attach aliases to the existing canonical row. If it bridges two already-persisted provisional rows, merge only with explicit same-session provider proof: select the earlier-created canonical row, migrate dependent refs/idempotency mappings and rollups atomically, tombstone the other with `merged_into_id`. Without such proof, preserve both and open an identity/coverage exception; never merge by phone/time.
- One interaction may expose several recording IDs, including transferred legs. Keep `recordings[]` deduplicated by provider id and discover each once. Number/call counts count the canonical interaction once; conversation count counts actual recordings. Do not drop all but the first recording. `recording` singular from the earlier draft is retired; if a UI shows one preview, mark that as a projection of the array.
- `projection_revision` increments on every projection change; a webhook event with `sequence` ≤ `last_webhook_sequence` for the same party is ignored. Never use one session-level max sequence to discard another party from the same delivery. A Call Log reconcile that carries `lastModifiedTime` ≤ `provider_last_modified_at` and no new legs, recordings or other material evidence is a no-op.
- `terminal` flips true once and never back. Late events may add legs, a recording, or `ended_at`, never un-terminate.
- `contact_type` may only be set to `human_conversation` by transcript evidence or Owner; rules may set `voicemail`.
- CSI-02 additive field `external_endpoint_kind` (nullable, `CONTACT_NUMBER_KINDS`) records the classification of the counterparty endpoint so withheld, malformed, service-code and company endpoints keep honest provider evidence when `contact_number_id` is null. Only `external` endpoints create a Contact Number.

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
    // CSI-05 additive pins: exact evidence authorizes only this account/interaction identity.
    interaction_id: { type: Schema.Types.ObjectId, default: null },
    provider_account_id: { type: String, default: null },
    identity_kind: { type: String, enum: [null, "telephony_session_id", "session_id", "call_log_id"], default: null },
    identity_value: { type: String, default: null },
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
    lead_snapshot: {                                                  // display cache; refresh in worker, never mutate on GET
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
    revision: { type: Number, required: true, default: 1 },
    decided_by: { type: String, default: null, trim: true },          // actor label for owner decisions
    decided_at: { type: Date, default: null },
    decision_reason: { type: String, default: null, trim: true },
    auto_decision: {                                                  // high-confidence automatic attach; never `decided_at`
      type: new Schema({
        confidence: { type: Number, required: true, min: 0, max: 1 },
        reason: { type: String, required: true, trim: true },
        decided_at: { type: Date, required: true },
      }, { _id: false }),
      default: null,
    },
    history: { type: [new Schema({ from: String, to: String, at: Date, by: String, reason: String }, { _id: false })], default: [] },
  },
  { collection: "number_lead_attachments", autoIndex: false, timestamps: true, minimize: false },
);
```

Automatic attach is flag-gated (`AUTO_ATTACH`, default off) and additive to exact evidence, which keeps its own Attached/Exact result. An edge attaches by itself only when it is not rejected, carries no Owner `decided_at`, would not be Ambiguous under the same window-overlap fan-in, has no already-Attached competitor on the number, and carries at least one windowed `lead_phone_live` or `ringcentral_original_caller` item: `0.90` for one such source, `0.95` when two or more agree on the same Lead, and no tier below that. The result is Attached/Likely with `decision_reason` `automatic_high_confidence` and an `auto_decision` record — not Exact and not Confirmed by you. `decided_at` stays null so refresh keeps revising the edge; `reject_attachment` and `detach_attachment` remain the reversal, and a rejected pair never resurrects. The decision is written through the same committed change contract as an evidence refresh, so the Outreach mirror, search terms and live stream all see it.

## 4. `OutreachRecord` — `outreach_records`

One row per subject. Preserve the unique index on `subject.kind/model/id/contact_number_id`; state/due, responsible Agent/state, primary number, and updatedAt/id indexes support Attention and live reads. Mongo `revision` CAS guards all mutations. Subject is either one Lead or one Number Review, never both.

| Field | Required contract |
| --- | --- |
| `subject` | `{kind: lead, model: FormLead\|CallLead, id}` or `{kind: number_review, contact_number_id}`. |
| `state`, `state_before_identity_review` | Five states from 01; previous state nullable. Official closure wins over restoration. |
| `primary_contact_number_id` | Nullable Contact Number reference; never silently picks among ambiguous candidates. |
| `trigger_kind`, `trigger_at`, `first_action_due_at` | Lead arrival, unanswered inbound, Owner open, or clear sales commitment; stored policy version and deadline resolution basis. |
| `first_attributable_outbound_at`, `first_human_conversation_at`, `last_meaningful_contact_at` | Distinct nullable timestamps; human contact alone resets the meaningful-contact clock. |
| `next_action` | Rebuildable projection of the most urgent active follow-up, including `followup_id`, action kind, nullable due time, description. Never the authoritative single action store. |
| `wait_until`, `wait_reason`, `wait_followup_id` | Nullable projection of the relevant customer wait; independent rep actions can keep state Open. |
| `responsible_agent_id`, `assignment` | Nullable Agent plus `{origin: owner\|first_conversation\|rep_promise, actor_id, evidence_id, assigned_at, instruction_id?}`. Never copied from receiver Agent. |
| `lead_attachment`, `lead_attachment_revision` | Nullable mirror of the deciding `NumberLeadAttachment` edge — `{attachment_id, lead_ref, state, certainty, decided_by: owner\|automatic\|evidence, decided_at, confidence, observed_at}` — plus the Contact Number revision it was built from. Recomputed inside the attachment change transaction and audited as `outreach_lead_attachment_mirrored`. Ambiguous or competing identity is recorded as Ambiguous, never resolved to one Lead. Confidence is populated only for an automatic decision. Monotonic: an older Contact Number revision never clobbers a newer mirror. Bounded display cache per §17; the append-only audit rows remain the full history. |
| `call_progress` | Nullable `{state: in_progress\|ended, started_at, started_by, ended_at, ended_by, note, interaction_id}`. Owner call progress only; it is deliberately not a `state` value, because that enum carries official closure meaning. Starting again after an ended call replaces the field and the audit stream keeps the history. A later Call Interaction covering the started window stamps `interaction_id` and ends it, so the Owner need not press stop. |
| `closed_reason`, `closed_at`, `closed_by`, `closure_origin` | Official eligibility reason or explicit Owner reason; preserve Owner history even if later official context changes. |
| `revision`, `policy_version` | Required CAS integer and configuration version. |
| `events` | Optional bounded recent-event cache only. Full history is in append-only `sales_intelligence_audit_events`; never drop history into a counter. |

Lead `receiver_agent` remains read-only Received by context. No separate Sales Assignment/offer collection is required for v1. Unassigned work may get one clear first-conversation rep or promising rep; Owner assignment cannot be replaced by later calls.

## 5. `OutreachFollowup` — `outreach_followups`

Several active rows per Outreach. Index `(outreach_record_id,status,due_at)`, `(responsible_agent_id,status,due_at)`, `(status,due_at)`, and unique `commitment_key`. There is no unique-active-followup-per-record index. Exclude null due times from clock comparisons.

| Field | Required contract |
| --- | --- |
| `outreach_record_id`, `commitment_key` | Required references/stable obligation identity. Idempotency across reruns does not depend solely on a new run id or finding ordinal. |
| `kind`, `description` | call, text_customer_via_lead_message, send_estimate, check_availability, review, wait, reconcile_identity, other. Description required for other. |
| `status` | `open`, `completed`, `cancelled`, `superseded`. Due/overdue/paused are derived, not lifecycle status. |
| `due_at`, `date_text`, `date_resolution` | Nullable UTC deadline; original wording; precision/timezone/assumption/anchor/policy version. Undated is valid. |
| `base_attention_due_at`, `attention_due_at`, `snoozed_until`, `wait_expired_at` | Nullable; effective Attention date is max(base date, snooze). Day-only customer waits become actionable at next opening. Preserve contractual due date; see 01 §12. |
| `missed_episode_key`, `trigger_interaction_ids`, `first_missed_at` | Nullable system callback episode identity; repeated misses retain the first deadline until a relevant callback/human inbound resolves it. |
| `responsible_agent_id`, `assignment` | Per-action assignment with origin/evidence. Owner's explicit assignment of this action wins. |
| `promised_by_agent_id`, `requested_by`, `origin` | Speaker separate from responsible Agent. Origin `owner`, `rep_promise`, `customer_request`, `customer_wait`, `system_default`; source run/finding/interaction links. |
| `source_finding_ids`, `origin_run_id`, `owner_instruction_ids` | Provenance and Owner control refs. Several findings/runs may support one obligation. |
| `disposition`, `completion_basis`, `completed_at`, `completed_by` | Exact outcome; basis `owner`, `call_attempt`, `customer_confirmation`, `rep_confirmation`, `vantage_evidence`. Never imply Spoke from attempt. |
| `evidence_interaction_id`, `completion_finding_id` | Nullable completion proof; generic later activity is insufficient. |
| `supersedes_id`, `cancel_reason`, `revision` | History and CAS; cancel on retract/closure, supersede only that commitment when clearly replaced. |

Active call restrictions are joined for action eligibility, not stored by destroying due dates. Recompute `next_action` after every relevant mutation. Undated commitments open date-needed review and do not equal No next step. Follow-up assignment can differ from Outreach ownership.

## 6. `LeadConversation` — extend `lead_conversations`

Retain existing seed compatibility and Owner-only reads. Migrate recording uniqueness to `(provider, provider_account_id, provider_recording_id)` after backfilling each existing row with the verified account id; never guess an account for legacy rows. Add account-scoped aliases without duplicating existing recordings. Keep private media and redacted transcript. Add `call_interaction_id`, `contact_number_id`, contact type/basis, speaker evidence, `media_digest_sha256`, `latest_transcript_version`, and `latest_completed_run_id`. `lead_ref` is nullable for number-only and ambiguous evidence. Add match methods `call_interaction_number_candidate`, `number_only`, and `ambiguous_number_context`; add low confidence for unlinked/ambiguous rows. Use these explicit values rather than claiming a candidate match on an unlinked number.

Replace threshold-based relevance with `analysis_eligibility: {eligible, reasons[], decided_at, policy_version}`. Reasons: `form_linked`, `call_linked`, `number_review`, `mapped_sales_inbound`, `reviewed_rep_outbound`, `ambiguous_lead_context`, `owner_requested`; exclusions: `internal_company`, `known_non_customer`, `no_sales_context`. No minimum duration and no voicemail skip. Closed Lead eligibility for Outreach is separate from eligibility for analysis.

CSI-11 additive adaptation: `eligible: null` plus `status: undetermined` and `missing_inputs[]` distinguishes absent CSI-05/10 evidence from exclusion. `status` is `eligible|excluded|undetermined`; `scope` is `lead|number`. Existing legacy eligibility remains readable. Discovery preserves `Internal` direction too (excluded automatically) rather than rewriting it as Unknown. `CallInteraction.recording_discovery` projects `state: pending|discovered|no_recording`, bounded reason, `checked_at` and nullable `next_attempt_at`; missing recording IDs never create a LeadConversation. The worker queue remains `sales_intelligence_jobs`.

Add `unavailable` to processing states; keep other existing states. Store availability reason, retry time, pending stage and errors separately from latest successful analysis. Each redacted transcript version is immutable in `intelligence_evidence_snapshots` with segment `{sid,start_ms?,end_ms?,speaker:rep|customer|unknown,text}`. The conversation may cache the latest version but must not overwrite prior run evidence. Speaker is unknown without evidence.

### 6.1 Existing-model adaptation (verified against code)

`src/models/LeadConversation.ts` already allows null `lead_ref` but requires `call_log_id`, `rc_result`, duration, direction and both masked endpoints. A recording observed before final Call Log enrichment cannot fabricate them. Make `call_log_id`, `rc_result`, `duration_seconds` and unavailable masked endpoints nullable; permit direction `Unknown` until resolved. Keep started_at required from real observed call timing; never substitute analysis time. Extend `src/services/conversations/reads.ts`, existing list/detail types and Admin consumers for those nulls. Reconcile later provider values without rewriting prior snapshot evidence.

The existing `summary` is `{text,model,prompt_version,created_at}`, not typed section fields. Add optional `sections` with existing public names `overview`, `customer_wanted`, `money_dates`, `outcome`, `promised`, `mismatch`; map envelope money_and_dates→money_dates, commitments→promised, discrepancies→mismatch. Preserve `summary.text` as a deterministic rendering of those sections. Reads prefer structured sections; the existing text parser is legacy fallback only. Analysis run output remains authoritative and versioned.

Existing `attempts`, `claimed_by`, `claim_expires_at`, `next_attempt_at` are seed-era compatibility fields, not a second worker queue. New stage claims live only in `sales_intelligence_jobs`; conversation fields may project latest stage status but cannot elect another worker. Seeded complete conversations remain readable without a fabricated run; a later requested analysis creates a real run over their redacted transcript.

Existing `uploadConversationMp3` reads a local seed artifact and overwrites `conversations/<recordingId>.mp3`. Automated processing gets a streaming, content-type-aware adapter with immutable account/recording/digest Blob keys. Do not overwrite bytes referenced by an earlier evidence version. Existing seed paths remain playable. Each run references its media digest; signed audio links resolve that version, and return a purge tombstone when unavailable.

## 7. `IntelligenceFinding` — `intelligence_findings`

Canonical typed payload is [10 §3](10-intelligence-agent-contract.md#3-envelope). Strictly validate by kind; do not use unconstrained mixed payloads for application. Kinds include contact_type, intent, move_fact, objection, quoted_amount, promised_callback, customer_requested_callback, customer_will_call, next_step, completion_claim, reschedule, booking_claim, payment_claim, contact_restriction, competitor_mention, coaching_note. Number summaries belong to run output/Contact Number projection and are never independent effectful claims.

Required fields: `run_id`, unique `key` within run, immutable assertion version plus mutable review-projection `revision`, conversation/number/Outreach refs (nullable where inapplicable), `kind`, `claim`, `basis`, actor/speaker/action status, clarity, typed `value`, evidence refs, prompt/schema/model versions, createdAt. `resolved` contains code-resolved dates/amounts with original wording, uncertainty and assumptions. Index unique `(run_id,key)`, `(contact_number_id,kind,createdAt)`, `(outreach_record_id,review_state)`, and `(conversation_id,run_id)`.

Separate `review_state: unreviewed|confirmed|corrected|retracted` from `superseded_by` and application effects. Preserve immutable original assertion and append reviews/corrections; the current view is a projection. `validation: {schema_ok, source_snapshots_valid, locator_status:not_run|located|unlocated, entailment_check:not_run|pass|fail|unsure}`. In v1 exact location and entailment are not gates. A locator error does not dismiss a finding. Ordinary unreviewed assertions are not all Needs review items.

Effects live in `intelligence_effects`, with zero or multiple rows per finding. Confirmation never reapplies them. Corrections are Owner commands that synchronously revise/retract targeted effects, then schedule analysis. Persist model assessments against exact Owner instruction id/revision; missing assessment renders Cannot determine. Newly generated findings never inherit old confirmation automatically.

## 8. `RepIdentityLink` — `rep_identity_links`

CSI-10 implementation: intervals are `[effective_from,effective_to)`. A reviewed retired row retains historical authority only with review metadata and a finite end; an unreviewed retired proposal has none. Owner review changes create successor rows and atomically close predecessors. Existing account/extension current uniqueness remains; finite historical overlaps are additionally rejected under a transactional extension-specific SyncState write fence. No new identity collection/index is introduced. Existing CSI jobs gain nullable typed `rep_identity_window` metadata for bounded consumer recovery; ObjectId `input_refs` are unchanged. See [Service](../knowledge/services/sales-intelligence-rep-identity.md).

```ts
export const REP_IDENTITY_LINK_INDEXES = [
  { name: "ril_extension_current_unique", key: { rc_account_id: 1, rc_extension_id: 1 }, unique: true as const,
    partialFilterExpression: { effective_to: null } },
  { name: "ril_agent_current", key: { agent_id: 1, effective_to: 1 } },
  { name: "ril_status", key: { status: 1 } },
] as const;

const RepIdentityLinkSchema = new Schema(
  {
    revision: { type: Number, required: true, default: 1 },
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

Rules: an Agent may hold several current links (multiple extensions). One extension has at most one current link. `proposed` links never satisfy metric, automatic-assignment, or reviewed-rep analysis preconditions. Owner send destinations are current directory Users, not this collection. Attention "Message rep" pickers list current User extensions from the stored snapshot. A reviewed `sales_rep` link, when present, may prefill display name and stored channel metadata; its absence does not hide the User. Department, Queue, and other non-User extensions are never destinations.

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
  { name: "nudge_link_created", key: { rep_identity_link_id: 1, createdAt: -1 } },
  { name: "nudge_extension_created", key: { rc_account_id: 1, rc_extension_id: 1, createdAt: -1 } },   // per-User rate limit
  { name: "nudge_status", key: { status: 1, createdAt: -1 } },
] as const;

const OwnerRepNudgeSchema = new Schema(
  {
    idempotency_key: { type: String, required: true, trim: true },
    actor: { type: registryActorSnapshotSchema, required: true },           // reuse Operations Registry actor snapshot shape
    outreach_record_id: { type: Schema.Types.ObjectId, ref: "OutreachRecord", required: true },
    contact_number_id: { type: Schema.Types.ObjectId, ref: "ContactNumber", required: true },
    lead_ref: { type: leadRefSchema, default: null },
    rc_account_id: { type: String, required: true, trim: true },
    rc_extension_id: { type: String, required: true, trim: true },
    rc_extension_number: { type: String, default: null, trim: true },
    rc_extension_name_snapshot: { type: String, default: null, trim: true },
    rep_identity_link_id: { type: Schema.Types.ObjectId, ref: "RepIdentityLink", default: null },
    agent_id: { type: Schema.Types.ObjectId, ref: "Agent", default: null },
    channel: { type: String, required: true, enum: ["team_messaging", "sms_to_rep", "pager"] },
    destination: { type: String, required: true, trim: true },            // chat id, User DID e164, or extension number — validated ≠ any customer number
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
    status: { type: String, required: true, enum: ["pending", "sent", "failed", "unknown_delivery", "fallback_sent"], default: "pending" },
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

One row per stream, `scope` unique (the actual `MongoLeaseStore` key). Streams: `call_log_all_directions`, `directory`, `media_fetch`, `transcription`, `extraction`, `attachment_suggest`, `outreach_derive`.

```ts
{
  scope: String,                                 // unique; matches durableWork/leases.ts
  lease_owner: String | null, leased_until: Date | null, lease_epoch: Number,   // MongoLeaseStore-compatible (src/services/durableWork/leases.ts)
  cursor: { last_sync_from: Date | null, last_sync_to: Date | null, provider_modified_watermark: Date | null },
  known_complete_through: Date | null,           // Coverage Watermark for call_log_all_directions
  last_run: { started_at, finished_at, runtime_ms, pages, records, upserts, throttled_count, error_code: String | null },
  gaps: [{ from: Date, to: Date, reason: String, opened_at: Date }],          // bounded 50; closed gaps removed on repair
  consecutive_failures: Number,
}
```

Unique index `{ scope: 1 }` named `sales_intelligence_sync_state_scope_unique`; runtime fails closed when absent (same posture as the Call Log sync state).

## 12. `SalesIntelligenceSyncWindow` — `sales_intelligence_sync_windows`

Backfill manifests. `{ stream, window_from, window_to, status: planned|running|complete|partial|failed, pages_done, records, checkpoint_page, attempts, last_error_code, completed_at }`. Unique `{ stream, window_from }`. Backfill runs oldest-first in fixed 24-hour windows; a window is `complete` only after every page persisted.

## 13. `SalesIntelligenceAiBudget` — `sales_intelligence_ai_budget`

CSI-01 implementation adds nullable `activated_at` to the persisted timezone-period bounds. Initialization of the current period atomically stamps it and resumes eligible current-deployment budget-paused jobs once. Future periods stay inactive until their start; repeated initialization does not repeatedly wake exhausted work. Team C supplies the calendar bounds.

One totals doc per `YYYY-MM` budget period in the configured timezone: `{month, ceiling_cents, reserved_cents, actual_cents, policy_version}`. Initial ceiling is 8000 cents. Reserve atomically only when `actual_cents + reserved_cents + estimate <= ceiling_cents`. Track each reservation in `sales_intelligence_ai_reservations` with unique reservation id, job/run/step, stage, estimated/actual cost, status and timestamps. Reconciliation subtracts reserved estimate and adds actual once; release unused reservations on terminal failure. Never drop unresolved reservations into a bounded array. Depletion pauses the pending stage/job with `budget_exhausted`; operational capture and Owner commands continue. See 10 §8 for provider estimation limits and resume behavior.

## 14. Read-only joins (no schema change)

| Existing model | Fields read | Purpose |
| --- | --- | --- |
| `FormLead` | `_id`, `timestamp`, `createdAt`, `name`, `phone_number`, `normalized_phone_number`, `ingested_contact_snapshot.normalized_phone_number`, `granot_contact_snapshot.*`, `receiver_agent`, `receiver_agent_name_snapshot`, `booked`, `cancelled`, `duplicate`, `bad_lead`, `no_sync`, `job_no`, source labels | Attachment suggestion, eligibility, display |
| `CallLead` | same plus `ringcentral.telephony_session_id`, `session_id`, `call_log_id`, `original_caller.normalized_phone_number` | Exact attachment |
| `BookedLead`, `CancelledLead` | ids, `booked_at`, `job_no`, allocations (names) | Closed reason + context |
| `LeadMessage` | `lead_ref`, `to`, `status`, `sent_at`, `delivered_at`, `body` (masked in DTO) | Timeline/context only; automated delivery does not reset the human-contact clock |
| `Agent` | `_id`, `name`, `active`, `name_aliases`, `granot_crm_username` | Rep Identity Link proposals and display |
| `ExtensionUser` | `_id`, `email`, `roles` | Optional link |
| `RingCentralInboundRoute` (+ assignments) | `phone_number`, `active`, effective dates | `inbound_route_id` on interactions; hygiene |
| `ringcentral_webhook_events` | raw capture | Replay / repair |

Consume durable EntityChange records for relevant Vantage changes, with updatedAt watermarks/meaningful-field digest scans as repair (03 §14). Lead writes do not depend on intelligence succeeding and no new independent Granot webhook is added.

## 15. Run, evidence, application, and review collections

All collections use explicit migrations, `autoIndex:false`, the configured database boundary, and no test-name suffix. ObjectIds below are server-issued; model evidence references must resolve within the run.

| Collection | Fields and unique fence |
| --- | --- |
| `intelligence_runs` | subject/number/conversation ids, mode `initial\|original_evidence\|current_context\|number_refresh\|backfill`, parent run, triggering event ids, input fingerprint, prompt/schema/model versions, exact rendered prompt, owner correction refs, manifest digest, raw structured output, normalized envelope, usage/cost, timestamps, status `queued\|running\|submitted\|completed\|stale\|paused\|failed\|dead_letter`; completed means publication/application evaluation finished, with applied/blocked/review counts stored separately. Unique job identity; explicit Owner rerun gets its own command identity. Finalized evidence/output immutable. |
| `intelligence_evidence_snapshots` | run id or reusable transcript version, source type/id/revision, tool name and redacted arguments, redacted response, retrieved_at, event time, content digest, completeness/coverage. Unique `(run_id,tool_call_id)` for tool reads; unique `(conversation_id,transcript_version)` partial index for transcript snapshots. |
| `intelligence_submissions` | unique run_id, payload hash, envelope, received_at, application job id. Same payload replay returns same receipt; changed payload conflicts. |
| `intelligence_effects` | run/finding ids, stable commitment ref, kind, target id/revisions, previous/new values, status/reason, applied_at, superseding/reversing effect refs. Unique `(run_id,finding_key,effect_kind,target_key)` prevents same-run duplicates; stable commitment uniqueness prevents cross-run duplicates. |
| `sales_intelligence_owner_instructions` | subject/follow-up/finding scope, field, prior/current value, actor, timestamp, revision, active/retracted/satisfied state. Append revisions; preserve corrections and assignment overrides. |
| `intelligence_owner_assessments` | run_id, instruction_id/revision, agrees/disagrees/cannot_determine, reason, finding refs. Unique `(run_id,instruction_id,instruction_revision)`. |
| `sales_intelligence_review_items` | subject key, cause kind, cause key, open/resolved/dismissed, evidence refs, resolution actor/time/reason, revisions/history. Unique `(subject_key,cause_kind,cause_key)` for refresh/reopen of same cause. Missing date, identity, completion target, restriction, official mismatch, Owner conflict and closed-work request are typed causes. |
| `sales_intelligence_contact_restrictions` | contact number, channels, until nullable, origin/actor/source run/finding, Owner resolution, state `active\|expired\|resolved`, revision. Indefinite AI pause is not permanent suppression. |
| `sales_intelligence_audit_events` | append-only subject/event/command ids, actor, event time, recorded time, prior/new values or refs, correlation/run ids. Unique semantic event key prevents replay duplicates. Include invalidation kind/target/subject/revision; index `(recorded_at,_id)` for the single SSE stream and subject/event-time for history. Redact event projections; never stream raw transcript content. CSI-02 adds invalidation kind `interaction` (03 §10 `interaction` event); capture writes `interaction.created`, `interaction.updated` and `interaction.merged` rows whose `current` summary carries `contact_number_id`. |
| `sales_intelligence_jobs` | unique dedupe_key, stage, subject/input revision, pending/leased/retry/paused/completed/dead_letter, attempt counters, next_attempt_at, lease_owner/epoch/expiry, reason, result ref. Index status/next_attempt_at; ownership check on completion. |
| `sales_intelligence_policy_versions` | immutable version, staffed hours/timezone, first/missed deadlines, cold threshold, monthly budget, enabled capabilities, actor/time. Active version selected by a singleton pointer changed with CAS. |

Run scope must distinguish per-conversation analysis and number-level refresh; do not require a fake conversation id for an official Booking-triggered refresh. Persist output links on Number Activity without creating a parallel LeadConversation store.

`SalesIntelligenceAiBudget` monthly default is 8000 cents. Reserve/reconcile all agent steps and STT. Use a durable per-job reservation ledger with unique reservation id; do not lose unresolved reservations by truncating an array. Store aggregate actual/reserved totals and timezone-period boundaries. Admission pauses do not discard jobs.

## 16. Ownership and history constraints

All effectful writes enforce Outreach/follow-up/instruction revisions in one transaction, with their audit rows and pending downstream jobs. Provider calls occur after commit. Lease epochs fence expired workers. Reanalysis may supersede current display, never destroy old Owner confirmation/correction. Retention propagates into evidence snapshots, prompts containing source content, tool responses, and derived outputs; retain non-content tombstones and expose original-evidence rerun unavailable when purged.

## 17. Additional integration fences

- `sales_intelligence_command_executions`: unique `(actor_scope,idempotency_key)`, command/payload hash, stored response, request id, trusted actor, target revisions and timestamps. Atomic with mutations/audit/next jobs. This module owns CSI command evidence and does not write an unsupported CSI entity into existing `EntityChange` enums.
- `sales_intelligence_attention_snapshots`: opaque snapshot id, Owner/filter/policy/dataset binding, as_of, ordered materialized row DTOs or chunk refs, counts, expires_at (5-minute TTL). Pages use this fixed result; commands always recheck live revisions. Expired cursor returns ATTENTION_SNAPSHOT_EXPIRED and client refreshes. This makes the paging guarantee explicit without pretending current mutable queries are historical snapshots.
- `call_interaction_aliases`: unique account-scoped provider aliases described in §2. Additional indexes point aliases to canonical interaction ids; merged aliases must not produce duplicate operational effects.
- Full model inventory/index migration includes these collections and the reservations collection in §13, not only the table at the start of the file. ContactNumber and RepIdentityLink need `revision` as well as timestamps for their Owner commands.
- Physical database follows deployment `TEST_MODE` and configured isolation. CSI has logical production/current-records scope only, not Admin historical/combined. All jobs, credentials, submissions, evidence and commands remain bound to the same deployment/database; never accept a model-supplied database.
- Array histories in ContactNumber/attachment/rep records are bounded display caches. Append-only audit rows retain full history under the policy; no required provenance is discarded to keep a document under Mongo limits.

## 18. Transcription adapter compatibility

Transcript-version segments use stable sid plus redacted text, nullable start_ms/end_ms and timing_source provider/unavailable. Never fabricate time offsets when the STT provider supplies text only. Preserve available actual timing and explicit unknown speaker. This refines §6 for the economical transcription proposal in [12](12-deployment-inputs-and-model-policy.md).

### CSI-18 additive storage

IntelligenceRun stores immutable `owner_correction_context` alongside the referenced instruction ids. Durable analysis/number-refresh jobs optionally store `owner_reanalysis:{run_id,source_run_id,mode,owner_correction_ids}` so preparation/retry use the same requested run. Evidence snapshots have nullable `purged_at,purge_reason` tombstone metadata; no retention worker or migration is introduced in CSI-18. Owner corrections append instructions/audits while the original assertion/output/effect documents remain immutable. Current finding review state and revision are projections over that history.
