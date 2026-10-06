/**
 * Sales Outreach Desk — cadence engine input/output contract (SRV-4, lane S2).
 *
 * The engine is pure: `evaluateSubject(input, policy, as_of)` never reads the clock, Mongo, env or a
 * provider. Callers (S1 `outreach_evaluate`, S3 contact-event derivation) load facts, convert them to
 * these shapes and persist the result. All instants are UTC ISO-8601 strings; all business dates are
 * `YYYY-MM-DD` interpreted in the policy timezone (America/New_York in the approved policy).
 *
 * Business rules: SPECIFICATION §§9–13, FINAL-POLICY-REVIEW, contracts/fixtures (P01–P10a).
 * Collections these map to: IMPLEMENTATION-PLAN §4 (`sales_outreach_policy_periods`,
 * `sales_outreach_followup_schedules`, `sales_outreach_contact_events`, `sales_outreach_projections`).
 */

/**
 * Engine version. The evaluation policy fingerprint carries it, so a bump re-evaluates every projection
 * once through the minute policy reconcile. v2 (olr A1): `coverage_wait`, the coverage-unverified `due`
 * ladder (SPEC §10.3) and the seeded spacing anchor (A6).
 */
export const OUTREACH_ENGINE_VERSION = "sod-engine-v2" as const;

/** UTC instant, ISO-8601 (`2026-10-04T14:00:00.000Z`). */
export type IsoInstant = string;
/** Business date `YYYY-MM-DD` in the policy timezone. */
export type BusinessDate = string;

export type Channel = "call" | "sms";

/* -------------------------------------------------------------------------------------------------
 * Inputs
 * -----------------------------------------------------------------------------------------------*/

/**
 * Routine workflow of a policy period (IMPLEMENTATION-PLAN §4.2, priority map §6.3).
 * `discretion` = accepted Priority 3 (No routine cadence); `none` = accepted unmapped code
 * (No policy configured); `closed` = Priority 5/7/8, official Booking or another authoritative closure.
 */
export type OutreachWorkflow = "new" | "quoted" | "discretion" | "none" | "closed";

/**
 * How the period started, which selects the start-date rules:
 * - `intake`: a fresh Lead arrival (P02d initial response + P02g/P02h arrival allowances from `received_at`);
 * - `transition`: an accepted priority change on an enrolled subject (P05f reentry, P04d Quoted default);
 * - `activation`: the fixed cohort activation boundary of an existing Lead (P10a prospective cutover),
 *   or the late first period of an enrolled subject whose policy became decidable after enrollment
 *   (olr B1: a review subject whose priority was accepted later; a P05f-style partial start).
 */
export type PeriodStartKind = "intake" | "transition" | "activation";

export interface EnginePolicyPeriod {
  period_id: string;
  workflow: OutreachWorkflow;
  /** Accepted raw Granot priority (`"0"`, `"1"`, `"42"`…) or null for an intake default. Display only. */
  priority_raw: string | null;
  start_kind: PeriodStartKind;
  started_at: IsoInstant;
  /** Null for the active period. */
  ended_at: IsoInstant | null;
}

export interface EngineSubjectFacts {
  subject_id: string;
  /** `review` = no known policy/age/identity (no guessed cadence). `closed` = authoritative closure. */
  status: "active" | "closed" | "review";
  /** When `status` is `closed`: the closure instant, if known (closure also arrives as a `closed` period). */
  closed_at: IsoInstant | null;
  /** Normalized Lead arrival instant (restored `leadInstant` adapter). Null = age unknown → review. */
  received_at: IsoInstant | null;
  /** Canonical move date (display/review only, P05g). */
  move_date: BusinessDate | null;
  /** P05e: last accepted priority update was missing/malformed/unverified; the verified policy is retained. */
  priority_uncertain: boolean;
  /** Fixed enrollment boundary (P10a cohort activation or intake admission). No obligation is due before it. */
  activation_at: IsoInstant;
  /**
   * P07g: the contact event of the verified reviewed-rep answered inbound call that created this Call Lead.
   * It satisfies the initial response and may satisfy one arrival-date ordinary call.
   */
  originating_contact_event_id: string | null;
}

/** P04: one Quoted follow-up date command. Period-scoped: a priority change invalidates it. */
export interface EngineQuotedDatePlan {
  kind: "quoted_date";
  plan_id: string;
  period_id: string;
  selected_date: BusinessDate;
  /** Command effective time. */
  effective_at: IsoInstant;
  /** When an explicit command replaced/cancelled it; null while it is the active plan. */
  ended_at: IsoInstant | null;
  end_reason: "replaced" | "cancelled" | null;
  revision: number;
}

/** P06e: an explicit timed callback. Subject-scoped: survives nonterminal priority changes (P06f). */
export interface EngineCallbackPlan {
  kind: "callback";
  plan_id: string;
  period_id: string;
  appointment_at: IsoInstant;
  effective_at: IsoInstant;
  ended_at: IsoInstant | null;
  end_reason: "replaced" | "cancelled" | null;
  revision: number;
}

export type EngineHumanPlan = EngineQuotedDatePlan | EngineCallbackPlan;

/** P06c: a genuine contact restriction interval (`sales_intelligence_contact_restrictions`, text → sms). */
export interface EngineRestrictionInterval {
  restriction_id: string;
  channels: Channel[];
  effective_at: IsoInstant;
  /** Null = still active with no release time. */
  released_at: IsoInstant | null;
  reason: string | null;
}

/** P06d: assignment history from `entity_changes` on `receiver_agent`. Null agent = Unassigned. */
export interface EngineAssignmentInterval {
  agent_id: string | null;
  from: IsoInstant;
  to: IsoInstant | null;
}

export type ContactEventKind =
  | "outbound_attempt"
  | "inbound_answered"
  | "inbound_missed"
  | "sms_sent"
  | "sms_failed"
  | "sms_inbound"
  | "other";

export type ContactVerification =
  | "confirmed"
  | "awaiting_confirmation"
  | "pending_identity"
  | "pending_association"
  | "excluded";

/**
 * One normalized evidence reference (`sales_outreach_contact_events`, IMPLEMENTATION-PLAN §4.4).
 * S3 derives it from `call_interactions` / `ringcentral_rep_sms_evidence` with `classifyCallEvidence` /
 * `classifySmsEvidence` (engine/credit.ts).
 */
export interface EngineContactEvent {
  /** `${source_kind}:${source_id}` — the canonical event identity. */
  event_id: string;
  source_kind: "call" | "sms";
  source_id: string;
  channel: Channel;
  direction: "outbound" | "inbound";
  /** P07g: outbound start / reviewed-rep inbound handling / confirmed SMS sent time. */
  event_at: IsoInstant;
  kind: ContactEventKind;
  verification: ContactVerification;
  exclusion_reason: string | null;
  /** Reviewed initiator / handler / sender at contact time. */
  actor_agent_id: string | null;
  /** Outbound initiator only (P07b); null otherwise. */
  goal_agent_id: string | null;
  /** P06b: whether the customer was reached. Only `unanswered` counts toward the advisory warning. */
  outcome: "answered" | "unanswered" | "unknown";
  /** P07g: contact made while a restriction covered this channel (zero cadence and goal credit). */
  restricted_at_contact: boolean;
}

/**
 * Capture coverage per channel (RINGCENTRAL-CAPTURE §8). `complete_through` must already include the
 * settlement allowance and, for calls, the contact-event derivation watermark (`evidence/coverage.ts`
 * `cadenceCallCoverage`). A deadline after `complete_through` is never `missed`: its obligation is
 * `pending`; the channel reads `due` (not yet verified) while it has coverage, `pending` without any.
 * Null = no coverage (e.g. SMS not connected).
 */
export interface EngineCoverage {
  call: { complete_through: IsoInstant | null };
  sms: { complete_through: IsoInstant | null };
}

export interface EvaluateSubjectInput {
  subject: EngineSubjectFacts;
  /** All periods of the subject, any order (sorted by `started_at` internally). */
  periods: EnginePolicyPeriod[];
  /** Every human plan with its command lifecycle (active and historical). */
  human_plans: EngineHumanPlan[];
  restrictions: EngineRestrictionInterval[];
  assignments: EngineAssignmentInterval[];
  contact_events: EngineContactEvent[];
  coverage: EngineCoverage;
}

/* -------------------------------------------------------------------------------------------------
 * Resolved policy (from the persisted `cadence` namespace, see engine/policy.ts)
 * -----------------------------------------------------------------------------------------------*/

export type Weekday = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export interface EngineCalendarPolicy {
  timezone: string;
  working_weekdays: Weekday[];
  /** Minute of local day, inclusive. */
  opening_minute: number;
  /** Minute of local day, exclusive (also the routine closing deadline). */
  closing_minute: number;
  /** Explicit Owner closures (P02i). No automatic holidays. */
  closed_dates: BusinessDate[];
}

export interface EngineNewCallBand {
  first_day: number;
  /** Null = open-ended. */
  last_day: number | null;
  /** One required call per entry, each due by that local minute (P02f: `[720, 1200]`, `[1200]`). */
  deadline_minutes: number[];
  /** Calls beyond the requirement that never create misses (P01: one optional third on Days 1–3). */
  optional_extra_calls: number;
}

export interface EngineDayAllowance {
  /** Arrival/return strictly before this minute: up to two calls. */
  two_calls_before_minute: number;
  /** Arrival/return at or before this minute (inclusive): up to one call. Later: zero. */
  one_call_through_minute: number;
  /** SMS owed on that date only when arrival/return is at or before this minute (inclusive). */
  sms_through_minute: number;
}

export interface EnginePolicy {
  policy_version: string;
  approval_ref: string;
  calendar: EngineCalendarPolicy;
  new_cadence: {
    call_bands: EngineNewCallBand[];
    spacing_minutes: number;
    sms_initial_days: number[];
    sms_later_first_day: number;
    sms_later_interval_days: number;
    sms_due_minute: number;
  };
  arrival: EngineDayAllowance & { initial_response_working_minutes: number };
  reentry: EngineDayAllowance;
  quoted: {
    due_minute: number;
    same_day_cutoff_minute: number;
    /** P10a: an already-active Quoted schedule owes one activation-date call through this minute. */
    activation_call_through_minute: number;
  };
  callback: { window_minutes: number };
  cooldown: { threshold: number; window_hours: number };
}

/* -------------------------------------------------------------------------------------------------
 * Outputs
 * -----------------------------------------------------------------------------------------------*/

/** One deterministic requirement the engine derived for a date/channel. */
export type ObligationKind = "initial_response" | "ordinary" | "quoted" | "callback";

export type ObligationOutcome =
  /** Not open yet. */
  | "scheduled"
  /** Open, deadline not passed. */
  | "open"
  /** Deadline passed, still fulfillable (same date, initial response or callback). */
  | "overdue"
  /**
   * Deadline passed and the verdict is not provable yet (RINGCENTRAL-CAPTURE §8): coverage does not reach
   * the deadline, or unconfirmed evidence (awaiting confirmation / identity / association) may fulfil it.
   */
  | "pending"
  | "fulfilled"
  /** Fulfilled after the deadline; the deadline miss stays in history. */
  | "fulfilled_late"
  /** Genuine historical miss (window closed unfulfilled). */
  | "missed"
  /** P06c: waived by a contact restriction (no miss). */
  | "waived_restriction"
  /** P06e: suspended by an explicit callback (no miss). */
  | "suspended_callback"
  /** Accepted priority change / Quoted reschedule (no miss, not fulfillment). */
  | "superseded"
  /** Authoritative closure (no miss, not fulfillment). */
  | "cancelled"
  /** P06f: restriction prevented the callback appointment — rescheduling needed (no miss). */
  | "blocked_reschedule"
  /** P10a: past-due legacy callback from before activation — review, no penalty. */
  | "legacy_review";

export interface EngineObligation {
  /** Deterministic id: `${period_id}:${kind}:${channel}:${business_date}:${slot}` (callbacks: plan id). */
  obligation_id: string;
  period_id: string;
  channel: Channel;
  kind: ObligationKind;
  business_date: BusinessDate;
  slot_index: number;
  opens_at: IsoInstant;
  due_at: IsoInstant | null;
  /** End of the crediting window (ordinary: closing). Null = until fulfilled. */
  closes_at: IsoInstant | null;
  outcome: ObligationOutcome;
  fulfilled_by_event_id: string | null;
  fulfilled_at: IsoInstant | null;
  /** True when the deadline passed unfulfilled (`missed`, `fulfilled_late`, overdue, cleared late). */
  deadline_missed: boolean;
  /** P06d: assigned agent at the deadline; null = Unassigned. */
  responsible_agent_id: string | null;
  /** True for a past-due item whose responsible agent differs from the current assignee (P06d). */
  inherited: boolean;
  /** Plan id for quoted/callback obligations. */
  plan_id: string | null;
}

/**
 * `due` also covers a passed deadline that coverage cannot prove yet while the channel has coverage
 * (olr A1.2, SPEC §10.3: the next action stays visible; reads label it "not yet verified"). `pending` =
 * evidence uncertainty: unconfirmed evidence, or a channel with no coverage at all.
 */
export type ChannelStatus = "not_required" | "scheduled" | "due" | "overdue" | "blocked" | "pending" | "completed";
export type CompletionKind = "fulfilled_in_window" | "fulfilled_late" | "waived" | "superseded" | "cancelled" | "evidence_pending";

export interface EngineCatchUp {
  /** P06a: at most one actionable catch-up per channel. */
  outstanding: boolean;
  missed_count: number;
  oldest_missed_due_at: IsoInstant | null;
  state: "actionable" | "blocked" | "suspended" | "pending" | null;
}

/** CONTRACTS "Common read data" channel block, minus read-side coverage decoration. */
export interface EngineChannelRequirement {
  channel: Channel;
  required: number;
  /** Null when the channel has no capture coverage (a pending count is null, never a false zero). */
  verified_completed: number | null;
  remaining: number | null;
  /** Next unmet deadline among today's actionable obligations. */
  due_at: IsoInstant | null;
  oldest_actionable_due_at: IsoInstant | null;
  status: ChannelStatus;
  completion_kind: CompletionKind | null;
  blocked_reason: string | null;
  blocked_until: IsoInstant | null;
  catch_up: EngineCatchUp;
}

export interface EngineStatusFlags {
  needs_contact: boolean;
  overdue: boolean;
  blocked: boolean;
  pending: boolean;
  move_date_passed: boolean;
  move_date_unknown: boolean;
  advisory_cooldown: boolean;
  priority_uncertain: boolean;
  review: boolean;
  callback_blocked_reschedule: boolean;
  inherited_overdue: boolean;
}

export interface EngineWindowChannelSummary {
  required: number;
  completed: number;
  missed: number;
  waived: number;
  superseded: number;
  open: number;
}

export interface EngineWindowHistoryEntry {
  business_date: BusinessDate;
  schedule_day: number | null;
  workflow: OutreachWorkflow | null;
  closed_date: boolean;
  call: EngineWindowChannelSummary;
  sms: EngineWindowChannelSummary;
}

export interface EngineCallbackState {
  plan_id: string;
  appointment_at: IsoInstant;
  due_at: IsoInstant;
  outcome: ObligationOutcome;
  fulfilled_by_event_id: string | null;
}

export interface EngineInitialResponseState {
  due_at: IsoInstant | null;
  outcome: ObligationOutcome;
  fulfilled_at: IsoInstant | null;
}

export interface EngineQuotedState {
  /** The governing selected/default date (preserved even when it is later closed, P04c). */
  selected_date: BusinessDate | null;
  /** First working date on or after `selected_date`. */
  first_required_date: BusinessDate | null;
  basis: "human_selected" | "next_working_date_default" | "activation_active_schedule";
  plan_id: string | null;
}

export interface EngineCooldownState {
  warning: boolean;
  unsuccessful_attempts: Array<{ event_id: string; event_at: IsoInstant }>;
}

export type SubjectEngineState =
  | "active"
  | "closed"
  | "review"
  /** Accepted Priority 3 — "No routine cadence". */
  | "no_routine_cadence"
  /** Accepted unmapped code — "No policy configured" (Owner review). */
  | "no_policy_configured";

export interface EvaluateSubjectResult {
  engine_version: typeof OUTREACH_ENGINE_VERSION;
  policy_version: string;
  subject_id: string;
  computed_as_of: IsoInstant;
  business_date: BusinessDate;
  state: SubjectEngineState;
  workflow: OutreachWorkflow | null;
  period_id: string | null;
  priority_raw: string | null;
  /** New schedule day (received date = Day 1), any workflow; null when age is unknown. */
  schedule_day: number | null;
  requirements: { call: EngineChannelRequirement; sms: EngineChannelRequirement };
  initial_response: EngineInitialResponseState | null;
  callback: EngineCallbackState | null;
  quoted: EngineQuotedState | null;
  cooldown: EngineCooldownState;
  flags: EngineStatusFlags;
  oldest_actionable_due_at: IsoInstant | null;
  next_action_due_at: IsoInstant | null;
  /** Earliest future instant at which the result changes without new input. */
  next_evaluation_at: IsoInstant | null;
  /**
   * Per channel, the earliest deadline of a `pending` obligation that coverage does not reach yet (null
   * when none). The result changes once channel coverage passes it, so the evaluate sweep re-nominates the
   * subject when current coverage >= this instant (olr A1: pull on the watermark, never a timed retry).
   */
  coverage_wait: { call: IsoInstant | null; sms: IsoInstant | null };
  last_interaction_at: IsoInstant | null;
  current_assignee_agent_id: string | null;
  /** Every obligation of the evaluated horizon (history + today + the next scheduled ones). */
  obligations: EngineObligation[];
  /** Last 30 business dates; older dates are summarized in `history_summary`. */
  window_history: EngineWindowHistoryEntry[];
  history_summary: { dates: number; call_missed: number; sms_missed: number };
  /** sha256 of the canonical inputs + policy version (excludes `as_of`). */
  input_fingerprint: string;
  /** sha256 of the result minus `computed_as_of`; persist only when it changed. */
  fingerprint: string;
}
