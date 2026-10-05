/**
 * The approved FINAL-01 policy values (POLICY-APPROVAL.json, FINAL-POLICY-REVIEW.md, decision
 * fixtures) expressed in the `sales_outreach_configuration` encoding, plus the FAST-01 backfill
 * scope and the M1 roster/goals (FAST-TRACK.md).
 *
 * Only `ops/sales-outreach/install-approved-policy.ts` uses this, and it writes the result through
 * the same PATCH service path the Owner uses. The server never reads these constants: a missing or
 * invalid configuration still fails closed (they are not a runtime default).
 */
import { createHash } from "node:crypto";
import {
  salesOutreachConfigurationValueSchema,
  type SalesOutreachConfigurationValue,
} from "../../src/validation/v1/salesOutreach";

export const FINAL01_APPROVAL_REF = "owner-session-2026-10-03-FINAL-01";
export const FINAL01_POLICY_VERSION = "final-policy-2026-10-03-v1";

export const INSTALLABLE_CONTROLS = [
  "desk_enabled",
  "cadence_shadow_enabled",
  "cadence_enforcement_enabled",
  "rep_sms_capture_enabled",
  "goal_metrics_enabled",
] as const;
export type InstallableControl = (typeof INSTALLABLE_CONTROLS)[number];

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** FINAL-01 cadence (P01–P06f, P10a), each value traced to its decision. */
export const FINAL01_CADENCE: SalesOutreachConfigurationValue["cadence"] = {
  policy_version: FINAL01_POLICY_VERSION,
  approval_ref: FINAL01_APPROVAL_REF,
  timezone: "America/New_York",
  calendar_mode: "new_york_calendar_date", // P02a
  working_days: ALL_WEEKDAYS.map((iso_weekday) => ({ iso_weekday, open_minute: 480, close_minute: 1200 })), // P02b/P02c [08:00,20:00)
  holidays: [], // P02i: no automatic holidays, initially no closed dates
  initial_response_working_minutes: 30, // P02d
  new_days_1_3_calls: { required: 2, optional: 1 }, // P01
  new_call_slots: [
    { from_day: 1, to_day: 5, deadline_minutes: [720, 1200] }, // P02f: 12:00 and 20:00
    { from_day: 6, to_day: null, deadline_minutes: [1200] }, // P02f: Day 6 onward one by 20:00
  ],
  new_call_min_spacing_minutes: 60, // P02e
  sms_cutoff_minute: 1200, // P02h
  sms_mode: "fixed_sequence", // P03
  sms_sequence: { initial_days: [1, 2, 3], repeat_from_day: 6, repeat_every_days: 3 }, // P03
  quoted_open_minute: 480, // P04a: selected dates open at 08:00
  quoted_due_minute: 1200, // P04a
  quoted_same_day_cutoff_minute: 1170, // P04c: today allowed through 19:30 inclusive
  return_to_new_mode: "original_age_partial_day", // P05a/P05f
  late_arrival_rule: { two_calls_before_minute: 1080, one_call_through_minute: 1170, sms_through_minute: 1170 }, // P02g/P02h
  catchup_mode: "one_per_channel", // P06a
  restriction_clock_rule: "waive_pause_resume_next_working_date", // P06c
  callback_window_minutes: 15, // P06e
  callback_mode: "explicit_human_appointment", // P06e
  cooldown_warning_threshold: 3, // P06b
  cooldown_warning_hours: 24, // P06b
  cooldown_mode: "advisory_warning", // P06b
  assignment_timeline_rule: "continuous_timeline", // P06d
  intake_default_rule: { website_form: "new", best_relocation: "new", ringcentral_call: "new", manual: "new", granot_created: "review" }, // P05e
  uncertain_priority_rule: "retain_last_verified", // P05e
  priority_map: {
    codes: [
      { code: "0", workflow: "new", closure_reason: null },
      { code: "1", workflow: "quoted", closure_reason: null },
      { code: "3", workflow: "discretion", closure_reason: null },
      { code: "5", workflow: "closed", closure_reason: "granot_booked" },
      { code: "7", workflow: "closed", closure_reason: "crm_bad_disposition" },
      { code: "8", workflow: "closed", closure_reason: "crm_dead_disposition" },
    ],
    unmapped_workflow: "none",
    official_booking_workflow: "closed",
  }, // P05c/P05d
  transition_day_rule: "partial_day_allowance", // P05f/P10a
  move_date_rule: "review_label_only", // P05g
  lead_eligibility_rule: "no_sync_viable_duplicates_excluded", // P05h
  precedence_rule: "closure_restriction_schedule_priority", // P06f
};

/** FINAL-01 evidence rules (P07a–P07g, IMPL-06). */
export function final01Evidence(rosterVersion: string): SalesOutreachConfigurationValue["evidence"] {
  return {
    qualifying_call_rule: "terminal_call_log_attempt",
    goal_rep_rule: "reviewed_initiator_only",
    helping_rep_rule: "reviewed_helper_cadence_only",
    sms_success_rule: "sent_or_delivered",
    sms_failure_correction_rule: "revoke_on_confirmed_failure",
    roster_version: rosterVersion,
    event_time_rule: "outbound_start_inbound_handled_sms_sent",
    operating_window_rule: "goal_full_date_cadence_open_hours",
    originating_inbound_rule: "unique_association_initial_response",
    restricted_contact_rule: "history_only_zero_credit",
  };
}

/** Stable roster version for a set of agents installed on a date. */
export function rosterVersionFor(agentIds: readonly string[], installedOn: string): string {
  const digest = createHash("sha256").update([...agentIds].sort().join(",")).digest("hex").slice(0, 10);
  return `roster-${installedOn}-${digest}`;
}

/**
 * The full value to install: FINAL-01 cadence/evidence, the M1 roster (every reviewed `sales_rep`
 * link, scheduled all seven days at the default goal 100, P08a/FAST-01), the FAST-01 backfill
 * scope (90 days + upcoming moves). Controls, migration pacing, intake gate fields and existing
 * day overrides are carried over from the current value; only `enableControls` are switched on.
 */
export function buildFinal01Configuration(input: {
  current: SalesOutreachConfigurationValue;
  rosterAgentIds: readonly string[];
  installedOn: string;
  enableControls?: readonly InstallableControl[];
  /** `--migration-paused=<bool>`: switches enrollment pacing; omitted = carried over (FAST-TRACK step 6). */
  migrationPaused?: boolean;
  /** `--intake-admission-at=<instant>`: opens prospective intake from that instant (P10b gate); omitted = carried over. */
  intakeAdmissionAt?: Date;
}): SalesOutreachConfigurationValue {
  const agents = [...new Set(input.rosterAgentIds.map((id) => id.toLowerCase()))].sort();
  const rosterVersion = rosterVersionFor(agents, input.installedOn);
  const controls = { ...input.current.controls };
  for (const control of input.enableControls ?? []) controls[control] = true;
  const keptOverrides = (input.current.goals.effective_day_overrides ?? []).filter((o) => agents.includes(o.agent_id));
  return salesOutreachConfigurationValueSchema.parse({
    controls,
    transition: {
      ...input.current.transition,
      backfill_lookback_days: 90,
      backfill_include_upcoming_moves: true,
      ...(input.intakeAdmissionAt ? { intake_admission_enabled: true, intake_admission_at: input.intakeAdmissionAt.toISOString() } : {}),
    },
    cadence: FINAL01_CADENCE,
    evidence: final01Evidence(rosterVersion),
    migration: input.migrationPaused === undefined ? input.current.migration : { ...input.current.migration, paused: input.migrationPaused },
    goals: {
      roster_version: rosterVersion,
      rep_work_schedules: agents.map((agent_id) => ({ agent_id, working_days: ALL_WEEKDAYS, scheduled_goal: null })),
      default_scheduled_goal: 100,
      effective_day_overrides: keptOverrides,
      zero_goal_rule: "no_goal_today_excluded_from_denominator",
    },
  });
}

export type InstallArgs = {
  target: string;
  apply: boolean;
  enableControls: InstallableControl[];
  /** Present only when `--migration-paused=true|false` was given. */
  migrationPaused?: boolean;
  /** Present only when `--intake-admission-at=<ISO instant|now>` was given. */
  intakeAdmissionAt?: Date;
};

/**
 * `--target=<database>` is required; dry run unless `--apply`. `--enable=desk_enabled,goal_metrics_enabled`
 * switches listed controls on in the same version; `--migration-paused=false` unpauses enrollment (the
 * FAST-TRACK step-6 gate `apply` checks); `--intake-admission-at=<ISO instant|now>` opens prospective intake
 * (sets `transition.intake_admission_enabled` and `intake_admission_at`). Unknown flags are refused.
 */
export function parseInstallArgs(argv: readonly string[]): InstallArgs {
  let target: string | null = null;
  let apply = false;
  let enableControls: InstallableControl[] = [];
  let migrationPaused: boolean | undefined;
  let intakeAdmissionAt: Date | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg.startsWith("--enable=")) {
      const names = arg.slice("--enable=".length).split(",").map((v) => v.trim()).filter(Boolean);
      for (const name of names)
        if (!(INSTALLABLE_CONTROLS as readonly string[]).includes(name)) throw new Error(`Unknown control: ${name}`);
      enableControls = names as InstallableControl[];
    } else if (arg.startsWith("--migration-paused=")) {
      const raw = arg.slice("--migration-paused=".length).trim();
      if (raw !== "true" && raw !== "false") throw new Error(`--migration-paused must be true or false, got: ${raw}`);
      migrationPaused = raw === "true";
    } else if (arg.startsWith("--intake-admission-at=")) {
      const raw = arg.slice("--intake-admission-at=".length).trim();
      const at = raw === "now" ? new Date() : new Date(raw);
      if (!raw || Number.isNaN(at.getTime())) throw new Error(`--intake-admission-at must be an ISO instant or "now", got: ${raw}`);
      intakeAdmissionAt = at;
    } else if (arg === "--allow-schema-drift") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  return {
    target,
    apply,
    enableControls,
    ...(migrationPaused === undefined ? {} : { migrationPaused }),
    ...(intakeAdmissionAt === undefined ? {} : { intakeAdmissionAt }),
  };
}

/** Deterministic Idempotency-Key: a re-run after a lost response replays instead of writing twice. */
export function installIdempotencyKey(contentHash: string, expectedRevision: number): string {
  return `install-final01:${FINAL01_APPROVAL_REF}:${expectedRevision}:${contentHash.slice(0, 32)}`;
}
