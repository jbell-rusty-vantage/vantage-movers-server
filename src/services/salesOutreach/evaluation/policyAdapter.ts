import { createHash } from "node:crypto";
import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import {
  resolveEnginePolicy,
  stableStringify,
  type CadenceConfigurationValue,
  type EnginePolicy,
  type ResolveEnginePolicyResult,
  type Weekday,
} from "../engine";

/**
 * Adapter from the persisted `sales_outreach_configuration` cadence encoding (S1,
 * `validation/v1/salesOutreach.ts`) to the engine's `cadence` encoding (S2, `engine/policy.ts`), then
 * `resolveEnginePolicy`. CONTRACTS leaves both encodings to engineering; this is the one place they
 * meet. It never invents a value: a field the engine needs that the configuration cannot express, or
 * a configuration the engine cannot represent, fails closed with `CONFIGURATION_UNAVAILABLE` and a
 * reason (no defaults, no env fallback).
 */

type Cadence = SalesOutreachConfigurationValue["cadence"];

/** ISO weekday (1 = Monday … 7 = Sunday) → engine weekday. */
const ISO_WEEKDAYS: Readonly<Record<number, Weekday>> = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
  7: "sunday",
};

/** Days 1–3 carry the P01 optional extra call; later days carry none. */
const OPTIONAL_CALL_LAST_DAY = 3;

const unavailable = (reasons: string[]): ResolveEnginePolicyResult => ({ ok: false, code: "CONFIGURATION_UNAVAILABLE", reasons });

/**
 * Maps the stored cadence namespace to the engine encoding. Returns the reasons it cannot (every one).
 * Mapping notes (engineering-owned encodings, recorded in evidence/S1.md "Phase 4a"):
 * - `working_days` must share one opening/closing minute (the engine calendar is uniform per day);
 * - `quoted_open_minute` must equal that opening minute (the engine opens Quoted dates at opening);
 * - the P05f reentry thresholds are the P02g/P02h `late_arrival_rule` thresholds (identical approved values);
 * - the P10a Quoted activation-date cutoff is `quoted_same_day_cutoff_minute` (both "through 19:30");
 * - `new_call_slots` bands are split at Day 3/4 so only Days 1–3 carry `new_days_1_3_calls.optional`;
 * - `intake_default_rule`: native sources must be `new` (P05e); `granot_created` passes through as
 *   `review` or `new` (olr B3). The engine policy does not carry it, so neither value changes the
 *   policy or its fingerprint.
 */
export function toEngineCadence(cadence: Cadence): { ok: true; value: CadenceConfigurationValue } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const missing = (Object.entries(cadence) as Array<[string, unknown]>).filter(([, v]) => v === null).map(([k]) => `cadence.${k}: missing (not installed)`);
  if (missing.length) return { ok: false, reasons: missing };
  // Every field is present below (checked above); the non-null assertions restate that.
  const days = cadence.working_days!;
  const open = days[0]!.open_minute;
  const close = days[0]!.close_minute;
  if (days.some((d) => d.open_minute !== open || d.close_minute !== close))
    reasons.push("cadence.working_days: per-day hours differ; the engine calendar needs one opening and closing minute");
  if (cadence.quoted_open_minute !== open) reasons.push("cadence.quoted_open_minute: must equal the working-day opening minute");
  const intake = cadence.intake_default_rule!;
  // P05e approves only New for native intake; Granot-created missing priority may be review or new (olr B3).
  if ([intake.website_form, intake.best_relocation, intake.ringcentral_call, intake.manual].some((v) => v !== "new"))
    reasons.push("cadence.intake_default_rule: the engine encodes only native intake = new");
  const firstThree = cadence.new_days_1_3_calls!;
  const bands: CadenceConfigurationValue["new_call_slots"] = [];
  for (const band of cadence.new_call_slots!) {
    const coversOptional = band.from_day <= OPTIONAL_CALL_LAST_DAY;
    if (coversOptional && band.deadline_minutes.length !== firstThree.required)
      reasons.push(`cadence.new_call_slots: Days 1–3 must require exactly new_days_1_3_calls.required (${firstThree.required}) calls`);
    const splitsAtThree = coversOptional && (band.to_day === null || band.to_day > OPTIONAL_CALL_LAST_DAY);
    if (splitsAtThree) {
      bands.push({ first_day: band.from_day, last_day: OPTIONAL_CALL_LAST_DAY, deadline_minutes: [...band.deadline_minutes], optional_extra_calls: firstThree.optional });
      bands.push({ first_day: OPTIONAL_CALL_LAST_DAY + 1, last_day: band.to_day, deadline_minutes: [...band.deadline_minutes], optional_extra_calls: 0 });
    } else {
      bands.push({
        first_day: band.from_day,
        last_day: band.to_day,
        deadline_minutes: [...band.deadline_minutes],
        optional_extra_calls: coversOptional ? firstThree.optional : 0,
      });
    }
  }
  if (reasons.length) return { ok: false, reasons };
  const arrival = cadence.late_arrival_rule!;
  const sequence = cadence.sms_sequence!;
  return {
    ok: true,
    value: {
      policy_version: cadence.policy_version!,
      approval_ref: cadence.approval_ref!,
      timezone: cadence.timezone,
      calendar_mode: "fixed_weekly_hours",
      working_days: { weekdays: days.map((d) => ISO_WEEKDAYS[d.iso_weekday]!), opening_minute: open, closing_minute: close },
      holidays: [...cadence.holidays!],
      new_days_1_3_calls: { required_calls: firstThree.required, optional_extra_calls: firstThree.optional },
      new_call_slots: bands,
      new_call_min_spacing_minutes: cadence.new_call_min_spacing_minutes!,
      sms_cutoff_minute: cadence.sms_cutoff_minute!,
      sms_mode: {
        kind: "fixed_schedule_days",
        initial_days: [...sequence.initial_days],
        later_first_day: sequence.repeat_from_day,
        later_interval_days: sequence.repeat_every_days,
      },
      quoted_due_minute: cadence.quoted_due_minute!,
      quoted_same_day_cutoff_minute: cadence.quoted_same_day_cutoff_minute!,
      return_to_new_mode: { kind: "original_received_age", ...arrival },
      late_arrival_rule: { initial_response_working_minutes: cadence.initial_response_working_minutes!, ...arrival },
      catchup_mode: { kind: "bounded_one_per_channel" },
      restriction_clock_rule: { kind: "waive_and_resume_next_working_date", pause_initial_response: true },
      callback_window_minutes: cadence.callback_window_minutes!,
      callback_mode: { kind: "suspend_routine_calls_until_appointment" },
      cooldown_warning_threshold: cadence.cooldown_warning_threshold!,
      cooldown_warning_hours: cadence.cooldown_warning_hours!,
      cooldown_mode: "advisory",
      assignment_timeline_rule: "continuous",
      intake_default_rule: { native_intake: "new", granot_created_missing_priority: intake.granot_created },
      uncertain_priority_rule: "retain_last_verified",
      transition_day_rule: { kind: "prospective_partial_day", quoted_activation_call_through_minute: cadence.quoted_same_day_cutoff_minute! },
      move_date_rule: "review_label_only",
      lead_eligibility_rule: "p05h_no_sync_eligible",
      precedence_rule: ["authoritative_closure", "channel_restriction", "explicit_human_schedule", "accepted_priority_routine_cadence"],
    },
  };
}

/** The engine policy for the persisted configuration, or `CONFIGURATION_UNAVAILABLE` with every reason. */
export function deskEnginePolicy(value: SalesOutreachConfigurationValue): ResolveEnginePolicyResult {
  const mapped = toEngineCadence(value.cadence);
  if (!mapped.ok) return unavailable(mapped.reasons);
  return resolveEnginePolicy(mapped.value);
}

/**
 * Which projection exposure the controls select: enforcement wins when both are on; neither ⇒ null
 * (the evaluator does not run, IMPLEMENTATION-PLAN §6.2).
 */
export function cadenceExposureOf(controls: SalesOutreachConfigurationValue["controls"]): SalesOutreachCadenceExposure | null {
  if (controls.cadence_enforcement_enabled) return "enforcement";
  if (controls.cadence_shadow_enabled) return "shadow";
  return null;
}

/** Hash of the resolved policy and exposure: a change re-evaluates every projection (evaluation reconcile). */
export function policyFingerprint(policy: EnginePolicy, exposure: SalesOutreachCadenceExposure): string {
  return createHash("sha256").update(stableStringify({ policy, exposure })).digest("hex");
}
