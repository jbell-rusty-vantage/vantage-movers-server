/**
 * Sales Outreach Desk (sod-v1) vocabularies shared by the desk models, services and routes.
 *
 * These are value sets, not policy. Every business value (quotas, deadlines, roster, goals,
 * controls) lives in the persisted `sales_outreach_configuration`; nothing here activates behaviour.
 * See docs/sales-outreach-desk/IMPLEMENTATION-PLAN.md §4–§6 and CONTRACTS.md.
 */

export const SALES_OUTREACH_CONTRACT_VERSION = "sod-v1" as const;
export const SALES_OUTREACH_TIMEZONE = "America/New_York" as const;

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
export const SALES_OUTREACH_TIME_BASES = [
  "accepted_observation_captured_at",
  "entity_change_applied_at",
  "activation_boundary",
] as const;

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
