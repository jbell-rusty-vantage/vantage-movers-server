import { Schema } from "mongoose";
import {
  CSI_ACTION_KINDS,
  CSI_OUTREACH_STATES,
} from "../../config/domain/salesIntelligence";
import {
  defineCsiModel,
  str,
  text,
  oid,
  ref,
  date,
  at,
  revision,
  count,
  strings,
  refs,
  enumeration,
  subject,
  leadRef,
  assignment,
  dateResolution,
  unique,
  index,
} from "./common";
export const OUTREACH_RECORD_INDEXES = [
  unique("outreach_subject_unique", {
    "subject.kind": 1,
    "subject.model": 1,
    "subject.id": 1,
    "subject.contact_number_id": 1,
  }),
  index("outreach_state_due", { state: 1, first_action_due_at: 1 }),
  index("outreach_agent_state", { responsible_agent_id: 1, state: 1 }),
  index("outreach_number", { primary_contact_number_id: 1 }),
  index("outreach_updated", { updatedAt: 1, _id: 1 }),
];
export const OutreachRecordSchema = new Schema(
  {
    subject: {
      type: subject,
      required: true,
      validate: (v: {
        kind: string;
        model?: string | null;
        id?: unknown;
        contact_number_id?: unknown;
      }) =>
        v.kind === "lead"
          ? Boolean(v.model && v.id && !v.contact_number_id)
          : Boolean(v.contact_number_id && !v.id && !v.model),
    },
    state: enumeration(CSI_OUTREACH_STATES, "unworked"),
    state_before_identity_review: {
      type: String,
      enum: [...CSI_OUTREACH_STATES, null],
      default: null,
    },
    primary_contact_number_id: ref,
    trigger_kind: enumeration([
      "lead_arrival",
      "unanswered_inbound",
      "owner_open",
      "clear_sales_commitment",
    ]),
    trigger_at: at,
    first_action_due_at: date,
    deadline_resolution: { type: dateResolution, default: null },
    first_attributable_outbound_at: date,
    first_human_conversation_at: date,
    last_meaningful_contact_at: date,
    // Team 4 AC3/AC5 (spec §5.4, §7.3), behind SALES_INTELLIGENCE_ATTENTION_EVOLUTION. No default:
    // a record the flag never touched stores none of them (flag-off rows stay byte-identical),
    // `null` means "computed, none", and a missing field is backfilled by the next ensure/repair.
    // Written at ensure time and read from the row, so the Attention walk adds no query.
    last_inbound_human_at: { type: Date },
    last_attributable_outbound_at: { type: Date },
    prior_contact_at: { type: Date },
    last_activity_at: { type: Date },
    // V-AC S1 (2026-09-24): the record revision at which the four facts were last written with the flag on.
    // A later flag-off write moves `revision` without it, so a mismatch means "stale: recompute".
    contact_facts_revision: { type: Number },
    next_action: {
      type: new Schema(
        {
          followup_id: oid,
          kind: enumeration(CSI_ACTION_KINDS),
          due_at: date,
          description: str,
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    wait_until: date,
    wait_reason: text,
    wait_followup_id: ref,
    responsible_agent_id: ref,
    assignment: { type: assignment, default: null },
    // Mirror of the deciding NumberLeadAttachment edge, so provenance is readable without
    // re-resolving identity on GET. A bounded display cache (17 §17): the append-only audit
    // rows stay the full history, and `lead_attachment_revision` keeps an older Contact
    // Number revision from clobbering a newer mirror.
    lead_attachment: {
      type: new Schema(
        {
          attachment_id: oid,
          lead_ref: { type: leadRef, required: true },
          state: enumeration(["candidate", "ambiguous", "attached", "rejected"]),
          certainty: enumeration([
            "exact",
            "likely",
            "unsure",
            "owner_confirmed",
            "rejected",
          ]),
          decided_by: enumeration(["owner", "automatic", "evidence"]),
          decided_at: date,
          confidence: { type: Number, default: null, min: 0, max: 1 },
          observed_at: at,
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    lead_attachment_revision: { type: Number, default: null },
    // Owner call progress. Deliberately not a CSI_OUTREACH_STATES member: that enum carries
    // official closure meaning, and being on the phone right now is not a closure.
    call_progress: {
      type: new Schema(
        {
          state: enumeration(["in_progress", "ended"]),
          started_at: at,
          started_by: str,
          ended_at: date,
          ended_by: text,
          note: text,
          interaction_id: ref,
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    closed_reason: text,
    closed_at: date,
    closed_by: text,
    // `crm_disposition` (LP-01): closed by an accepted Granot Priority 7/8.
    // Unlike `official` it can be reopened by an explicit Owner reopen once the
    // disposition is nonterminal again, or by a revision-scoped Owner override.
    closure_origin: {
      type: String,
      enum: ["owner", "official", "crm_disposition", null],
      default: null,
    },
    // LP-01 §3.2: server-owned projection of the Lead's current canonical
    // Priority/Quoted plus the evidence that work started. Additive; null until
    // the LEAD_PROGRESS flag has projected the record once.
    lead_progress: {
      type: new Schema(
        {
          granot_priority: text,
          quoted: { type: Boolean, default: null },
          disposition: enumeration([
            "fresh",
            "quoted",
            "rep_discretion",
            "crm_bad_unusable",
            "crm_dead",
            "unmapped",
            "unknown",
          ]),
          work_observed: { type: Boolean, required: true, default: false },
          basis: {
            type: String,
            enum: ["quoted", "priority_assigned", "priority_changed", "historical_snapshot", null],
            default: null,
          },
          provenance: enumeration(["accepted", "uncertain", "none"]),
          source_change_id: ref,
          source_origin: { type: String, enum: ["granot", "vantage", "ringcentral", null], default: null },
          source_observation_id: ref,
          source_decision_id: ref,
          source_applied_at: date,
          first_work_observed_at: date,
          last_progress_at: date,
          projected_at: at,
          fingerprint: str,
          disposition_revision: str,
          override: {
            type: new Schema(
              {
                reason: str,
                instruction_id: oid,
                disposition_revision: str,
                decided_at: at,
                decided_by: str,
              },
              { _id: false, strict: "throw" },
            ),
            default: null,
          },
          reopen_review_id: ref,
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    // MA-02 §7: small current projection/pointer of the accepted Move assessment artifact.
    // Additive; null until an assessment publishes. Full inventory lives on the artifact.
    // Applicability (closed work, CRM disposition) is derived on read, never stored here.
    move_assessment: {
      type: new Schema(
        {
          artifact_id: oid,
          status: enumeration(["ready", "insufficient_evidence", "ambiguous_subject", "not_applicable", "failed", "purged"]),
          transaction_intent: { type: Number, default: null, min: 0, max: 100 },
          move_likelihood: { type: Number, default: null, min: 0, max: 100 },
          transaction_intent_confidence: { type: String, enum: ["low", "medium", "high", null], default: null },
          move_likelihood_confidence: { type: String, enum: ["low", "medium", "high", null], default: null },
          context_as_of: at,
          latest_conversation_at: date,
          input_fingerprint: str,
          schema_version: str,
          stale: { type: Boolean, required: true, default: false },
          stale_reason: text,
          published_at: at,
          /** Data spec §2.2: `artifact.conflicts[].affects`, deduped; written with the projection. */
          conflict_targets: { type: [String], default: [] },
          /** Outreach revision the publication was fenced against (closure/disposition race guard). */
          eligibility_revision: count,
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    revision,
    policy_version: str,
  },
  { collection: "outreach_records" },
);
export const getOutreachRecordModel = defineCsiModel(
  "OutreachRecord",
  OutreachRecordSchema,
  OUTREACH_RECORD_INDEXES,
);
export const OUTREACH_FOLLOWUP_INDEXES = [
  unique("followup_commitment_unique", { commitment_key: 1 }),
  index("followup_outreach_due", {
    outreach_record_id: 1,
    status: 1,
    due_at: 1,
  }),
  index("followup_agent_due", {
    responsible_agent_id: 1,
    status: 1,
    due_at: 1,
  }),
  index("followup_due", { status: 1, due_at: 1 }),
  unique(
    "followup_open_missed_episode_unique",
    { outreach_record_id: 1, missed_episode_key: 1 },
    { status: "open", missed_episode_key: { $type: "string" } },
  ),
];
export const OutreachFollowupSchema = new Schema(
  {
    outreach_record_id: oid,
    commitment_key: str,
    kind: enumeration(CSI_ACTION_KINDS),
    description: str,
    status: enumeration(
      ["open", "completed", "cancelled", "superseded"],
      "open",
    ),
    due_at: date,
    date_text: text,
    date_resolution: { type: dateResolution, default: null },
    base_attention_due_at: date,
    attention_due_at: date,
    snoozed_until: date,
    wait_expired_at: date,
    missed_episode_key: text,
    trigger_interaction_ids: refs,
    first_missed_at: date,
    responsible_agent_id: ref,
    assignment: { type: assignment, default: null },
    promised_by_agent_id: ref,
    requested_by: {
      type: String,
      enum: ["rep", "customer", "owner", "unknown", null],
      default: null,
    },
    origin: enumeration([
      "owner",
      "rep_promise",
      "customer_request",
      "customer_wait",
      "system_default",
    ]),
    source_finding_ids: refs,
    // CSI-06: immutable commitment origin, separate from the later completion evidence.
    source_interaction_id: { ...ref, immutable: true },
    source_due_at: { ...date, immutable: true },
    origin_run_id: ref,
    owner_instruction_ids: refs,
    disposition: {
      type: String,
      enum: [
        "no_answer",
        "left_voicemail",
        "spoke_with_customer",
        "connected_contact_unknown",
        "completed",
        "customer_called",
        null,
      ],
      default: null,
    },
    completion_basis: {
      type: String,
      enum: [
        "owner",
        "call_attempt",
        "customer_confirmation",
        "rep_confirmation",
        "vantage_evidence",
        null,
      ],
      default: null,
    },
    completed_at: date,
    completed_by: text,
    evidence_interaction_id: ref,
    completion_finding_id: ref,
    supersedes_id: ref,
    cancel_reason: text,
    // Team 4 AC4 (spec §6 rule 4): a `system_default` retry successor of a promised callback.
    // No default, so rows written without the flag stay byte-identical.
    promise_chain: {
      type: new Schema(
        {
          root_id: oid,
          root_origin: enumeration(["rep_promise", "customer_request", "owner"]),
          attempt: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
        },
        { _id: false, strict: "throw" },
      ),
    },
    // Team 4 AC5-PROGRESS (spec §7.1): a server default next step, superseded by any specific plan.
    default_kind: { type: String, enum: ["quote_followup"] },
    revision,
  },
  { collection: "outreach_followups" },
);
export const getOutreachFollowupModel = defineCsiModel(
  "OutreachFollowup",
  OutreachFollowupSchema,
  OUTREACH_FOLLOWUP_INDEXES,
);
