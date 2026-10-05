/**
 * FINAL-01 approved starting `cadence` values (FINAL-POLICY-REVIEW, SPECIFICATION §9.4/§10/§11,
 * decisions P01–P10a) in the engine/policy.ts encoding.
 *
 * This is an INSTALL PAYLOAD, not a default. Runtime code never imports it: the engine reads only the
 * persisted, versioned `sales_outreach_configuration` pointer and fails closed when it is missing.
 * Consumers: S1's `ops/sales-outreach/install-approved-policy.ts` (writes it through the audited PATCH
 * path with `approval_ref`) and the engine's fixture tests.
 */
import type { CadenceConfigurationValue } from "./policy";

export const FINAL_01_APPROVAL_REF = "FINAL-01" as const;

export const FINAL_01_CADENCE_VALUE: CadenceConfigurationValue = {
  policy_version: "sod-cadence-final-01",
  approval_ref: FINAL_01_APPROVAL_REF,
  timezone: "America/New_York",
  calendar_mode: "fixed_weekly_hours",
  // P02b/P02c: Monday–Sunday, [08:00, 20:00).
  working_days: {
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    opening_minute: 480,
    closing_minute: 1200,
  },
  // P02i: no automatic holidays, initially no closed dates.
  holidays: [],
  // P01: Days 1–3 two required, optional third.
  new_days_1_3_calls: { required_calls: 2, optional_extra_calls: 1 },
  // P02f: Days 1–5 first by 12:00, second by 20:00; Day 6+ one by 20:00.
  new_call_slots: [
    { first_day: 1, last_day: 3, deadline_minutes: [720, 1200], optional_extra_calls: 1 },
    { first_day: 4, last_day: 5, deadline_minutes: [720, 1200], optional_extra_calls: 0 },
    { first_day: 6, last_day: null, deadline_minutes: [1200], optional_extra_calls: 0 },
  ],
  // P02e: 60 elapsed minutes between cadence-credited call starts.
  new_call_min_spacing_minutes: 60,
  // P02h: SMS due 20:00.
  sms_cutoff_minute: 1200,
  // P03: fixed Days 1/2/3 then 6, 9, 12…
  sms_mode: { kind: "fixed_schedule_days", initial_days: [1, 2, 3], later_first_day: 6, later_interval_days: 3 },
  // P04a/P04c: Quoted due 20:00; today selectable through 19:30 inclusive.
  quoted_due_minute: 1200,
  quoted_same_day_cutoff_minute: 1170,
  // P05a/P05f: original received-date age; return before 18:00 ≤2, through 19:30 ≤1, later 0.
  return_to_new_mode: { kind: "original_received_age", two_calls_before_minute: 1080, one_call_through_minute: 1170, sms_through_minute: 1170 },
  // P02d/P02g/P02h: 30 working minutes; arrival before 18:00 two calls, through 19:30 one; SMS through 19:30.
  late_arrival_rule: { initial_response_working_minutes: 30, two_calls_before_minute: 1080, one_call_through_minute: 1170, sms_through_minute: 1170 },
  // P06a.
  catchup_mode: { kind: "bounded_one_per_channel" },
  // P06c.
  restriction_clock_rule: { kind: "waive_and_resume_next_working_date", pause_initial_response: true },
  // P06e: 15 elapsed minutes.
  callback_window_minutes: 15,
  callback_mode: { kind: "suspend_routine_calls_until_appointment" },
  // P06b: three unsuccessful attempts in rolling 24 hours, advisory only.
  cooldown_warning_threshold: 3,
  cooldown_warning_hours: 24,
  cooldown_mode: "advisory",
  // P06d.
  assignment_timeline_rule: "continuous",
  // P05e.
  intake_default_rule: { native_intake: "new", granot_created_missing_priority: "review" },
  uncertain_priority_rule: "retain_last_verified",
  // P10a: an already-active Quoted schedule owes one activation-date call through 19:30.
  transition_day_rule: { kind: "prospective_partial_day", quoted_activation_call_through_minute: 1170 },
  // P05g / P05h / P06f.
  move_date_rule: "review_label_only",
  lead_eligibility_rule: "p05h_no_sync_eligible",
  precedence_rule: ["authoritative_closure", "channel_restriction", "explicit_human_schedule", "accepted_priority_routine_cadence"],
};
