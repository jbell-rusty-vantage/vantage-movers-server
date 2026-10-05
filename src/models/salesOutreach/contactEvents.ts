import { Schema } from "mongoose";
import {
  SALES_OUTREACH_CONTACT_DIRECTIONS,
  SALES_OUTREACH_CONTACT_KINDS,
  SALES_OUTREACH_CONTACT_SOURCE_KINDS,
  SALES_OUTREACH_VERIFICATION_STATES,
  SALES_OUTREACH_WORKFLOWS,
} from "../../config/domain/salesOutreach";
import {
  SALES_OUTREACH_CONTACT_ASSOCIATIONS,
  SALES_OUTREACH_CONTACT_OUTCOMES,
  SALES_OUTREACH_GOAL_CREDITS,
} from "../../config/domain/salesOutreachContacts";
import { at, count, defineCsiModel, enumeration, index, oid, ref, revision, str, text, unique } from "../salesIntelligence/common";

/**
 * `sales_outreach_contact_events` — normalized per-subject evidence derived from canonical capture
 * (IMPLEMENTATION-PLAN §4.4). It references `call_interactions` / `ringcentral_rep_sms_evidence`
 * rows; it never copies calls or messages. One row per (source, subject).
 *
 * S3 (SRV-6) writes at most one row per source: its `_id` is derived from `(source_kind, source_id)`
 * (`contactEventId`), so concurrent derivations of one source collide instead of duplicating. A source
 * with no unique active subject at contact time keeps a row with `subject_id: null` so the M1
 * all-outbound rep-day count (FAST-TRACK "M1 goal scope") and "Other outbound" stay recountable from
 * this collection alone; subject reads (`{subject_id, event_at}`) never see those rows.
 */
export const SALES_OUTREACH_CONTACT_EVENT_INDEXES = [
  unique("sod_contact_source_unique", { source_kind: 1, source_id: 1, subject_id: 1 }),
  index("sod_contact_subject_event", { subject_id: 1, event_at: 1 }),
  index("sod_contact_goal_day", { goal_agent_id: 1, business_date: 1 }),
];

export const SalesOutreachContactEventSchema = new Schema(
  {
    /** The unique active desk subject at contact time (IMPL-07), else null. */
    subject_id: ref,
    source_kind: enumeration(SALES_OUTREACH_CONTACT_SOURCE_KINDS),
    source_id: oid,
    channel: enumeration(SALES_OUTREACH_CONTACT_SOURCE_KINDS),
    direction: enumeration(SALES_OUTREACH_CONTACT_DIRECTIONS),
    /** P07g: outbound start / inbound reviewed-rep handling / SMS confirmed sent. */
    event_at: at,
    business_date: str,
    actor_agent_id: ref,
    /** Outbound initiator only (P07b); null for inbound and SMS. */
    goal_agent_id: ref,
    kind: enumeration(SALES_OUTREACH_CONTACT_KINDS),
    verification: enumeration(SALES_OUTREACH_VERIFICATION_STATES),
    exclusion_reason: text,
    restricted_at_contact: { type: Boolean, required: true, default: false },
    /** IMPL-07 association of the source's contact number(s) at contact time. */
    association: enumeration(SALES_OUTREACH_CONTACT_ASSOCIATIONS),
    /** Workflow of the subject's policy period active at `event_at` (null without a subject or period). */
    subject_workflow: { type: String, enum: [...SALES_OUTREACH_WORKFLOWS], default: null },
    /** P06b: whether the customer was reached. */
    outcome: enumeration(SALES_OUTREACH_CONTACT_OUTCOMES, "unknown"),
    /** Outbound-goal credit of the source for `goal_agent_id` under the all-outbound scope (P07a/b/g, IMPL-06). */
    goal_credit: enumeration(SALES_OUTREACH_GOAL_CREDITS, "none"),
    /** True when the subject was an eligible New/Quoted subject at contact time (the M2 goal scope, P07a). */
    goal_scope_eligible: { type: Boolean, required: true, default: false },
    /** Hash of the derived fields; an identical re-derivation writes nothing. */
    input_fingerprint: str,
    source_revision: count,
    revision,
  },
  { collection: "sales_outreach_contact_events" },
);

export const getSalesOutreachContactEventModel = defineCsiModel(
  "SalesOutreachContactEvent",
  SalesOutreachContactEventSchema,
  SALES_OUTREACH_CONTACT_EVENT_INDEXES,
);
