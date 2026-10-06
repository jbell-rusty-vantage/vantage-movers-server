import { Schema } from "mongoose";
import { z } from "zod";
import {
  SALES_OUTREACH_CADENCE_EXPOSURES,
  SALES_OUTREACH_CHANNEL_STATUSES,
  SALES_OUTREACH_GOAL_COUNT_SCOPES,
  SALES_OUTREACH_GOAL_STATES,
  SALES_OUTREACH_SUBJECT_STATUSES,
  SALES_OUTREACH_WORKFLOWS,
} from "../../config/domain/salesOutreach";
import { at, count, date, defineCsiModel, enumeration, index, oid, ref, revision, str, text, unique, validatedJson } from "../salesIntelligence/common";

const nullableCount = { type: Number, default: null, min: 0, validate: (v: unknown) => v === null || Number.isSafeInteger(v) } as const;
const jsonOrNull = {
  type: Schema.Types.Mixed,
  default: null,
  validate: {
    validator: (v: unknown) => v === null || z.json().safeParse(v).success,
    message: "Invalid sales outreach structured value",
  },
} as const;

/** One channel's current requirement (CONTRACTS "Common read data"). A pending count is null, never zero. */
const channelSchema = new Schema(
  {
    required: nullableCount,
    verified_completed: nullableCount,
    remaining: nullableCount,
    due_at: date,
    oldest_actionable_due_at: date,
    status: enumeration(SALES_OUTREACH_CHANNEL_STATUSES, "not_required"),
    completion_kind: text,
    /** `{ state, known_complete_through, gaps[] }` as computed from capture coverage. */
    coverage: jsonOrNull,
    blocked_reason: text,
  },
  { _id: false, strict: "throw" },
);

const statusFlagsSchema = new Schema(
  {
    needs_contact: { type: Boolean, required: true, default: false },
    overdue: { type: Boolean, required: true, default: false },
    blocked: { type: Boolean, required: true, default: false },
    pending: { type: Boolean, required: true, default: false },
    move_date_passed: { type: Boolean, required: true, default: false },
    move_date_unknown: { type: Boolean, required: true, default: false },
    job_pending: { type: Boolean, required: true, default: false },
    advisory_cooldown: { type: Boolean, required: true, default: false },
  },
  { _id: false, strict: "throw" },
);

/**
 * `sales_outreach_projections` — the evaluator's current output per subject (IMPLEMENTATION-PLAN
 * §4.5). Written only when `input_fingerprint` changes; time-derived status is resolved at read
 * time, so countdown ticks never rewrite rows. Every queue sort has an index before paging.
 */
export const SALES_OUTREACH_PROJECTION_INDEXES = [
  unique("sod_projection_subject_unique", { subject_id: 1 }),
  // Queue sorts (CONTRACTS "Queue sort enums") over never-null `queue_keys`, so null ordering is never
  // left to the database: one index per sort for an assigned scope (Rep, rep filter, Unassigned) and
  // the team default (Most overdue + Needs contact) across every rep.
  index("sod_projection_q_urgency", {
    assigned_agent_id: 1,
    "status_flags.needs_contact": 1,
    "queue_keys.urgency_due": 1,
    "queue_keys.urgency_next": 1,
    "queue_keys.received_asc": 1,
    subject_id: 1,
  }),
  index("sod_projection_q_team_urgency", {
    "status_flags.needs_contact": 1,
    "queue_keys.urgency_due": 1,
    "queue_keys.urgency_next": 1,
    "queue_keys.received_asc": 1,
    subject_id: 1,
  }),
  index("sod_projection_q_received_asc", { assigned_agent_id: 1, "queue_keys.received_asc": 1, subject_id: 1 }),
  index("sod_projection_q_received_desc", { assigned_agent_id: 1, "queue_keys.received_desc": 1, subject_id: 1 }),
  index("sod_projection_q_interaction", { assigned_agent_id: 1, "queue_keys.last_interaction": 1, subject_id: 1 }),
  index("sod_projection_next_evaluation", { next_evaluation_at: 1 }),
];

/** Subject facts the queue filters and searches on, copied from the subject at the projection's write. */
const projectionDisplaySchema = new Schema(
  {
    job_no: text,
    normalized_job_no: text,
    phone: text,
    normalized_phone: text,
    name: text,
    /** Lower-cased NFKC name for case-insensitive literal substring search. */
    name_folded: text,
    /** Canonical move date `YYYY-MM-DD`, or null when unknown (P05g). */
    move_date: text,
  },
  { _id: false, strict: "throw" },
);

/**
 * Never-null queue sort keys (sentinels replace unknowns). Time-derived status is resolved at read
 * time; these keys keep ordering correct without a rewrite as deadlines pass, because an overdue
 * deadline is always earlier than an upcoming one.
 */
const queueKeysSchema = new Schema(
  {
    /** Earliest unsatisfied actionable deadline across unblocked channels (overdue or due); far future when none. */
    urgency_due: at,
    /** Next future scheduled action due; far future when none. */
    urgency_next: at,
    /** The Call channel's earliest unsatisfied actionable deadline (team "quoted overdue call" card). */
    call_due: at,
    /** Received instant; unknown sorts last ascending (far future). */
    received_asc: at,
    /** Received instant; unknown sorts last descending (epoch). */
    received_desc: at,
    /** Last interaction; never contacted = epoch (first ascending, last descending). */
    last_interaction: at,
  },
  { _id: false, strict: "throw" },
);

export const SalesOutreachProjectionSchema = new Schema(
  {
    subject_id: oid,
    period_id: ref,
    call: { type: channelSchema, required: true, default: () => ({}) },
    sms: { type: channelSchema, required: true, default: () => ({}) },
    oldest_actionable_due_at: date,
    next_action_due_at: date,
    next_evaluation_at: date,
    last_interaction_at: date,
    received_at: date,
    assigned_agent_id: ref,
    /** The subject's status at the write; the queue lists `active` and `review` rows, never `closed`. */
    subject_status: enumeration(SALES_OUTREACH_SUBJECT_STATUSES, "active"),
    display: { type: projectionDisplaySchema, required: true, default: () => ({}) },
    queue_keys: { type: queueKeysSchema, required: true },
    workflow: { type: String, enum: [...SALES_OUTREACH_WORKFLOWS], default: null },
    priority_raw: text,
    status_flags: { type: statusFlagsSchema, required: true, default: () => ({}) },
    /** Last 30 business dates of window outcomes; older dates are folded into `window_history_summary`. */
    window_history: { ...validatedJson(z.array(z.json()).max(30)), default: () => [] },
    window_history_summary: jsonOrNull,
    /**
     * Bounded engine detail the queue row does not index (subject state, schedule day, initial response,
     * callback, Quoted basis, advisory cooldown, catch-up, every engine flag, blocked-until per channel).
     */
    detail: jsonOrNull,
    /** `shadow` rows hold the full computation; reads must not expose overdue/missed labels from them. */
    exposure: enumeration(SALES_OUTREACH_CADENCE_EXPOSURES),
    engine_version: str,
    /** Engine `input_fingerprint` (inputs + policy version) at the last write. */
    input_fingerprint: str,
    /** Hash of the engine result fingerprint, the resolved policy and the exposure: equal ⇒ no write. */
    result_fingerprint: str,
    /** Hash of the resolved engine policy + exposure; the evaluation reconcile re-evaluates rows that differ. */
    policy_fingerprint: str,
    configuration_version: str,
    computed_as_of: at,
    publication_revision: count,
    revision,
  },
  { collection: "sales_outreach_projections" },
);

export const getSalesOutreachProjectionModel = defineCsiModel(
  "SalesOutreachProjection",
  SalesOutreachProjectionSchema,
  SALES_OUTREACH_PROJECTION_INDEXES,
);

const goalSnapshotSchema = new Schema(
  {
    roster_version: text,
    configuration_version: text,
    /** The rep's effective goal that day after schedule/override; null when not on the roster. */
    goal: { type: Number, default: null, min: 0 },
    scheduled: { type: Boolean, required: true, default: false },
    /** `{ agent_id, business_date, goal, reason }` when an override applied, else null. */
    override: jsonOrNull,
  },
  { _id: false, strict: "throw" },
);

/**
 * `sales_outreach_rep_day_projections` — one rep's outbound-goal day (IMPLEMENTATION-PLAN §4.6,
 * P08a). Recomputed from evidence when dirty, including older days. Calls to numbers with no
 * eligible subject are `unattributed` and excluded from the goal until associated.
 */
export const SALES_OUTREACH_REP_DAY_PROJECTION_INDEXES = [
  unique("sod_rep_day_unique", { agent_id: 1, business_day: 1 }),
  index("sod_rep_day_day", { business_day: 1, agent_id: 1 }),
];

export const SalesOutreachRepDayProjectionSchema = new Schema(
  {
    agent_id: oid,
    business_day: str,
    count_scope: enumeration(SALES_OUTREACH_GOAL_COUNT_SCOPES),
    goal_snapshot: { type: goalSnapshotSchema, required: true, default: () => ({}) },
    actual_confirmed: count,
    actual_awaiting_confirmation: count,
    unattributed: count,
    /**
     * olr C1b: the day counted under each scope (`actual_confirmed` / `actual_awaiting_confirmation` stay
     * the headline under `count_scope`). Absent on a row written before C1b; the read serves them as null.
     */
    actual_confirmed_all: count,
    actual_confirmed_eligible: count,
    actual_awaiting_all: count,
    actual_awaiting_eligible: count,
    remaining: nullableCount,
    /** Goal progress in [0, 1] (capped); null without a positive goal. */
    progress: { type: Number, default: null, min: 0, max: 1 },
    goal_state: enumeration(SALES_OUTREACH_GOAL_STATES),
    coverage: jsonOrNull,
    input_fingerprint: str,
    computed_as_of: at,
    publication_revision: count,
    revision,
  },
  { collection: "sales_outreach_rep_day_projections" },
);

export const getSalesOutreachRepDayProjectionModel = defineCsiModel(
  "SalesOutreachRepDayProjection",
  SalesOutreachRepDayProjectionSchema,
  SALES_OUTREACH_REP_DAY_PROJECTION_INDEXES,
);
