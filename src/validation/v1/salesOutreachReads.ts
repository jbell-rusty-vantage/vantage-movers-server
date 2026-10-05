import { z } from "zod";
import {
  SALES_OUTREACH_CONTRACT_VERSION,
  SALES_OUTREACH_ERROR_CODES,
  SALES_OUTREACH_GOAL_COUNT_SCOPES,
  SALES_OUTREACH_GOAL_STATES,
  SALES_OUTREACH_ROLES,
  SALES_OUTREACH_TIMEZONE,
} from "../../config/domain/salesOutreach";
import { salesOutreachAgentIdSchema, salesOutreachBusinessDateSchema } from "./salesOutreach";

/**
 * Response DTOs for the Sales Outreach Desk M1 reads (`GET /capabilities`, `GET /rep-days`,
 * `GET /team`) — CONTRACTS "HTTP interface" / "Common read data", FAST-TRACK M1. The admin BFF
 * validates the same shapes; example payloads live in
 * `docs/sales-outreach-desk/workspace/evidence/dto-examples/`.
 *
 * Honesty rules encoded here: a count that is not known is `null` with an `unknown_reason`, never 0;
 * parts of the team desk that M1 does not serve are explicit `not_available_in_m1` fields.
 */

const instant = z.iso.datetime();
const nullableInstant = instant.nullable();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const salesOutreachRepDaysQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    business_day: salesOutreachBusinessDateSchema.optional(),
    agent_id: salesOutreachAgentIdSchema.optional(),
  })
  .strict();
export type SalesOutreachRepDaysQuery = z.infer<typeof salesOutreachRepDaysQuerySchema>;

export const salesOutreachTeamQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    business_day: salesOutreachBusinessDateSchema.optional(),
  })
  .strict();
export type SalesOutreachTeamQuery = z.infer<typeof salesOutreachTeamQuerySchema>;

// ---------------------------------------------------------------------------
// Common read data
// ---------------------------------------------------------------------------

export const SALES_OUTREACH_COVERAGE_STATES = ["complete", "partial", "unknown"] as const;
export const SALES_OUTREACH_CAPTURE_FRESHNESS_STATES = ["fresh", "delayed", "not_connected", "unknown"] as const;
export const SALES_OUTREACH_GRANOT_FRESHNESS_STATES = ["observed", "unknown"] as const;
export const SALES_OUTREACH_CONFIGURATION_STATES = ["uninitialized", "active", "unavailable"] as const;

/** Labels the admin shows for each count scope (FAST-TRACK "M1 goal scope"). */
export const SALES_OUTREACH_COUNT_SCOPE_LABELS = {
  all_outbound: "Outbound calls",
  eligible_new_quoted: "Outbound calls (New/Quoted leads)",
} as const satisfies Record<(typeof SALES_OUTREACH_GOAL_COUNT_SCOPES)[number], string>;
export const SALES_OUTREACH_OTHER_OUTBOUND_LABEL = "Other outbound" as const;
export const SALES_OUTREACH_GOAL_STATE_LABELS = {
  goal: null,
  no_goal_today: "No goal today",
  not_on_roster: "Not on roster",
} as const satisfies Record<(typeof SALES_OUTREACH_GOAL_STATES)[number], string | null>;

export const salesOutreachCoverageSchema = z
  .object({
    state: z.enum(SALES_OUTREACH_COVERAGE_STATES),
    /** Capture is known complete through this instant (null when unknown). */
    known_complete_through: nullableInstant,
    /** The instant the count needs coverage through: end of a past day, `as_of` − tolerance today. */
    required_through: instant,
    gaps: z.array(z.object({ from: nullableInstant, to: instant }).strict()).max(50),
  })
  .strict();

const captureFreshnessSchema = z
  .object({
    state: z.enum(SALES_OUTREACH_CAPTURE_FRESHNESS_STATES),
    /** Latest successful capture progress (calls: Call Log reconcile; SMS: worst reviewed mailbox). */
    last_updated_at: nullableInstant,
    known_complete_through: nullableInstant,
    age_seconds: z.number().int().min(0).nullable(),
    reason: z.string().nullable(),
  })
  .strict();

export const salesOutreachFreshnessSchema = z
  .object({
    calls: captureFreshnessSchema,
    sms: captureFreshnessSchema,
    granot: z
      .object({
        state: z.enum(SALES_OUTREACH_GRANOT_FRESHNESS_STATES),
        /** Newest Granot observation captured by the server. */
        last_observed_at: nullableInstant,
        age_seconds: z.number().int().min(0).nullable(),
      })
      .strict(),
  })
  .strict();

const scopeSchema = z
  .object({
    role: z.enum(SALES_OUTREACH_ROLES),
    /** The rep the read is scoped to: the signed rep, or the Owner/Manager `agent_id` filter, else null. */
    agent_id: salesOutreachAgentIdSchema.nullable(),
  })
  .strict();

const baseReadSchema = z.object({
  contract_version: z.literal(SALES_OUTREACH_CONTRACT_VERSION),
  as_of: instant,
  timezone: z.literal(SALES_OUTREACH_TIMEZONE),
  scope: scopeSchema,
  configuration_state: z.enum(SALES_OUTREACH_CONFIGURATION_STATES),
  configuration_version: z.string().nullable(),
  configuration_revision: z.number().int().min(0).nullable(),
});

const commonReadSchema = baseReadSchema.extend({
  /** Highest `publication_revision` of the projection rows this read used; null when none. */
  projection_revision: z.number().int().min(0).nullable(),
  freshness: salesOutreachFreshnessSchema,
});

/** A metric M1 does not serve yet: the admin renders it as unavailable, never as 0. */
const notAvailableInM1 = z
  .object({ value: z.null(), unknown_reason: z.literal("not_available_in_m1") })
  .strict();

// ---------------------------------------------------------------------------
// GET /capabilities
// ---------------------------------------------------------------------------

export const SALES_OUTREACH_VIEWS = ["team", "my", "activity", "settings", "numbers", "accounts"] as const;
export const SALES_OUTREACH_DESK_UNAVAILABLE_REASONS = [
  "configuration_uninitialized",
  "configuration_unavailable",
  "desk_disabled",
] as const;

export const salesOutreachCapabilitiesSchema = baseReadSchema
  .extend({
    /** Safe effective booleans only: never credentials, migration budgets or policy values. */
    controls: z
      .object({
        desk_enabled: z.boolean(),
        goal_metrics_enabled: z.boolean(),
        rep_sms_capture_enabled: z.boolean(),
        cadence_shadow_enabled: z.boolean(),
        cadence_enforcement_enabled: z.boolean(),
        intake_admission_enabled: z.boolean(),
      })
      .strict(),
    desk_available: z.boolean(),
    unavailable_reason: z.enum(SALES_OUTREACH_DESK_UNAVAILABLE_REASONS).nullable(),
    /** Views this actor may open now (deployed and permitted). */
    permitted_views: z.array(z.enum(SALES_OUTREACH_VIEWS)),
    /** Query filters each deployed read accepts from this actor. */
    permitted_filters: z
      .object({ rep_days: z.array(z.enum(["business_day", "agent_id"])), team: z.array(z.enum(["business_day"])) })
      .strict(),
    /** Commands this actor may send now (deployed and permitted). */
    permitted_commands: z.array(z.string()),
    /** The role's P09 capability set, deployed or not (for disabling future controls honestly). */
    role_capabilities: z.array(z.string()),
    /** Desk reads served by this server build. */
    deployed_reads: z.array(z.enum(["capabilities", "rep_days", "team"])),
  })
  .strict();
export type SalesOutreachCapabilitiesDto = z.infer<typeof salesOutreachCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// GET /rep-days
// ---------------------------------------------------------------------------

export const SALES_OUTREACH_GOAL_BASES = ["work_schedule", "default_goal", "override", "not_scheduled", "not_on_roster"] as const;
export const SALES_OUTREACH_ACTUAL_BASES = ["projection", "no_activity_recorded", "pending"] as const;

export const salesOutreachGoalProvenanceSchema = z
  .object({
    /** `projection_snapshot`: the goal frozen on a past day's rep-day row; `configuration`: resolved from the active roster. */
    source: z.enum(["configuration", "projection_snapshot"]),
    basis: z.enum(SALES_OUTREACH_GOAL_BASES),
    configuration_version: z.string().nullable(),
    roster_version: z.string().nullable(),
    /** Whether the day is one of the rep's scheduled working days; null when not on the roster or unknown. */
    scheduled_working_day: z.boolean().nullable(),
    override: z
      .object({
        business_date: salesOutreachBusinessDateSchema,
        goal: z.number().int().min(0),
        reason: z.enum(["absence", "partial_day"]),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const salesOutreachRepDaySchema = z
  .object({
    agent_id: salesOutreachAgentIdSchema,
    /** Name from the rep's reviewed identity link; null when no current link. */
    agent_name: z.string().nullable(),
    /** Whether the Agent has a reviewed `sales_rep` link effective at `as_of`. */
    reviewed_link: z.boolean(),
    goal_state: z.enum(SALES_OUTREACH_GOAL_STATES),
    /** "No goal today" / "Not on roster"; null for an ordinary goal. */
    goal_label: z.string().nullable(),
    goal: z.number().int().min(0).nullable(),
    goal_provenance: salesOutreachGoalProvenanceSchema,
    count_scope: z.enum(SALES_OUTREACH_GOAL_COUNT_SCOPES),
    count_scope_label: z.string(),
    /** Confirmed (Call Log) outbound credits; null while pending, never a guessed 0. */
    actual_confirmed: z.number().int().min(0).nullable(),
    /** Webhook-seen calls not yet in the Call Log: shown separately, never counted toward progress. */
    actual_awaiting_confirmation: z.number().int().min(0).nullable(),
    actual_basis: z.enum(SALES_OUTREACH_ACTUAL_BASES),
    /** max(0, goal − actual_confirmed); null when either is unknown. */
    remaining: z.number().int().min(0).nullable(),
    /** min(1, actual / goal) — capped; null without a positive goal or a known actual. */
    progress: z.number().min(0).max(1).nullable(),
    /** actual ≥ goal for a positive goal; false on a zero-goal day; null when unknown or not on roster. */
    goal_reached: z.boolean().nullable(),
    /** Calls kept out of the count (no eligible Lead), labelled "Other outbound". */
    other_outbound: z.object({ count: z.number().int().min(0).nullable(), label: z.literal(SALES_OUTREACH_OTHER_OUTBOUND_LABEL) }).strict(),
    coverage: salesOutreachCoverageSchema,
    unknown_reason: z.string().nullable(),
    projection_revision: z.number().int().min(0).nullable(),
    computed_as_of: nullableInstant,
  })
  .strict();
export type SalesOutreachRepDayDto = z.infer<typeof salesOutreachRepDaySchema>;

export const salesOutreachRepDaysSchema = commonReadSchema
  .extend({
    business_day: salesOutreachBusinessDateSchema,
    is_today: z.boolean(),
    goal_metrics_enabled: z.boolean(),
    /** The rows' common count scope; `mixed` when rows on this day counted different scopes. */
    count_scope: z.enum([...SALES_OUTREACH_GOAL_COUNT_SCOPES, "mixed"]).nullable(),
    reps: z.array(salesOutreachRepDaySchema).nullable(),
    unknown_reason: z.enum(["goal_metrics_disabled"]).nullable(),
  })
  .strict();
export type SalesOutreachRepDaysDto = z.infer<typeof salesOutreachRepDaysSchema>;

// ---------------------------------------------------------------------------
// GET /team (M1: goal parts only)
// ---------------------------------------------------------------------------

export const salesOutreachTeamGoalsSchema = z
  .object({
    count_scope: z.enum([...SALES_OUTREACH_GOAL_COUNT_SCOPES, "mixed"]).nullable(),
    count_scope_label: z.string().nullable(),
    /** Card 1: confirmed outbound calls of roster reps (zero-goal reps included) / sum of applicable goals. */
    outbound_calls: z
      .object({
        actual: z.number().int().min(0).nullable(),
        goal: z.number().int().min(0),
        progress: z.number().min(0).max(1).nullable(),
        /** True when some roster rep's count is pending; `actual` then sums only known reps. */
        incomplete: z.boolean(),
        pending_agent_ids: z.array(salesOutreachAgentIdSchema),
        unknown_reason: z.string().nullable(),
      })
      .strict(),
    /** Card 2: reps at goal / reps with a positive goal (zero-goal reps excluded from the denominator). */
    reps_at_goal: z
      .object({ count: z.number().int().min(0), of: z.number().int().min(0), pending: z.number().int().min(0) })
      .strict(),
    other_outbound_total: z.number().int().min(0).nullable(),
    roster_size: z.number().int().min(0),
  })
  .strict();

export const salesOutreachTeamSchema = commonReadSchema
  .extend({
    business_day: salesOutreachBusinessDateSchema,
    is_today: z.boolean(),
    goal_metrics_enabled: z.boolean(),
    goals: salesOutreachTeamGoalsSchema.nullable(),
    goals_unknown_reason: z.enum(["goal_metrics_disabled"]).nullable(),
    /** Daily call goals table rows (roster reps first, then reps with activity who are not on the roster). */
    daily_call_goals: z
      .array(salesOutreachRepDaySchema.extend({ overdue_leads: notAvailableInM1 }).strict())
      .nullable(),
    /** Cards 3 and 4 and the attention/unassigned parts arrive with the queue (M2). */
    distinct_overdue_leads: notAvailableInM1,
    quoted_overdue_leads: notAvailableInM1,
    unassigned: notAvailableInM1,
    leads_needing_attention: notAvailableInM1,
    /** Owner-only advanced readiness; null for a Manager. */
    readiness: z
      .object({
        configuration_state: z.enum(SALES_OUTREACH_CONFIGURATION_STATES),
        activation_blockers: z.array(z.string()),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SalesOutreachTeamDto = z.infer<typeof salesOutreachTeamSchema>;

/** The `{ ok: true, data }` envelope every desk read returns. */
export const salesOutreachReadEnvelope = <T extends z.ZodType>(data: T) => z.object({ ok: z.literal(true), data }).strict();

/** The refusal envelope every desk route returns (`sendOutreachError`); `INTERNAL` is the 500 case. */
export const salesOutreachErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum([...SALES_OUTREACH_ERROR_CODES, "INTERNAL"]),
    error: z.string(),
    request_id: z.string(),
    issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string().optional() }).strict()).max(50).optional(),
  })
  .strict();
