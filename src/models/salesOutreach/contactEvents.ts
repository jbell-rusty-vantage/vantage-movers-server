import { Schema } from "mongoose";
import {
  SALES_OUTREACH_CONTACT_DIRECTIONS,
  SALES_OUTREACH_CONTACT_KINDS,
  SALES_OUTREACH_CONTACT_SOURCE_KINDS,
  SALES_OUTREACH_VERIFICATION_STATES,
} from "../../config/domain/salesOutreach";
import { at, count, defineCsiModel, enumeration, index, oid, ref, revision, str, text, unique } from "../salesIntelligence/common";

/**
 * `sales_outreach_contact_events` — normalized per-subject evidence derived from canonical capture
 * (IMPLEMENTATION-PLAN §4.4). It references `call_interactions` / `ringcentral_rep_sms_evidence`
 * rows; it never copies calls or messages. One row per (source, subject).
 */
export const SALES_OUTREACH_CONTACT_EVENT_INDEXES = [
  unique("sod_contact_source_unique", { source_kind: 1, source_id: 1, subject_id: 1 }),
  index("sod_contact_subject_event", { subject_id: 1, event_at: 1 }),
  index("sod_contact_goal_day", { goal_agent_id: 1, business_date: 1 }),
];

export const SalesOutreachContactEventSchema = new Schema(
  {
    subject_id: oid,
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
