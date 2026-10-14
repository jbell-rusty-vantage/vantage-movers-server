import { Schema } from "mongoose";
import { SALES_OUTREACH_LEAD_MODELS } from "../../config/domain/salesOutreach";
import { at, date, defineCsiModel, enumeration, index, oid, ref, revision, str, text, unique } from "../salesIntelligence/common";

/** Shared work is a projection of an accepted canonical Lead, never another Lead/admission authority. */
export const SALES_OUTREACH_POOL_WORK_INDEXES = [
  unique("sod_pool_lead_unique", { lead_model: 1, lead_id: 1 }),
  unique("sod_pool_subject_unique", { subject_id: 1 }),
  index("sod_pool_active", { active: 1, subject_id: 1 }),
];
const episode = new Schema({ started_at: at, ended_at: date, observation_id: oid }, { _id: false, strict: "throw" });
export const SalesOutreachPoolWorkSchema = new Schema({
  lead_model: enumeration(SALES_OUTREACH_LEAD_MODELS), lead_id: oid, subject_id: oid,
  active: { type: Boolean, required: true }, episodes: { type: [episode], required: true },
  policy_version: str, approval_ref: str, accepted_observation_id: oid,
  lead_revision_seen: { type: Number, required: true }, exit_reason: text, revision,
}, { collection: "sales_outreach_pool_work" });
export const getSalesOutreachPoolWorkModel = defineCsiModel("SalesOutreachPoolWork", SalesOutreachPoolWorkSchema, SALES_OUTREACH_POOL_WORK_INDEXES);

/** Episode, assignee and policy are provenance, deliberately absent from the unique quota key. */
export const SALES_OUTREACH_POOL_DUTY_INDEXES = [
  unique("sod_pool_duty_lead_date_kind_unique", { lead_model: 1, lead_id: 1, business_date: 1, kind: 1 }),
  index("sod_pool_duty_subject_date", { subject_id: 1, business_date: 1 }),
];
export const SalesOutreachPoolDutySchema = new Schema({
  lead_model: enumeration(SALES_OUTREACH_LEAD_MODELS), lead_id: oid, subject_id: oid,
  business_date: str, kind: enumeration(["pool_call"] as const), due_at: at,
  state: enumeration(["open", "completed", "waived"] as const),
  completion_event_id: ref, completed_at: date, completed_by_agent_id: ref,
  policy_version: str, revision,
  calendar_snapshot: { type: new Schema({ open_minute: { type: Number, required: true }, close_minute: { type: Number, required: true }, closed_date: { type: Boolean, required: true } }, { _id: false, strict: "throw" }), required: true },
  pending_evidence: { type: Boolean, required: true, default: false },
  /** Every winner change retains the previous result, including revoked/corrected evidence. */
  corrections: { type: [new Schema({ changed_at: at, event_id: ref, caller_id: ref, event_at: date }, { _id: false, strict: "throw" })], default: [] },
}, { collection: "sales_outreach_pool_duties" });
export const getSalesOutreachPoolDutyModel = defineCsiModel("SalesOutreachPoolDuty", SalesOutreachPoolDutySchema, SALES_OUTREACH_POOL_DUTY_INDEXES);
