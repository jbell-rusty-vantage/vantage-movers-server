/**
 * Persisted `cadence` namespace encoding of `sales_outreach_configuration` (CONTRACTS "Allowed value
 * namespaces", contracts/configuration-defaults.json) and its resolution into the engine policy.
 *
 * CONTRACTS fixes the field names and leaves the exact encodings to engineering. This file is that
 * encoding: S1's configuration model embeds `cadenceConfigurationValueSchema` for the `cadence` key.
 * Bootstrap values are null; `resolveEnginePolicy` fails closed (lists every missing/invalid field)
 * until a complete, approved value is installed. There is no default and no env fallback.
 */
import { z } from "zod";
import type { EnginePolicy, Weekday } from "./types";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const minuteOfDay = z.number().int().min(0).max(1440);
const positiveInt = z.number().int().min(1);
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const dayAllowance = {
  two_calls_before_minute: minuteOfDay,
  one_call_through_minute: minuteOfDay,
  sms_through_minute: minuteOfDay,
};

/** The complete (non-null) encoding of each `cadence` field. */
export const cadenceFieldSchemas = {
  policy_version: z.string().min(1).max(100),
  approval_ref: z.string().min(1).max(200),
  timezone: z.string().refine(isValidTimeZone, "unknown IANA timezone"),
  calendar_mode: z.literal("fixed_weekly_hours"),
  working_days: z.strictObject({
    weekdays: z.array(z.enum(WEEKDAYS)).min(1).max(7),
    opening_minute: minuteOfDay,
    closing_minute: minuteOfDay,
  }),
  /** Explicit Owner-closed dates (P02i). No automatic holiday list. */
  holidays: z.array(businessDate).max(1000),
  new_days_1_3_calls: z.strictObject({ required_calls: z.number().int().min(0).max(10), optional_extra_calls: z.number().int().min(0).max(10) }),
  /** Contiguous age bands from Day 1, the last open-ended (P01/P02f). */
  new_call_slots: z
    .array(
      z.strictObject({
        first_day: positiveInt,
        last_day: positiveInt.nullable(),
        deadline_minutes: z.array(minuteOfDay).max(10),
        optional_extra_calls: z.number().int().min(0).max(10),
      }),
    )
    .min(1)
    .max(20),
  new_call_min_spacing_minutes: z.number().int().min(0).max(1440),
  sms_cutoff_minute: minuteOfDay,
  sms_mode: z.strictObject({
    kind: z.literal("fixed_schedule_days"),
    initial_days: z.array(positiveInt).max(30),
    later_first_day: positiveInt,
    later_interval_days: positiveInt,
  }),
  quoted_due_minute: minuteOfDay,
  quoted_same_day_cutoff_minute: minuteOfDay,
  return_to_new_mode: z.strictObject({ kind: z.literal("original_received_age"), ...dayAllowance }),
  late_arrival_rule: z.strictObject({ initial_response_working_minutes: z.number().int().min(1).max(1440), ...dayAllowance }),
  catchup_mode: z.strictObject({ kind: z.literal("bounded_one_per_channel") }),
  restriction_clock_rule: z.strictObject({ kind: z.literal("waive_and_resume_next_working_date"), pause_initial_response: z.literal(true) }),
  callback_window_minutes: z.number().int().min(1).max(240),
  callback_mode: z.strictObject({ kind: z.literal("suspend_routine_calls_until_appointment") }),
  cooldown_warning_threshold: z.number().int().min(1).max(50),
  cooldown_warning_hours: z.number().int().min(1).max(168),
  cooldown_mode: z.literal("advisory"),
  assignment_timeline_rule: z.literal("continuous"),
  // P05e: native intake is always New; a Granot-created Lead without a priority is Review (FINAL-01) or
  // New (Owner amendment P05e-1, olr B3). Not carried into the engine policy (desk mapping only).
  intake_default_rule: z.strictObject({ native_intake: z.literal("new"), granot_created_missing_priority: z.enum(["review", "new"]) }),
  uncertain_priority_rule: z.literal("retain_last_verified"),
  transition_day_rule: z.strictObject({ kind: z.literal("prospective_partial_day"), quoted_activation_call_through_minute: minuteOfDay }),
  move_date_rule: z.literal("review_label_only"),
  lead_eligibility_rule: z.literal("p05h_no_sync_eligible"),
  precedence_rule: z.tuple([
    z.literal("authoritative_closure"),
    z.literal("channel_restriction"),
    z.literal("explicit_human_schedule"),
    z.literal("accepted_priority_routine_cadence"),
  ]),
} as const;

type CadenceFieldSchemas = typeof cadenceFieldSchemas;
export type CadenceField = keyof CadenceFieldSchemas;
export const CADENCE_FIELDS = Object.keys(cadenceFieldSchemas) as CadenceField[];

/** A complete approved `cadence` value. */
export type CadenceConfigurationValue = { [K in CadenceField]: z.infer<CadenceFieldSchemas[K]> };
/** The persisted `cadence` value: every field may be null (bootstrap / not yet approved). */
export type PersistedCadenceConfigurationValue = { [K in CadenceField]: z.infer<CadenceFieldSchemas[K]> | null };

/** Strict persisted schema (unknown keys rejected; null allowed per field). */
export const cadenceConfigurationValueSchema = z.strictObject(
  Object.fromEntries(CADENCE_FIELDS.map((field) => [field, cadenceFieldSchemas[field].nullable()])) as {
    [K in CadenceField]: z.ZodNullable<CadenceFieldSchemas[K]>;
  },
);

export type ResolveEnginePolicyResult =
  | { ok: true; policy: EnginePolicy }
  | { ok: false; code: "CONFIGURATION_UNAVAILABLE"; reasons: string[] };

/**
 * Resolve the persisted `cadence` value into the engine policy. Fails closed: any null, unknown or
 * inconsistent field yields `CONFIGURATION_UNAVAILABLE` with every reason, never a partial policy.
 */
export function resolveEnginePolicy(value: unknown): ResolveEnginePolicyResult {
  const parsed = cadenceConfigurationValueSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      code: "CONFIGURATION_UNAVAILABLE",
      reasons: parsed.error.issues.map((issue) => `cadence.${issue.path.join(".")}: ${issue.message}`),
    };
  }
  const reasons: string[] = [];
  for (const field of CADENCE_FIELDS) {
    if (parsed.data[field] === null) reasons.push(`cadence.${field}: missing (not installed)`);
  }
  if (reasons.length > 0) return { ok: false, code: "CONFIGURATION_UNAVAILABLE", reasons };
  const v = parsed.data as CadenceConfigurationValue;
  reasons.push(...crossFieldProblems(v));
  if (reasons.length > 0) return { ok: false, code: "CONFIGURATION_UNAVAILABLE", reasons };
  return { ok: true, policy: toEnginePolicy(v) };
}

function crossFieldProblems(v: CadenceConfigurationValue): string[] {
  const problems: string[] = [];
  const { opening_minute: open, closing_minute: close, weekdays } = v.working_days;
  if (open >= close) problems.push("cadence.working_days: opening_minute must be before closing_minute");
  if (new Set(weekdays).size !== weekdays.length) problems.push("cadence.working_days.weekdays: duplicates");
  if (new Set(v.holidays).size !== v.holidays.length) problems.push("cadence.holidays: duplicates");
  let expectedFirst = 1;
  v.new_call_slots.forEach((band, i) => {
    const last = i === v.new_call_slots.length - 1;
    if (band.first_day !== expectedFirst) problems.push(`cadence.new_call_slots[${i}]: bands must be contiguous from Day 1`);
    if (last && band.last_day !== null) problems.push(`cadence.new_call_slots[${i}]: last band must be open-ended`);
    if (!last && (band.last_day === null || band.last_day < band.first_day)) problems.push(`cadence.new_call_slots[${i}]: invalid last_day`);
    if (band.deadline_minutes.some((m, j) => j > 0 && m <= band.deadline_minutes[j - 1]!)) {
      problems.push(`cadence.new_call_slots[${i}].deadline_minutes: must be strictly ascending`);
    }
    if (band.deadline_minutes.some((m) => m <= open || m > close)) {
      problems.push(`cadence.new_call_slots[${i}].deadline_minutes: must fall within (opening, closing]`);
    }
    expectedFirst = (band.last_day ?? 0) + 1;
  });
  const firstBand = v.new_call_slots[0];
  if (firstBand && (firstBand.deadline_minutes.length !== v.new_days_1_3_calls.required_calls
    || firstBand.optional_extra_calls !== v.new_days_1_3_calls.optional_extra_calls)) {
    problems.push("cadence.new_days_1_3_calls: must match the Day 1 band of new_call_slots");
  }
  for (const [name, minute] of [
    ["sms_cutoff_minute", v.sms_cutoff_minute],
    ["quoted_due_minute", v.quoted_due_minute],
  ] as const) {
    if (minute <= open || minute > close) problems.push(`cadence.${name}: must fall within (opening, closing]`);
  }
  if (v.sms_mode.later_first_day <= Math.max(0, ...v.sms_mode.initial_days)) {
    problems.push("cadence.sms_mode.later_first_day: must follow the initial days");
  }
  return problems;
}

function toEnginePolicy(v: CadenceConfigurationValue): EnginePolicy {
  return {
    policy_version: v.policy_version,
    approval_ref: v.approval_ref,
    calendar: {
      timezone: v.timezone,
      working_weekdays: [...v.working_days.weekdays] as Weekday[],
      opening_minute: v.working_days.opening_minute,
      closing_minute: v.working_days.closing_minute,
      closed_dates: [...v.holidays].sort(),
    },
    new_cadence: {
      call_bands: v.new_call_slots.map((band) => ({ ...band, deadline_minutes: [...band.deadline_minutes] })),
      spacing_minutes: v.new_call_min_spacing_minutes,
      sms_initial_days: [...v.sms_mode.initial_days].sort((a, b) => a - b),
      sms_later_first_day: v.sms_mode.later_first_day,
      sms_later_interval_days: v.sms_mode.later_interval_days,
      sms_due_minute: v.sms_cutoff_minute,
    },
    arrival: {
      initial_response_working_minutes: v.late_arrival_rule.initial_response_working_minutes,
      two_calls_before_minute: v.late_arrival_rule.two_calls_before_minute,
      one_call_through_minute: v.late_arrival_rule.one_call_through_minute,
      sms_through_minute: v.late_arrival_rule.sms_through_minute,
    },
    reentry: {
      two_calls_before_minute: v.return_to_new_mode.two_calls_before_minute,
      one_call_through_minute: v.return_to_new_mode.one_call_through_minute,
      sms_through_minute: v.return_to_new_mode.sms_through_minute,
    },
    quoted: {
      due_minute: v.quoted_due_minute,
      same_day_cutoff_minute: v.quoted_same_day_cutoff_minute,
      activation_call_through_minute: v.transition_day_rule.quoted_activation_call_through_minute,
    },
    callback: { window_minutes: v.callback_window_minutes },
    cooldown: { threshold: v.cooldown_warning_threshold, window_hours: v.cooldown_warning_hours },
  };
}
