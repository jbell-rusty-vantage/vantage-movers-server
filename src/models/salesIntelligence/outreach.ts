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
    closure_origin: {
      type: String,
      enum: ["owner", "official", null],
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
    revision,
  },
  { collection: "outreach_followups" },
);
export const getOutreachFollowupModel = defineCsiModel(
  "OutreachFollowup",
  OutreachFollowupSchema,
  OUTREACH_FOLLOWUP_INDEXES,
);
