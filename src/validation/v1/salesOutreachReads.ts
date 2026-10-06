import { z } from "zod";
import {
  SALES_OUTREACH_CADENCE_EXPOSURES,
  SALES_OUTREACH_CHANNEL_STATUSES,
  SALES_OUTREACH_CONTRACT_VERSION,
  SALES_OUTREACH_ENROLLMENT_KINDS,
  SALES_OUTREACH_ERROR_CODES,
  SALES_OUTREACH_FOLLOWUP_KINDS,
  SALES_OUTREACH_FOLLOWUP_STATUSES,
  SALES_OUTREACH_GOAL_COUNT_SCOPES,
  SALES_OUTREACH_GOAL_STATES,
  SALES_OUTREACH_LEAD_MODELS,
  SALES_OUTREACH_LIVE_TOPICS,
  SALES_OUTREACH_LIVE_VERSIONS,
  SALES_OUTREACH_PERIOD_START_KINDS,
  SALES_OUTREACH_PRIORITY_BASES,
  SALES_OUTREACH_QUEUE_FILTERS,
  SALES_OUTREACH_QUEUE_SORTS,
  SALES_OUTREACH_QUEUE_STATES,
  SALES_OUTREACH_RECEIVED_QUALITIES,
  SALES_OUTREACH_ROLES,
  SALES_OUTREACH_SUBJECT_STATUSES,
  SALES_OUTREACH_TIMEZONE,
  SALES_OUTREACH_WORKFLOWS,
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
    /**
     * Latest capture progress. Calls: min(last Call Log confirmation, newest call webhook receipt) in the
     * staffed window [07:45, 20:30) New York, the confirmation alone outside it (RINGCENTRAL-CAPTURE §8).
     * SMS: the worst reviewed mailbox's last sync.
     */
    last_updated_at: nullableInstant,
    known_complete_through: nullableInstant,
    /** Calls: seconds since `last_updated_at`. SMS: seconds since `known_complete_through`. */
    age_seconds: z.number().int().min(0).nullable(),
    /**
     * Why the state is not `fresh` (null when fresh). Free string. Calls: the reconcile's last error code,
     * else `confirmation_stale` | `coverage_behind` | `webhook_silent`, or `no_capture_state` when unknown.
     */
    reason: z.string().nullable(),
    /** Calls diagnostics (olr A3-fresh): last Call Log confirmation (max of ISync lane and reconcile sync success). Null for SMS. */
    last_confirmation_at: nullableInstant,
    /** Calls diagnostics (olr A3-fresh): newest call webhook receipt, inside or outside the staffed window. Null for SMS. */
    last_webhook_at: nullableInstant,
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

/**
 * Why a cadence metric has no value: cadence evaluation is off (`cadence_disabled`), runs in shadow so
 * no overdue label may be shown (`cadence_shadow`), or the stored cadence cannot be resolved
 * (`policy_unavailable`). The admin renders a null value as unavailable, never as 0.
 */
export const SALES_OUTREACH_CADENCE_UNKNOWN_REASONS = ["cadence_disabled", "cadence_shadow", "policy_unavailable"] as const;
const cadenceMetricSchema = z
  .object({ value: z.number().int().min(0).nullable(), unknown_reason: z.enum(SALES_OUTREACH_CADENCE_UNKNOWN_REASONS).nullable() })
  .strict();
/**
 * A due-count metric (rep-days `calls_due_today` / `sms_due_today`): the cadence reasons, plus
 * `coverage_incomplete` when a due requirement's remaining count is unknown because its channel has no
 * capture coverage yet (a partial sum would undercount).
 */
export const SALES_OUTREACH_DUE_TODAY_UNKNOWN_REASONS = [...SALES_OUTREACH_CADENCE_UNKNOWN_REASONS, "coverage_incomplete"] as const;
const dueTodayMetricSchema = z
  .object({ value: z.number().int().min(0).nullable(), unknown_reason: z.enum(SALES_OUTREACH_DUE_TODAY_UNKNOWN_REASONS).nullable() })
  .strict();

const subjectIdSchema = z.string().regex(/^[a-f\d]{24}$/);

/**
 * One channel's requirement (CONTRACTS "Common read data"). Calls and SMS are independent; a pending
 * count is null, never 0. `status` is derived at the read's `as_of` (a `due` requirement whose deadline
 * passed reads `overdue`), then masked when the cadence runs in shadow (`overdue` reads `due`).
 */
export const salesOutreachChannelSchema = z
  .object({
    required: z.number().int().min(0).nullable(),
    verified_completed: z.number().int().min(0).nullable(),
    remaining: z.number().int().min(0).nullable(),
    due_at: nullableInstant,
    oldest_actionable_due_at: nullableInstant,
    status: z.enum(SALES_OUTREACH_CHANNEL_STATUSES),
    completion_kind: z.string().nullable(),
    coverage: z
      .object({
        state: z.enum(SALES_OUTREACH_COVERAGE_STATES),
        known_complete_through: nullableInstant,
        gaps: z.array(z.unknown()).max(50),
      })
      .strict(),
    blocked_reason: z.string().nullable(),
  })
  .strict();
export type SalesOutreachChannelDto = z.infer<typeof salesOutreachChannelSchema>;

export const salesOutreachStatusFlagsSchema = z
  .object({
    needs_contact: z.boolean(),
    overdue: z.boolean(),
    blocked: z.boolean(),
    pending: z.boolean(),
    move_date_passed: z.boolean(),
    move_date_unknown: z.boolean(),
    job_pending: z.boolean(),
    advisory_cooldown: z.boolean(),
  })
  .strict();

/** P05g review label, derived at `as_of` from the canonical move date. */
export const SALES_OUTREACH_MOVE_DATE_REVIEWS = ["passed", "unknown"] as const;

/** One queue row: the subject's display facts, independent Call/SMS facts and the sort keys' sources. */
export const salesOutreachQueueRowSchema = z
  .object({
    subject_id: subjectIdSchema,
    job_no: z.string().nullable(),
    /** "Job number pending": copying is disabled, the row is never hidden and no number is fabricated. */
    job_pending: z.boolean(),
    phone: z.string().nullable(),
    name: z.string().nullable(),
    move_date: salesOutreachBusinessDateSchema.nullable(),
    move_date_review: z.enum(SALES_OUTREACH_MOVE_DATE_REVIEWS).nullable(),
    priority_raw: z.string().nullable(),
    workflow: z.enum(SALES_OUTREACH_WORKFLOWS).nullable(),
    subject_status: z.enum(["active", "review"]),
    assigned_agent_id: salesOutreachAgentIdSchema.nullable(),
    assigned_agent_name: z.string().nullable(),
    received_at: nullableInstant,
    last_interaction_at: nullableInstant,
    oldest_actionable_due_at: nullableInstant,
    next_action_due_at: nullableInstant,
    call: salesOutreachChannelSchema,
    sms: salesOutreachChannelSchema,
    status_flags: salesOutreachStatusFlagsSchema,
    exposure: z.enum(SALES_OUTREACH_CADENCE_EXPOSURES),
    computed_as_of: instant,
    publication_revision: z.number().int().min(0),
    /**
     * New schedule day (received date = Day 1) stored by the evaluator at `computed_as_of`; null for any
     * workflow other than `new`, or when the received date is unknown. Never recomputed by the read.
     */
    schedule_day: z.number().int().nullable(),
  })
  .strict();
export type SalesOutreachQueueRowDto = z.infer<typeof salesOutreachQueueRowSchema>;

// ---------------------------------------------------------------------------
// GET /capabilities
// ---------------------------------------------------------------------------

export const SALES_OUTREACH_VIEWS = ["team", "my", "activity", "settings", "numbers", "accounts"] as const;
export const SALES_OUTREACH_DESK_UNAVAILABLE_REASONS = [
  "configuration_uninitialized",
  "configuration_unavailable",
  "desk_disabled",
] as const;

/**
 * The reference's "New lead schedule" box: configured cadence values copied 1:1 from the active
 * configuration (`cadence.*`), so a Rep can see the schedule without reading the configuration. No
 * minutes, rules, credentials or migration values; no text (the admin renders the words). A value that
 * is not configured is null.
 */
export const salesOutreachCadenceSummarySchema = z
  .object({
    policy_version: z.string().nullable(),
    new: z
      .object({
        /** `cadence.new_days_1_3_calls`. */
        days_1_3_calls: z.object({ required: z.number().int().min(0), optional: z.number().int().min(0) }).strict().nullable(),
        /** `cadence.new_call_slots`, one band per row; `calls_per_day` = the band's number of deadlines. */
        call_slots: z
          .array(
            z
              .object({
                from_day: z.number().int().min(1),
                to_day: z.number().int().min(1).nullable(),
                calls_per_day: z.number().int().min(1),
              })
              .strict(),
          )
          .nullable(),
        /** `cadence.sms_sequence`. */
        sms_sequence: z
          .object({
            initial_days: z.array(z.number().int().min(1)),
            repeat_from_day: z.number().int().min(1),
            repeat_every_days: z.number().int().min(1),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    /** Null: the configuration holds no Quoted daily-call value (the due-date minutes are not exposed). */
    quoted: z.object({ daily_calls_when_due: z.number().int().min(0).nullable() }).strict().nullable(),
  })
  .strict();
export type SalesOutreachCadenceSummaryDto = z.infer<typeof salesOutreachCadenceSummarySchema>;

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
      .object({
        rep_days: z.array(z.enum(["business_day", "agent_id"])),
        team: z.array(z.enum(["business_day"])),
        queue: z.array(z.enum(SALES_OUTREACH_QUEUE_FILTERS)),
      })
      .strict(),
    /** Live topics this actor receives on `GET /live` (scoped server-side). */
    live_topics: z.array(z.enum(SALES_OUTREACH_LIVE_TOPICS)),
    /** Commands this actor may send now (deployed and permitted). */
    permitted_commands: z.array(z.string()),
    /** The role's P09 capability set, deployed or not (for disabling future controls honestly). */
    role_capabilities: z.array(z.string()),
    /** Desk reads served by this server build. */
    deployed_reads: z.array(z.enum(["capabilities", "rep_days", "team", "queue", "outreach_detail", "live"])),
    /** Read-only copy of the configured cadence for every desk role; null unless the configuration is active. */
    cadence_summary: salesOutreachCadenceSummarySchema.nullable(),
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
    /*
     * Cadence counts for the rep's current assignment at `as_of` (SPECIFICATION §6.1), whatever
     * `business_day` is shown — the same rule as GET /team's cards. Units differ: `overdue_leads` counts
     * Leads; `calls_due_today` counts call attempts and `sms_due_today` SMS sends. Never compare a count
     * of attempts or sends with a count of Leads.
     */
    /** Distinct active Leads assigned to this Agent with an overdue Call or SMS requirement (enforcement only). */
    overdue_leads: cadenceMetricSchema,
    /** Remaining required call attempts of Call requirements that are due or overdue, summed over the Agent's active Leads. */
    calls_due_today: dueTodayMetricSchema,
    /** Remaining required SMS sends of SMS requirements that are due or overdue, summed the same way. */
    sms_due_today: dueTodayMetricSchema,
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
    daily_call_goals: z.array(salesOutreachRepDaySchema).nullable(),
    /** Card 3: distinct active Leads with an overdue requirement at `as_of` (goals never hide them). */
    distinct_overdue_leads: cadenceMetricSchema,
    /** Card 4: Quoted Leads whose Call requirement is overdue at `as_of`. */
    quoted_overdue_leads: cadenceMetricSchema,
    /** Unassigned active/review Leads (a count, not a label, so it is shown in shadow too) and the overdue part. */
    unassigned: z.object({ count: z.number().int().min(0).nullable(), overdue: cadenceMetricSchema }).strict(),
    /** The first rows of the team queue (Needs contact, Most overdue, every rep and Unassigned). */
    leads_needing_attention: z
      .object({
        rows: z.array(salesOutreachQueueRowSchema).nullable(),
        limit: z.number().int().min(1).max(100),
        unknown_reason: z.enum(SALES_OUTREACH_CADENCE_UNKNOWN_REASONS).nullable(),
      })
      .strict(),
    cadence_exposure: z.enum(SALES_OUTREACH_CADENCE_EXPOSURES).nullable(),
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

// ---------------------------------------------------------------------------
// GET /queue (SRV-8; CONTRACTS "GET /queue", "Queue sort enums")
// ---------------------------------------------------------------------------

/** Workflows a queue filter may name (closed subjects never appear in the queue). */
export const SALES_OUTREACH_QUEUE_WORKFLOWS = ["new", "quoted", "discretion", "none"] as const;
export const SALES_OUTREACH_MOVE_DATE_UNKNOWN_MODES = ["include", "exclude", "only"] as const;
export const SALES_OUTREACH_QUEUE_DEFAULT_LIMIT = 25;
export const SALES_OUTREACH_QUEUE_MAX_LIMIT = 100;

export const salesOutreachQueueQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    /** Trimmed, at most 100 characters, matched as a literal (Job Number prefix, phone digits of 4 or more, name substring). */
    search: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(100))
      .optional(),
    /** `all` (default), `unknown` (no code) or an observed code such as `0`, `1`, `3`. */
    priority: z.union([z.enum(["all", "unknown"]), z.string().regex(/^\d{1,3}$/)]).optional(),
    workflow: z.enum([...SALES_OUTREACH_QUEUE_WORKFLOWS, "all"]).optional(),
    move_date_from: salesOutreachBusinessDateSchema.optional(),
    move_date_to: salesOutreachBusinessDateSchema.optional(),
    /** Unknown move dates: `exclude` by default when a range is given (and counted), else `include`. */
    move_date_unknown: z.enum(SALES_OUTREACH_MOVE_DATE_UNKNOWN_MODES).optional(),
    /** Owner/Manager individual rep filter; a Rep may only name itself. */
    agent_id: salesOutreachAgentIdSchema.optional(),
    /** Owner/Manager Unassigned filter; refused for a Rep. */
    unassigned: z.enum(["true", "false"]).optional(),
    state: z.enum(SALES_OUTREACH_QUEUE_STATES).optional(),
    sort: z.enum(SALES_OUTREACH_QUEUE_SORTS).optional(),
    /** Only for `lead_received` (default desc) and `last_interaction` (default asc); urgency is fixed. */
    direction: z.enum(["asc", "desc"]).optional(),
    cursor: z.string().min(1).max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(SALES_OUTREACH_QUEUE_MAX_LIMIT).optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.move_date_from && query.move_date_to && query.move_date_from > query.move_date_to)
      ctx.addIssue({ code: "custom", path: ["move_date_to"], message: "move_date_to is before move_date_from" });
    if (query.agent_id && query.unassigned === "true")
      ctx.addIssue({ code: "custom", path: ["unassigned"], message: "agent_id and unassigned are mutually exclusive" });
    if (query.direction && (query.sort ?? "urgency") === "urgency")
      ctx.addIssue({ code: "custom", path: ["direction"], message: "urgency order is fixed" });
  });
export type SalesOutreachQueueQuery = z.infer<typeof salesOutreachQueueQuerySchema>;

export const salesOutreachQueueSchema = commonReadSchema
  .extend({
    /** The filters as applied (defaults resolved; a Rep's assignment is its own agent). */
    filters: z
      .object({
        search: z.string().nullable(),
        priority: z.string(),
        workflow: z.enum([...SALES_OUTREACH_QUEUE_WORKFLOWS, "all"]),
        move_date_from: salesOutreachBusinessDateSchema.nullable(),
        move_date_to: salesOutreachBusinessDateSchema.nullable(),
        move_date_unknown: z.enum(SALES_OUTREACH_MOVE_DATE_UNKNOWN_MODES),
        agent_id: salesOutreachAgentIdSchema.nullable(),
        unassigned: z.boolean(),
        state: z.enum(SALES_OUTREACH_QUEUE_STATES),
      })
      .strict(),
    sort: z.enum(SALES_OUTREACH_QUEUE_SORTS),
    direction: z.enum(["asc", "desc"]),
    limit: z.number().int().min(1).max(SALES_OUTREACH_QUEUE_MAX_LIMIT),
    cadence_exposure: z.enum(SALES_OUTREACH_CADENCE_EXPOSURES),
    /** False in shadow: no overdue/missed label is shown. */
    enforcement_labels: z.boolean(),
    rows: z.array(salesOutreachQueueRowSchema).max(SALES_OUTREACH_QUEUE_MAX_LIMIT),
    /** Opaque, signed, scope-bound; send it back unchanged with the same filters. A mismatch is 409 CURSOR_EXPIRED. */
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
    /** First page only (null on later pages). */
    counts: z
      .object({
        /** Active/review subjects in this assignment scope without a projection yet ("pending", never "nothing to do"). */
        projection_pending: z.number().int().min(0).nullable(),
        /** Rows the move-date range excluded only because their move date is unknown. */
        excluded_unknown_move_date: z.number().int().min(0).nullable(),
      })
      .strict(),
  })
  .strict();
export type SalesOutreachQueueDto = z.infer<typeof salesOutreachQueueSchema>;

// ---------------------------------------------------------------------------
// GET /outreach/:id (SRV-8; CONTRACTS "GET /outreach/:id")
// ---------------------------------------------------------------------------

export const salesOutreachSubjectIdParamSchema = subjectIdSchema;
export const salesOutreachDetailQuerySchema = z.object({ scope: z.literal("production").optional() }).strict();

const planRowSchema = z
  .object({
    plan_id: subjectIdSchema,
    kind: z.enum(SALES_OUTREACH_FOLLOWUP_KINDS),
    status: z.enum(SALES_OUTREACH_FOLLOWUP_STATUSES),
    selected_date: salesOutreachBusinessDateSchema.nullable(),
    appointment_at: nullableInstant,
    due_at: instant,
    window_minutes: z.number().int().min(0).nullable(),
    effective_at: instant,
    ended_at: nullableInstant,
    end_reason: z.string().nullable(),
    revision: z.number().int().min(0),
  })
  .strict();

const windowChannelSchema = z
  .object({
    required: z.number().int().min(0),
    completed: z.number().int().min(0),
    /** Null when the cadence runs in shadow and the actor is not the Owner (no missed label). */
    missed: z.number().int().min(0).nullable(),
    waived: z.number().int().min(0),
    superseded: z.number().int().min(0),
    open: z.number().int().min(0),
  })
  .strict();

const catchUpSchema = z
  .object({ outstanding: z.boolean(), missed_count: z.number().int().min(0), state: z.string().nullable() })
  .strict();

export const SALES_OUTREACH_PROJECTION_STATES = ["current", "stale_policy", "pending", "cadence_disabled", "policy_unavailable"] as const;

export const salesOutreachDetailSchema = commonReadSchema
  .extend({
    subject: z
      .object({
        subject_id: subjectIdSchema,
        lead_model: z.enum(SALES_OUTREACH_LEAD_MODELS),
        status: z.enum(SALES_OUTREACH_SUBJECT_STATUSES),
        review_reasons: z.array(z.string()).max(50),
        received_at: nullableInstant,
        received_date: salesOutreachBusinessDateSchema.nullable(),
        received_quality: z.enum(SALES_OUTREACH_RECEIVED_QUALITIES),
        enrollment: z
          .object({
            cohort_id: z.string(),
            kind: z.enum(SALES_OUTREACH_ENROLLMENT_KINDS),
            enrolled_at: instant,
            activation_at: instant,
          })
          .strict(),
        job_no: z.string().nullable(),
        job_pending: z.boolean(),
        phone: z.string().nullable(),
        name: z.string().nullable(),
        move_date: salesOutreachBusinessDateSchema.nullable(),
        move_date_review: z.enum(SALES_OUTREACH_MOVE_DATE_REVIEWS).nullable(),
      })
      .strict(),
    /** P05e provenance: the accepted (or intake-default) code apart from the cadence it selected. */
    priority: z
      .object({
        raw: z.string().nullable(),
        basis: z.enum(SALES_OUTREACH_PRIORITY_BASES),
        accepted_at: nullableInstant,
        uncertain: z.boolean(),
      })
      .strict(),
    assignment: z
      .object({
        assigned_agent_id: salesOutreachAgentIdSchema.nullable(),
        assigned_agent_name: z.string().nullable(),
        unassigned: z.boolean(),
        /** Send as `expected_revision` to `PATCH /outreach/:id/assignment`. */
        assignment_revision: z.number().int().min(0),
        /** The Lead's authoritative `receiver_agent`, re-read for this response. */
        lead_receiver_agent_id: salesOutreachAgentIdSchema.nullable(),
        /** False while the desk copy lags the Lead (the next lead-change pass catches up). */
        in_sync: z.boolean(),
      })
      .strict(),
    plan: z
      .object({
        /** Send as `expected_revision` to the quoted-followup and callback commands (P06f shared revision). */
        plan_revision: z.number().int().min(0),
        active: planRowSchema.nullable(),
        history: z.array(planRowSchema).max(50),
      })
      .strict(),
    policy: z
      .object({
        projection_state: z.enum(SALES_OUTREACH_PROJECTION_STATES),
        exposure: z.enum(SALES_OUTREACH_CADENCE_EXPOSURES).nullable(),
        enforcement_labels: z.boolean(),
        workflow: z.enum(SALES_OUTREACH_WORKFLOWS).nullable(),
        engine_state: z.string().nullable(),
        policy_version: z.string().nullable(),
        configuration_version: z.string().nullable(),
        schedule_day: z.number().int().nullable(),
        period: z
          .object({
            period_id: subjectIdSchema,
            workflow: z.enum(SALES_OUTREACH_WORKFLOWS),
            start_kind: z.enum(SALES_OUTREACH_PERIOD_START_KINDS),
            priority: z.string().nullable(),
            started_at: instant,
          })
          .strict()
          .nullable(),
        quoted: z
          .object({
            selected_date: salesOutreachBusinessDateSchema.nullable(),
            first_required_date: salesOutreachBusinessDateSchema.nullable(),
            basis: z.string(),
            plan_id: z.string().nullable(),
          })
          .strict()
          .nullable(),
        callback: z
          .object({ plan_id: z.string(), appointment_at: instant, due_at: instant, outcome: z.string(), fulfilled_by_event_id: z.string().nullable() })
          .strict()
          .nullable(),
        initial_response: z.object({ due_at: nullableInstant, outcome: z.string(), fulfilled_at: nullableInstant }).strict().nullable(),
        /** P06b advisory only: never a block, never an overdue state. */
        advisory_cooldown: z.object({ warning: z.boolean(), unsuccessful_attempts: z.number().int().min(0) }).strict(),
        catch_up: z.object({ call: catchUpSchema, sms: catchUpSchema }).strict().nullable(),
        blocked_until: z.object({ call: nullableInstant, sms: nullableInstant }).strict(),
        /** Deterministic explanation codes the admin renders as text (no generated text, D01). */
        explanation: z.array(z.object({ code: z.string(), value: z.union([z.string(), z.number()]).nullable() }).strict()).max(30),
      })
      .strict(),
    requirements: z.object({ call: salesOutreachChannelSchema, sms: salesOutreachChannelSchema }).strict(),
    status_flags: salesOutreachStatusFlagsSchema,
    oldest_actionable_due_at: nullableInstant,
    next_action_due_at: nullableInstant,
    last_interaction_at: nullableInstant,
    /** Owner-only during shadow: the unmasked labels for the MANUAL-START reconciliation; null otherwise. */
    shadow_labels: z
      .object({
        call_status: z.enum(SALES_OUTREACH_CHANNEL_STATUSES),
        sms_status: z.enum(SALES_OUTREACH_CHANNEL_STATUSES),
        overdue: z.boolean(),
      })
      .strict()
      .nullable(),
    history: z
      .object({
        window_history: z
          .array(
            z
              .object({
                business_date: salesOutreachBusinessDateSchema,
                schedule_day: z.number().int().nullable(),
                workflow: z.enum(SALES_OUTREACH_WORKFLOWS).nullable(),
                closed_date: z.boolean(),
                call: windowChannelSchema,
                sms: windowChannelSchema,
              })
              .strict(),
          )
          .max(30),
        window_summary: z
          .object({
            dates: z.number().int().min(0),
            call_missed: z.number().int().min(0).nullable(),
            sms_missed: z.number().int().min(0).nullable(),
          })
          .strict()
          .nullable(),
        missed_labels_hidden: z.boolean(),
        /** This subject's own evidence (unique opportunity), metadata only: no bodies, no other Lead's contacts. */
        contact_events: z
          .array(
            z
              .object({
                event_id: subjectIdSchema,
                channel: z.enum(["call", "sms"]),
                direction: z.enum(["inbound", "outbound"]),
                kind: z.string(),
                event_at: instant,
                business_date: salesOutreachBusinessDateSchema,
                verification: z.string(),
                exclusion_reason: z.string().nullable(),
                actor_agent_id: salesOutreachAgentIdSchema.nullable(),
                actor_agent_name: z.string().nullable(),
                outbound_goal_credit: z.boolean(),
                restricted_at_contact: z.boolean(),
              })
              .strict(),
          )
          .max(100),
        contact_events_truncated: z.boolean(),
        /** P06d: recorded `receiver_agent` changes (newest first). */
        assignment_changes: z
          .array(
            z
              .object({
                applied_at: instant,
                from_agent_id: salesOutreachAgentIdSchema.nullable(),
                to_agent_id: salesOutreachAgentIdSchema.nullable(),
                /** Reviewed `sales_rep` link name at `as_of`, else the Agent's name; null when unassigned or unknown. */
                from_agent_name: z.string().nullable(),
                to_agent_name: z.string().nullable(),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
    /** Contact restrictions on this Lead's numbers that block now (P06c), without number ids. */
    restrictions: z
      .array(
        z
          .object({
            channels: z.array(z.enum(["call", "sms"])),
            until: nullableInstant,
            reason: z.string().nullable(),
            origin: z.enum(["owner", "intelligence"]),
            confirmed: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    computed_as_of: nullableInstant,
    publication_revision: z.number().int().min(0).nullable(),
  })
  .strict();
export type SalesOutreachDetailDto = z.infer<typeof salesOutreachDetailSchema>;

// ---------------------------------------------------------------------------
// GET /live (SRV-8; CONTRACTS "SSE", IMPLEMENTATION-PLAN §5)
// ---------------------------------------------------------------------------

export const salesOutreachLiveQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    /** Frame schema version the client speaks (default 1); an unsupported version is 400 before streaming. */
    version: z.coerce.number().int().min(1).optional(),
  })
  .strict();

/** One scoped invalidation hint: ids and revisions only, never a customer or provider record. */
export const salesOutreachLiveChangeSchema = z
  .object({
    topic: z.enum(SALES_OUTREACH_LIVE_TOPICS),
    subject_ids: z.array(subjectIdSchema).max(100),
    agent_ids: z.array(salesOutreachAgentIdSchema).max(10),
    business_day: salesOutreachBusinessDateSchema.nullable(),
    /** Committed publication revision (projection, rep-day row or configuration pointer). */
    revision: z.number().int().min(0).nullable(),
  })
  .strict();
export type SalesOutreachLiveChange = z.infer<typeof salesOutreachLiveChangeSchema>;

/** `event: invalidation` data. connect, reconnect, clock and an overfull change frame all mean a full scoped refetch. */
export const salesOutreachLiveFrameSchema = z
  .object({
    version: z.literal(SALES_OUTREACH_LIVE_VERSIONS[0]),
    contract_version: z.literal(SALES_OUTREACH_CONTRACT_VERSION),
    reason: z.enum(["connect", "reconnect", "change", "clock"]),
    as_of: instant,
    refetch: z.enum(["all", "scoped"]),
    topics: z.array(z.enum(SALES_OUTREACH_LIVE_TOPICS)),
    changes: z.array(salesOutreachLiveChangeSchema).max(200),
  })
  .strict();
export type SalesOutreachLiveFrame = z.infer<typeof salesOutreachLiveFrameSchema>;
