import { Schema } from "mongoose";
import {
  at,
  date,
  defineCsiModel,
  enumeration,
  index,
  revision,
  str,
  text,
  unique,
  validatedJson,
} from "../salesIntelligence/common";
import { z } from "zod";

export const SMS_VOLUME_CONTRIBUTION_INDEXES = [
  unique("sod_sms_volume_logical_unique", { canonical_logical_id: 1 }),
  index("sod_sms_volume_agent_day", { agent_id: 1, business_date: 1 }),
  index("sod_sms_volume_day", { business_date: 1 }),
];
const volumeSchema = new Schema(
  {
    canonical_logical_id: str,
    source_id: str,
    source_revision: revision,
    agent_id: text,
    business_date: str,
    disposition: enumeration(["confirmed", "pending", "excluded"]),
    event_at: at,
    fingerprint: str,
    revision,
  },
  { collection: "sales_outreach_sms_volume_contributions" },
);
export const getSalesOutreachSmsVolumeContributionModel = defineCsiModel(
  "SalesOutreachSmsVolumeContribution",
  volumeSchema,
  SMS_VOLUME_CONTRIBUTION_INDEXES,
);

const obligationSchema = new Schema(
  {
    obligation_id: str,
    period_id: str,
    channel: str,
    kind: str,
    business_date: str,
    slot_index: { type: Number, required: true },
    opens_at: str,
    due_at: text,
    closes_at: text,
    outcome: str,
    fulfilled_by_event_id: text,
    fulfilled_at: text,
    deadline_missed: { type: Boolean, required: true },
    responsible_agent_id: text,
    inherited: { type: Boolean, required: true },
    plan_id: text,
  },
  { _id: false, strict: "throw" },
);
export const SMS_REQUIREMENT_DAY_INDEXES = [
  unique("sod_sms_requirement_subject_day_unique", {
    subject_id: 1,
    business_date: 1,
  }),
  index("sod_sms_requirement_day", { business_date: 1 }),
  index("sod_sms_requirement_responsibility_day", {
    "obligations.responsible_agent_id": 1,
    business_date: 1,
  }),
];
const requirementSchema = new Schema(
  {
    subject_id: str,
    business_date: str,
    input_complete: { type: Boolean, required: true, default: true },
    obligations: { type: [obligationSchema], required: true },
    policy_fingerprint: str,
    input_fingerprint: str,
    engine_version: str,
    coverage_through: date,
    computed_at: at,
    fingerprint: str,
    revision,
  },
  { collection: "sales_outreach_sms_requirement_days" },
);
export const getSalesOutreachSmsRequirementDayModel = defineCsiModel(
  "SalesOutreachSmsRequirementDay",
  requirementSchema,
  SMS_REQUIREMENT_DAY_INDEXES,
);

export const PERFORMANCE_STATE_INDEXES = [
  unique("sod_performance_state_unique", { key: 1 }),
];
const stateSchema = new Schema(
  {
    key: str,
    volume_certified_through: date,
    volume_derived_through: date,
    sms_cursor: text,
    subject_cursor: text,
    sms_exhausted: { type: Boolean, default: false },
    subjects_exhausted: { type: Boolean, default: false },
    volume_reliable_from: text,
    requirements_reliable_from: text,
    full_inventory_completed: { type: Boolean, required: true, default: false },
    reconciled_at: date,
    captured_at: at,
  },
  { collection: "sales_outreach_performance_state" },
);
export const getSalesOutreachPerformanceStateModel = defineCsiModel(
  "SalesOutreachPerformanceState",
  stateSchema,
  PERFORMANCE_STATE_INDEXES,
);

export const PERFORMANCE_POLICY_INDEXES = [
  unique("sod_performance_policy_unique", { policy_fingerprint: 1 }),
];
const policySchema = new Schema(
  { policy_fingerprint: str, policy_snapshot: validatedJson(z.json()) },
  { collection: "sales_outreach_performance_policies" },
);
export const getSalesOutreachPerformancePolicyModel = defineCsiModel(
  "SalesOutreachPerformancePolicy",
  policySchema,
  PERFORMANCE_POLICY_INDEXES,
);
