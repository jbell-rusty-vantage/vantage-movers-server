import { z } from "zod";
import {
  CALL_CAPTURE_FINALIZATION_LAG_MINUTES,
  DESK_TIMING_DEFAULTS,
  SALES_OUTREACH_TIMEZONE,
} from "../../config/domain/salesOutreach";

/**
 * Strict persisted value of `sales_outreach_configuration` (CONTRACTS "Persisted configuration",
 * IMPLEMENTATION-PLAN §4.8, FAST-01 additions).
 *
 * - A missing namespace or key takes the CONTRACTS bootstrap default: controls false, migration
 *   paused, every policy/goal value null. None of those defaults activates behaviour.
 * - Unknown keys are rejected everywhere (no arbitrary flag keys, no arbitrary rules).
 * - "Rule" fields are closed enums naming the single approved behaviour; there is no free text or
 *   script. Exact encodings are engineering-owned (CONTRACTS "Additional target semantics").
 * - Approved FINAL-01 values are written only by `ops/sales-outreach/install-approved-policy.ts`
 *   through the same PATCH service path; the server never falls back to them.
 * - Evolution rule (olr A0): every key added after revision 5 is `.optional()` with no
 *   `.default()`, and a new namespace is `.optional()` with no `.prefault()`. An absent key stays
 *   absent in the parsed value, so a version stored before the addition re-parses to the same
 *   content hash; the effective default lives in a code resolver (`config/timing.ts`).
 */

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const salesOutreachBusinessDateSchema = z
  .string()
  .regex(BUSINESS_DATE_PATTERN)
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "invalid calendar date");
export const salesOutreachAgentIdSchema = z.string().regex(/^[a-f\d]{24}$/);
const instant = z.iso.datetime();
const minuteOfDay = z.number().int().min(0).max(1440);
const isoWeekday = z.number().int().min(1).max(7);
const text = z.string().trim().min(1).max(200);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);
const rule = <const T extends readonly [string, ...string[]]>(values: T) => nullable(z.enum(values));

const strictlyAscendingUnique = (values: readonly number[]) =>
  values.every((value, i) => i === 0 || value > values[i - 1]!);

const controlsSchema = z
  .object({
    desk_enabled: z.boolean().default(false),
    cadence_shadow_enabled: z.boolean().default(false),
    cadence_enforcement_enabled: z.boolean().default(false),
    rep_sms_capture_enabled: z.boolean().default(false),
    goal_metrics_enabled: z.boolean().default(false),
  })
  .strict();

const transitionSchema = z
  .object({
    legacy_planning_paused: z.boolean().default(false),
    migrated_cohort_id: nullable(text),
    activation_at: nullable(instant),
    intake_admission_enabled: z.boolean().default(false),
    intake_admission_at: nullable(instant),
    intake_admission_watermark: nullable(text),
    // FAST-01 backfill scope (FAST-TRACK.md "Backfill scope").
    backfill_lookback_days: nullable(z.number().int().min(1).max(3650)),
    backfill_include_upcoming_moves: nullable(z.boolean()),
  })
  .strict();

const workingDaySchema = z
  .object({ iso_weekday: isoWeekday, open_minute: minuteOfDay, close_minute: minuteOfDay })
  .strict()
  .refine((day) => day.open_minute < day.close_minute, "open_minute must precede close_minute");

const callSlotBandSchema = z
  .object({
    from_day: z.number().int().min(1).max(3650),
    to_day: z.number().int().min(1).max(3650).nullable(),
    deadline_minutes: z.array(minuteOfDay).min(1).max(10),
  })
  .strict()
  .refine((band) => band.to_day === null || band.to_day >= band.from_day, "to_day before from_day")
  .refine((band) => strictlyAscendingUnique(band.deadline_minutes), "deadline_minutes must ascend");

const PRIORITY_WORKFLOWS = ["new", "quoted", "discretion", "closed", "none"] as const;
const priorityMapSchema = z
  .object({
    codes: z
      .array(
        z
          .object({
            code: z.string().regex(/^\d{1,3}$/),
            workflow: z.enum(PRIORITY_WORKFLOWS),
            closure_reason: z.enum(["granot_booked", "crm_bad_disposition", "crm_dead_disposition"]).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    unmapped_workflow: z.enum(["none"]),
    official_booking_workflow: z.enum(["closed"]),
  })
  .strict()
  .refine((map) => new Set(map.codes.map((c) => c.code)).size === map.codes.length, "duplicate priority code");

const INTAKE_DEFAULTS = ["new", "review"] as const;
const intakeDefaultRuleSchema = z
  .object({
    website_form: z.enum(INTAKE_DEFAULTS),
    best_relocation: z.enum(INTAKE_DEFAULTS),
    ringcentral_call: z.enum(INTAKE_DEFAULTS),
    manual: z.enum(INTAKE_DEFAULTS),
    granot_created: z.enum(INTAKE_DEFAULTS),
  })
  .strict();

const cadenceSchema = z
  .object({
    policy_version: nullable(text),
    approval_ref: nullable(text),
    timezone: z.literal(SALES_OUTREACH_TIMEZONE).default(SALES_OUTREACH_TIMEZONE),
    calendar_mode: rule(["new_york_calendar_date"] as const),
    working_days: nullable(
      z
        .array(workingDaySchema)
        .min(1)
        .max(7)
        .refine((days) => strictlyAscendingUnique(days.map((d) => d.iso_weekday)), "working_days must be unique and ordered"),
    ),
    holidays: nullable(
      z
        .array(salesOutreachBusinessDateSchema)
        .max(366)
        .refine((dates) => dates.every((d, i) => i === 0 || d > dates[i - 1]!), "holidays must be unique and ordered"),
    ),
    initial_response_working_minutes: nullable(z.number().int().min(1).max(1440)),
    new_days_1_3_calls: nullable(
      z.object({ required: z.number().int().min(0).max(10), optional: z.number().int().min(0).max(10) }).strict(),
    ),
    new_call_slots: nullable(
      z
        .array(callSlotBandSchema)
        .min(1)
        .max(20)
        .refine(
          (bands) =>
            bands.every((band, i) => {
              if (i === 0) return band.from_day === 1;
              const previous = bands[i - 1]!;
              return previous.to_day !== null && band.from_day === previous.to_day + 1;
            }) && bands[bands.length - 1]!.to_day === null,
          "new_call_slots must be ordered, contiguous from day 1 and open-ended",
        ),
    ),
    new_call_min_spacing_minutes: nullable(z.number().int().min(0).max(1440)),
    sms_cutoff_minute: nullable(minuteOfDay),
    sms_mode: rule(["fixed_sequence"] as const),
    sms_sequence: nullable(
      z
        .object({
          initial_days: z.array(z.number().int().min(1).max(3650)).max(30),
          repeat_from_day: z.number().int().min(1).max(3650),
          repeat_every_days: z.number().int().min(1).max(365),
        })
        .strict()
        .refine((s) => strictlyAscendingUnique(s.initial_days), "initial_days must ascend")
        .refine((s) => s.initial_days.every((d) => d < s.repeat_from_day), "initial_days must precede repeat_from_day"),
    ),
    quoted_open_minute: nullable(minuteOfDay),
    quoted_due_minute: nullable(minuteOfDay),
    quoted_same_day_cutoff_minute: nullable(minuteOfDay),
    return_to_new_mode: rule(["original_age_partial_day"] as const),
    late_arrival_rule: nullable(
      z
        .object({
          two_calls_before_minute: minuteOfDay,
          one_call_through_minute: minuteOfDay,
          sms_through_minute: minuteOfDay,
        })
        .strict()
        .refine((r) => r.two_calls_before_minute <= r.one_call_through_minute, "two-call threshold after one-call threshold"),
    ),
    catchup_mode: rule(["one_per_channel"] as const),
    restriction_clock_rule: rule(["waive_pause_resume_next_working_date"] as const),
    callback_window_minutes: nullable(z.number().int().min(1).max(240)),
    callback_mode: rule(["explicit_human_appointment"] as const),
    cooldown_warning_threshold: nullable(z.number().int().min(1).max(50)),
    cooldown_warning_hours: nullable(z.number().int().min(1).max(168)),
    cooldown_mode: rule(["advisory_warning"] as const),
    assignment_timeline_rule: rule(["continuous_timeline"] as const),
    intake_default_rule: nullable(intakeDefaultRuleSchema),
    uncertain_priority_rule: rule(["retain_last_verified"] as const),
    priority_map: nullable(priorityMapSchema),
    transition_day_rule: rule(["partial_day_allowance"] as const),
    move_date_rule: rule(["review_label_only"] as const),
    lead_eligibility_rule: rule(["no_sync_viable_duplicates_excluded"] as const),
    precedence_rule: rule(["closure_restriction_schedule_priority"] as const),
  })
  .strict();

const evidenceSchema = z
  .object({
    qualifying_call_rule: rule(["terminal_call_log_attempt"] as const),
    goal_rep_rule: rule(["reviewed_initiator_only"] as const),
    helping_rep_rule: rule(["reviewed_helper_cadence_only"] as const),
    sms_success_rule: rule(["sent_or_delivered"] as const),
    sms_failure_correction_rule: rule(["revoke_on_confirmed_failure"] as const),
    roster_version: nullable(text),
    event_time_rule: rule(["outbound_start_inbound_handled_sms_sent"] as const),
    operating_window_rule: rule(["goal_full_date_cadence_open_hours"] as const),
    originating_inbound_rule: rule(["unique_association_initial_response"] as const),
    restricted_contact_rule: rule(["history_only_zero_credit"] as const),
    // olr A0 capture tunables (optional, no default; effective values from `deskTimingOf`).
    call_settlement_allowance_minutes: z.number().int().min(0).max(30).optional(),
    today_coverage_tolerance_minutes: z.number().int().min(5).max(180).optional(),
    capture_freshness_tolerance_minutes: z.number().int().min(1).max(60).optional(),
    webhook_silence_minutes: z.number().int().min(5).max(240).optional(),
  })
  .strict();

const migrationSchema = z
  .object({
    paused: z.boolean().default(true),
    batch_size: z.number().int().min(1).max(1000).default(25),
    batch_ceiling: z.number().int().min(1).max(1000).default(100),
    interval_seconds: z.number().int().min(0).max(86_400).default(10),
    max_batch_bytes: nullable(z.number().int().min(1)),
    max_batch_ms: nullable(z.number().int().min(1)),
    min_oplog_window_seconds: nullable(z.number().int().min(1)),
    warning_oplog_window_seconds: nullable(z.number().int().min(1)),
    max_replication_lag_seconds: nullable(z.number().int().min(0)),
    max_consumer_lag_seconds: nullable(z.number().int().min(0)),
    max_incremental_write_bytes_per_second: nullable(z.number().int().min(1)),
    // olr B10 Lead-change tail loop (optional, no default; effective values from `feedLoopOf` in `subjects/feed.ts`).
    feed_max_passes_per_run: z.number().int().min(1).max(50).optional(),
    feed_budget_seconds: z.number().int().min(1).max(40).optional(),
  })
  .strict()
  .refine((m) => m.batch_size <= m.batch_ceiling, "batch_size above batch_ceiling");

/** olr A0: evaluate-drain tunables (optional namespace, no prefault; effective values from `deskTimingOf`). */
const operationsSchema = z
  .object({
    evaluate_drain_max_jobs: z.number().int().min(1).max(1000).optional(),
    evaluate_drain_budget_seconds: z.number().int().min(5).max(55).optional(),
    evaluate_drain_concurrency: z.number().int().min(1).max(4).optional(),
  })
  .strict();

const repWorkScheduleSchema = z
  .object({
    agent_id: salesOutreachAgentIdSchema,
    working_days: z
      .array(isoWeekday)
      .max(7)
      .refine(strictlyAscendingUnique, "working_days must be unique and ordered"),
    scheduled_goal: z.number().int().min(0).max(10_000).nullable().default(null),
  })
  .strict();

const dayOverrideSchema = z
  .object({
    agent_id: salesOutreachAgentIdSchema,
    business_date: salesOutreachBusinessDateSchema,
    goal: z.number().int().min(0).max(10_000),
    reason: z.enum(["absence", "partial_day"]),
  })
  .strict()
  .refine((o) => o.reason !== "absence" || o.goal === 0, "an absence override has goal 0");

const goalsSchema = z
  .object({
    roster_version: nullable(text),
    rep_work_schedules: nullable(
      z
        .array(repWorkScheduleSchema)
        .max(500)
        .refine((rows) => new Set(rows.map((r) => r.agent_id)).size === rows.length, "duplicate roster agent"),
    ),
    default_scheduled_goal: nullable(z.number().int().min(0).max(10_000)),
    effective_day_overrides: nullable(
      z
        .array(dayOverrideSchema)
        .max(5000)
        .refine(
          (rows) => new Set(rows.map((r) => `${r.agent_id}:${r.business_date}`)).size === rows.length,
          "duplicate day override",
        ),
    ),
    zero_goal_rule: rule(["no_goal_today_excluded_from_denominator"] as const),
  })
  .strict();

export const CADENCE_REQUIRED_FOR_ACTIVATION = [
  "policy_version",
  "approval_ref",
  "calendar_mode",
  "working_days",
  "holidays",
  "initial_response_working_minutes",
  "new_days_1_3_calls",
  "new_call_slots",
  "new_call_min_spacing_minutes",
  "sms_cutoff_minute",
  "sms_mode",
  "sms_sequence",
  "quoted_open_minute",
  "quoted_due_minute",
  "quoted_same_day_cutoff_minute",
  "return_to_new_mode",
  "late_arrival_rule",
  "catchup_mode",
  "restriction_clock_rule",
  "callback_window_minutes",
  "callback_mode",
  "cooldown_warning_threshold",
  "cooldown_warning_hours",
  "cooldown_mode",
  "assignment_timeline_rule",
  "intake_default_rule",
  "uncertain_priority_rule",
  "priority_map",
  "transition_day_rule",
  "move_date_rule",
  "lead_eligibility_rule",
  "precedence_rule",
] as const;
export const EVIDENCE_REQUIRED_FOR_ACTIVATION = [
  "qualifying_call_rule",
  "goal_rep_rule",
  "helping_rep_rule",
  "sms_success_rule",
  "sms_failure_correction_rule",
  "event_time_rule",
  "operating_window_rule",
  "originating_inbound_rule",
  "restricted_contact_rule",
] as const;
export const GOALS_REQUIRED_FOR_ACTIVATION = [
  "roster_version",
  "rep_work_schedules",
  "default_scheduled_goal",
  "zero_goal_rule",
] as const;

export const salesOutreachConfigurationValueSchema = z
  .object({
    controls: controlsSchema.prefault({}),
    transition: transitionSchema.prefault({}),
    cadence: cadenceSchema.prefault({}),
    evidence: evidenceSchema.prefault({}),
    migration: migrationSchema.prefault({}),
    goals: goalsSchema.prefault({}),
    operations: operationsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const missing = (namespace: "cadence" | "evidence" | "goals", keys: readonly string[], because: string) => {
      const record = value[namespace] as Record<string, unknown>;
      for (const key of keys)
        if (record[key] === null)
          ctx.addIssue({ code: "custom", path: [namespace, key], message: `required by ${because}` });
    };
    const { controls, transition } = value;
    // CONTRACTS: enforcement (and its shadow computation) requires complete approved cadence/evidence/roster.
    for (const control of ["cadence_shadow_enabled", "cadence_enforcement_enabled"] as const) {
      if (!controls[control]) continue;
      missing("cadence", CADENCE_REQUIRED_FOR_ACTIVATION, `controls.${control}`);
      missing("evidence", EVIDENCE_REQUIRED_FOR_ACTIVATION, `controls.${control}`);
      missing("goals", GOALS_REQUIRED_FOR_ACTIVATION, `controls.${control}`);
    }
    if (controls.goal_metrics_enabled) missing("goals", GOALS_REQUIRED_FOR_ACTIVATION, "controls.goal_metrics_enabled");
    if (transition.intake_admission_enabled && transition.intake_admission_at === null)
      ctx.addIssue({ code: "custom", path: ["transition", "intake_admission_at"], message: "required by intake_admission_enabled" });
    // Below settlement + the capture finalization lag, today's coverage could never read complete.
    const settlement = value.evidence.call_settlement_allowance_minutes ?? DESK_TIMING_DEFAULTS.call_settlement_allowance_minutes;
    const tolerance = value.evidence.today_coverage_tolerance_minutes ?? DESK_TIMING_DEFAULTS.today_coverage_tolerance_minutes;
    if (tolerance <= settlement + CALL_CAPTURE_FINALIZATION_LAG_MINUTES)
      ctx.addIssue({
        code: "custom",
        path: ["evidence", "today_coverage_tolerance_minutes"],
        message: `must exceed call_settlement_allowance_minutes + ${CALL_CAPTURE_FINALIZATION_LAG_MINUTES}`,
      });
    const roster = new Set((value.goals.rep_work_schedules ?? []).map((r) => r.agent_id));
    (value.goals.effective_day_overrides ?? []).forEach((override, i) => {
      if (!roster.has(override.agent_id))
        ctx.addIssue({ code: "custom", path: ["goals", "effective_day_overrides", i, "agent_id"], message: "override for a rep not on the roster" });
    });
  });

export type SalesOutreachConfigurationValue = z.infer<typeof salesOutreachConfigurationValueSchema>;
export type SalesOutreachConfigurationInput = z.input<typeof salesOutreachConfigurationValueSchema>;

/** PATCH /configuration body: full replacement of the value plus the pointer revision the Owner read. */
export const salesOutreachConfigurationPatchSchema = z
  .object({
    scope: z.literal("production").optional(),
    expected_revision: z.number().int().min(0),
    value: z.unknown(),
  })
  .strict();

export const salesOutreachScopeQuerySchema = z
  .object({ scope: z.literal("production").optional() })
  .strict();
