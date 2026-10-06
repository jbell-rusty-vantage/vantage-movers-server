import { Schema } from "mongoose";
import {
  SALES_OUTREACH_ENROLLMENT_KINDS,
  SALES_OUTREACH_LEAD_MODELS,
  SALES_OUTREACH_PRIORITY_BASES,
  SALES_OUTREACH_RECEIVED_QUALITIES,
  SALES_OUTREACH_SUBJECT_STATUSES,
} from "../../config/domain/salesOutreach";
import { at, count, date, defineCsiModel, enumeration, index, oid, ref, refs, revision, str, strings, text, unique } from "../salesIntelligence/common";

/**
 * `sales_outreach_subjects` — one per enrolled canonical Lead (IMPLEMENTATION-PLAN §4.1, IMPL-04).
 * "Outreach ID" in the specification is this document's `_id`. The Lead stays the system of record;
 * `display` and `priority` are the desk's last-seen copies, refreshed from `entity_changes`.
 */
export const SALES_OUTREACH_SUBJECT_INDEXES = [
  unique("sod_subject_lead_unique", { lead_model: 1, lead_id: 1 }),
  index("sod_subject_status_assignee", { status: 1, assigned_agent_id: 1, _id: 1 }),
  index("sod_subject_job_no", { "display.normalized_job_no": 1 }),
  index("sod_subject_phone", { "display.normalized_phone": 1 }),
  index("sod_subject_lead_revision", { lead_revision_seen: 1 }),
  // Restriction commands wake every subject attached to the restricted number (multikey).
  index("sod_subject_contact_numbers", { contact_number_ids: 1 }),
  // olr B6: `POST /enrollment/verify {cohort_id}` pages a cohort's subjects (`admission:<date>`, `intake:<gate>`) by `_id`.
  index("sod_subject_cohort", { "enrollment.cohort_id": 1, _id: 1 }),
];

const enrollmentSchema = new Schema(
  {
    cohort_id: str,
    kind: enumeration(SALES_OUTREACH_ENROLLMENT_KINDS),
    enrolled_at: at,
    activation_at: at,
    manifest_hash: text,
  },
  { _id: false, strict: "throw" },
);

const displaySchema = new Schema(
  {
    job_no: text,
    normalized_job_no: text,
    phone: text,
    normalized_phone: text,
    name: text,
    /** Canonical move date as recorded (`YYYY-MM-DD`), or null when unknown (P05g). */
    move_date: text,
  },
  { _id: false, strict: "throw" },
);

const prioritySchema = new Schema(
  {
    raw: text,
    accepted_at: date,
    observation_id: ref,
    basis: enumeration(SALES_OUTREACH_PRIORITY_BASES, "none"),
    /** P05e: a newer blank/malformed/unverified priority update was seen; the verified policy is retained. */
    uncertain: { type: Boolean, required: true, default: false },
  },
  { _id: false, strict: "throw" },
);

export const SalesOutreachSubjectSchema = new Schema(
  {
    lead_model: enumeration(SALES_OUTREACH_LEAD_MODELS),
    lead_id: oid,
    enrollment: { type: enrollmentSchema, required: true },
    status: enumeration(SALES_OUTREACH_SUBJECT_STATUSES, "active"),
    review_reasons: strings,
    received_at: date,
    /** New York business date of `received_at` (Day 1, P02a). */
    received_date: text,
    received_quality: enumeration(SALES_OUTREACH_RECEIVED_QUALITIES),
    adapter_version: str,
    display: { type: displaySchema, required: true, default: () => ({}) },
    priority: { type: prioritySchema, required: true, default: () => ({}) },
    assigned_agent_id: ref,
    assignment_revision: count,
    lead_revision_seen: count,
    /**
     * olr B2: fingerprint (sha256 hex) of the priority map + intake defaults this subject was last
     * decided under (`deskDecisionFingerprint`); null before B2's first sync of the subject.
     */
    decision_fingerprint: text,
    contact_number_ids: refs,
    revision,
  },
  { collection: "sales_outreach_subjects" },
);

export const getSalesOutreachSubjectModel = defineCsiModel(
  "SalesOutreachSubject",
  SalesOutreachSubjectSchema,
  SALES_OUTREACH_SUBJECT_INDEXES,
);
