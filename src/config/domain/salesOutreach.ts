/**
 * Sales Outreach Desk (sod-v1) vocabularies shared by the desk models, services and routes.
 *
 * These are value sets, not policy. Every business value (quotas, deadlines, roster, goals,
 * controls) lives in the persisted `sales_outreach_configuration`; nothing here activates behaviour.
 * See docs/sales-outreach-desk/IMPLEMENTATION-PLAN.md §4–§6 and CONTRACTS.md.
 */

export const SALES_OUTREACH_CONTRACT_VERSION = "sod-v1" as const;
export const SALES_OUTREACH_TIMEZONE = "America/New_York" as const;

/**
 * Code defaults for the optional capture/drain tunables in `sales_outreach_configuration`
 * (`evidence.*_minutes`, `operations.evaluate_drain_*`), in the configured units. They equal the
 * values the code used before the keys existed, so an absent key changes nothing. Read them only
 * through `deskTimingOf` (`services/salesOutreach/config/timing.ts`).
 */
export const DESK_TIMING_DEFAULTS = {
  call_settlement_allowance_minutes: 2,
  today_coverage_tolerance_minutes: 25,
  capture_freshness_tolerance_minutes: 10,
  webhook_silence_minutes: 30,
  evaluate_drain_max_jobs: 100,
  evaluate_drain_budget_seconds: 40,
  evaluate_drain_concurrency: 1,
} as const;

/** The Call Log reconcile's finalization lag (`numberActivity/reconcileCallLog.ts` `finalizationLagMinutes`). */
export const CALL_CAPTURE_FINALIZATION_LAG_MINUTES = 15;

/** Canonical Lead models a desk subject can point at (IMPL-04). */
export const SALES_OUTREACH_LEAD_MODELS = ["FormLead", "CallLead"] as const;
export type SalesOutreachLeadModel = (typeof SALES_OUTREACH_LEAD_MODELS)[number];

export const SALES_OUTREACH_SUBJECT_STATUSES = ["active", "closed", "review"] as const;
export const SALES_OUTREACH_ENROLLMENT_KINDS = ["pilot", "intake", "expansion"] as const;
/** How the subject's received instant was read through the restored `leadInstant` adapter. */
export const SALES_OUTREACH_RECEIVED_QUALITIES = ["instant", "wall_clock", "missing", "unreliable"] as const;
/** Where the subject's current priority came from (P05e keeps intake defaults apart from accepted Granot facts). */
export const SALES_OUTREACH_PRIORITY_BASES = ["accepted_observation", "intake_default", "none"] as const;

/** Policy-period workflow (IMPLEMENTATION-PLAN §4.2). */
export const SALES_OUTREACH_WORKFLOWS = ["new", "quoted", "discretion", "none", "closed"] as const;
export type SalesOutreachWorkflow = (typeof SALES_OUTREACH_WORKFLOWS)[number];
/**
 * How a policy period started (engine `PeriodStartKind`): `intake` = a fresh Lead arrival (P05e),
 * `transition` = an accepted priority change or closure on an enrolled subject (P05d/P05f),
 * `activation` = the fixed cohort activation boundary of an existing Lead (P10a), or the late first
 * period of an enrolled subject whose policy became decidable after enrollment (olr B1).
 */
export const SALES_OUTREACH_PERIOD_START_KINDS = ["intake", "transition", "activation"] as const;
export type SalesOutreachPeriodStartKind = (typeof SALES_OUTREACH_PERIOD_START_KINDS)[number];
/**
 * Which instant a period's `started_at` is (internal; no read DTO serves it):
 * - `desk_decision_at`: a late first period opened when an admission hold cleared, so no fact time
 *   exists; it starts at the sync instant (olr B1/B8);
 * - `configuration_activated_at`: opened because a configuration change made the policy decidable (olr B2).
 */
export const SALES_OUTREACH_TIME_BASES = [
  "accepted_observation_captured_at",
  "entity_change_applied_at",
  "activation_boundary",
  "desk_decision_at",
  "configuration_activated_at",
] as const;
export type SalesOutreachTimeBasis = (typeof SALES_OUTREACH_TIME_BASES)[number];

export const SALES_OUTREACH_FOLLOWUP_KINDS = ["quoted_date", "callback"] as const;
export const SALES_OUTREACH_FOLLOWUP_STATUSES = [
  "active",
  "fulfilled",
  "missed",
  "cancelled",
  "replaced",
  "blocked_reschedule",
] as const;

export const SALES_OUTREACH_CONTACT_SOURCE_KINDS = ["call", "sms"] as const;
export const SALES_OUTREACH_CONTACT_DIRECTIONS = ["inbound", "outbound"] as const;
export const SALES_OUTREACH_CONTACT_KINDS = [
  "outbound_attempt",
  "inbound_answered",
  "inbound_missed",
  "sms_sent",
  "sms_failed",
  "sms_inbound",
  "other",
] as const;
export const SALES_OUTREACH_VERIFICATION_STATES = [
  "confirmed",
  "awaiting_confirmation",
  "pending_identity",
  "pending_association",
  "excluded",
] as const;

/** Channel requirement status in the common read data (CONTRACTS "Common read data"). */
export const SALES_OUTREACH_CHANNEL_STATUSES = [
  "not_required",
  "scheduled",
  "due",
  "overdue",
  "blocked",
  "pending",
  "completed",
] as const;
export const SALES_OUTREACH_STATUS_FLAGS = [
  "needs_contact",
  "overdue",
  "blocked",
  "pending",
  "move_date_passed",
  "move_date_unknown",
  "job_pending",
  "advisory_cooldown",
] as const;

export const SALES_OUTREACH_GOAL_STATES = ["goal", "no_goal_today", "not_on_roster"] as const;
/**
 * FAST-01 M1 counts every verified outbound external attempt by a reviewed rep; once M2 enrollment
 * lands the goal narrows to eligible New/Quoted subjects. The row records which scope it counted so
 * one scope is never presented as the other.
 */
export const SALES_OUTREACH_GOAL_COUNT_SCOPES = ["all_outbound", "eligible_new_quoted"] as const;
export type SalesOutreachGoalCountScope = (typeof SALES_OUTREACH_GOAL_COUNT_SCOPES)[number];

/**
 * Who is on the daily-goal roster (P08a-1, Owner decision 2026-10-07 "only active Agents with a
 * RingCentral Account connection"). `explicit`: the configured `goals.rep_work_schedules` list is the
 * roster (the original P08a encoding). `desk_reps`: the roster is derived — every Agent that is
 * `active` and holds a reviewed `sales_rep` identity link at the instant of the read (today) or at the
 * end of a past day; `rep_work_schedules` then only holds per-rep settings (working days, goal) and
 * may name Agents who are not reps yet. Code default when `goals.roster_rule` is absent: `explicit`.
 */
export const SALES_OUTREACH_ROSTER_RULES = ["explicit", "desk_reps"] as const;
export type SalesOutreachRosterRule = (typeof SALES_OUTREACH_ROSTER_RULES)[number];
/** Every ISO weekday: the working days of a desk rep without a configured schedule (same as the installer). */
export const SALES_OUTREACH_ALL_WEEKDAYS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7]);

export const SALES_OUTREACH_ENROLLMENT_MODES = ["report", "apply", "verify"] as const;
export const SALES_OUTREACH_ENROLLMENT_RUN_STATUSES = ["running", "completed", "failed", "paused"] as const;

/** Desk roles (IMPL-03, P09b/P09c). Generic `admin` is not a desk role. */
export const SALES_OUTREACH_ROLES = ["owner", "manager", "rep"] as const;
export type SalesOutreachRole = (typeof SALES_OUTREACH_ROLES)[number];

/** Desk-specific error codes; shared CSI codes (REVISION_CONFLICT, IDEMPOTENCY_CONFLICT, …) keep their CsiError. */
export const SALES_OUTREACH_ERROR_CODES = [
  "FORBIDDEN",
  "REP_NOT_LINKED",
  "INVALID_INPUT",
  "IDEMPOTENCY_KEY_REQUIRED",
  "NOT_FOUND",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "CURSOR_EXPIRED",
  "CONFIGURATION_UNAVAILABLE",
  "PROJECTION_PENDING",
  "SERVICE_UNAVAILABLE",
] as const;
export type SalesOutreachErrorCode = (typeof SALES_OUTREACH_ERROR_CODES)[number];

export const SALES_OUTREACH_API_PREFIX = "/api/v1/admin/sales-outreach" as const;

/**
 * Desk commands registered in the CSI command ledger (`sales_intelligence_command_executions.command`).
 * Each is a distinct, explicit kind; no legacy CSI command name is reused (CONTRACTS "HTTP interface").
 */
export const SALES_OUTREACH_COMMAND_KINDS = {
  configuration_update: "sales_outreach_configuration_update",
  enrollment_apply: "sales_outreach_enrollment_apply",
  quoted_followup: "sales_outreach_quoted_followup",
  callback: "sales_outreach_callback",
  assignment: "sales_outreach_assignment",
  goal_day_override: "sales_outreach_goal_day_override",
  restriction_add: "sales_outreach_restriction_add",
  restriction_confirm: "sales_outreach_restriction_confirm",
  restriction_lift: "sales_outreach_restriction_lift",
} as const;
export type SalesOutreachCommandKind = (typeof SALES_OUTREACH_COMMAND_KINDS)[keyof typeof SALES_OUTREACH_COMMAND_KINDS];

/**
 * How the cadence projection is exposed (IMPLEMENTATION-PLAN §6.2): `shadow` computes the full result but
 * reads must not show enforcement labels (overdue/missed); `enforcement` exposes them. Both controls off =
 * no evaluation at all.
 */
export const SALES_OUTREACH_CADENCE_EXPOSURES = ["shadow", "enforcement"] as const;
export type SalesOutreachCadenceExposure = (typeof SALES_OUTREACH_CADENCE_EXPOSURES)[number];

/** Desk restriction channels (the stored CSI restriction uses `text` for SMS). */
export const SALES_OUTREACH_RESTRICTION_CHANNELS = ["call", "sms"] as const;

/** Queue `state` filter (CONTRACTS "GET /queue"); `needs_contact` is the default. */
export const SALES_OUTREACH_QUEUE_STATES = ["needs_contact", "all_active", "blocked", "pending"] as const;
export type SalesOutreachQueueState = (typeof SALES_OUTREACH_QUEUE_STATES)[number];
/** Queue sorts (CONTRACTS "Queue sort enums"); urgency has a fixed direction. */
export const SALES_OUTREACH_QUEUE_SORTS = ["urgency", "lead_received", "last_interaction"] as const;
export type SalesOutreachQueueSort = (typeof SALES_OUTREACH_QUEUE_SORTS)[number];
/** Every `GET /queue` query parameter; `agent_id`/`unassigned` are Owner/Manager-only filters. */
export const SALES_OUTREACH_QUEUE_FILTERS = [
  "search",
  "priority",
  "workflow",
  "move_date_from",
  "move_date_to",
  "move_date_unknown",
  "agent_id",
  "unassigned",
  "state",
  "sort",
  "direction",
  "cursor",
  "limit",
] as const;

/** Scoped SSE invalidation topics of `GET /live` (IMPLEMENTATION-PLAN §5). */
export const SALES_OUTREACH_LIVE_TOPICS = ["outreach_desk", "outreach_goal", "outreach_configuration"] as const;
export type SalesOutreachLiveTopic = (typeof SALES_OUTREACH_LIVE_TOPICS)[number];
/** Live frame schema versions this server speaks (topic schema/version negotiation, CONTRACTS "SSE"). */
export const SALES_OUTREACH_LIVE_VERSIONS = [1] as const;
