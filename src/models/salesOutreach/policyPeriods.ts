import { Schema } from "mongoose";
import {
  SALES_OUTREACH_PERIOD_START_KINDS,
  SALES_OUTREACH_TIME_BASES,
  SALES_OUTREACH_WORKFLOWS,
} from "../../config/domain/salesOutreach";
import { at, date, defineCsiModel, enumeration, index, oid, revision, str, text, unique } from "../salesIntelligence/common";

/**
 * `sales_outreach_policy_periods` (CONTRACTS, re-keyed on `subject_id`; IMPLEMENTATION-PLAN §4.2).
 * At most one active period per subject (partial unique on `ended_at: null`); one row per semantic
 * transition (`transition_key`), so a repeated accepted priority is a no-op. Closing the old period
 * and opening the new one happen in one transaction.
 */
export const SALES_OUTREACH_POLICY_PERIOD_INDEXES = [
  unique("sod_period_active_unique", { subject_id: 1 }, { ended_at: null }),
  unique("sod_period_transition_unique", { subject_id: 1, transition_key: 1 }),
  index("sod_period_subject_started", { subject_id: 1, started_at: 1 }),
];

export const SalesOutreachPolicyPeriodSchema = new Schema(
  {
    subject_id: oid,
    transition_key: str,
    /** Configuration version whose cadence policy governs this period. */
    policy_version: str,
    activation_boundary: at,
    workflow: enumeration(SALES_OUTREACH_WORKFLOWS),
    /** Selects the engine's start-date rules (intake arrival, P05f transition, P10a activation). */
    start_kind: enumeration(SALES_OUTREACH_PERIOD_START_KINDS),
    /** Accepted raw Granot priority, or null for an intake default / unknown (P05e). */
    priority: text,
    priority_source_ref: text,
    priority_source_revision: { type: Number, default: null },
    started_at: at,
    ended_at: date,
    end_reason: text,
    time_basis: enumeration(SALES_OUTREACH_TIME_BASES),
    /** New York business date the cadence age counts from (Day 1, P02a); null when unreliable (review). */
    age_anchor: text,
    anchor_quality: text,
    adapter_version: text,
    revision,
  },
  { collection: "sales_outreach_policy_periods" },
);

export const getSalesOutreachPolicyPeriodModel = defineCsiModel(
  "SalesOutreachPolicyPeriod",
  SalesOutreachPolicyPeriodSchema,
  SALES_OUTREACH_POLICY_PERIOD_INDEXES,
);
