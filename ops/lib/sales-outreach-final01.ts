/**
 * The approved FINAL-01 policy values (POLICY-APPROVAL.json, FINAL-POLICY-REVIEW.md, decision
 * fixtures) expressed in the `sales_outreach_configuration` encoding, plus the FAST-01 backfill
 * scope and the M1 roster/goals (FAST-TRACK.md).
 *
 * Only `ops/sales-outreach/install-approved-policy.ts` uses this, and it writes the result through
 * the same PATCH service path the Owner uses. The server never reads these constants: a missing or
 * invalid configuration still fails closed (they are not a runtime default).
 *
 * Drift guard (olr B5): once a policy is installed, the Owner may PATCH policy keys (cadence,
 * evidence, goals, backfill scope). A policy install refuses to overwrite such an edit
 * (`policyDrift`) unless `--force-policy`; control flips go through `--set-controls`
 * (`buildControlsChange`), which leaves every policy namespace byte-identical.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/services/durableWork/checksum";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
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

/** The root namespaces a policy install rebuilds; every other root namespace is carried over verbatim. */
export const POLICY_INSTALL_NAMESPACES = ["controls", "transition", "cadence", "evidence", "migration", "goals"] as const;

/**
 * Root namespaces outside `POLICY_INSTALL_NAMESPACES` (for example lane A's optional `operations`
 * tunables) whose value differs between `current` and `built`, by key union and canonical JSON.
 */
export function foreignNamespaceChanges(current: SalesOutreachConfigurationValue, built: SalesOutreachConfigurationValue): string[] {
  const owned = new Set<string>(POLICY_INSTALL_NAMESPACES);
  const before = current as Record<string, unknown>;
  const after = built as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !owned.has(key) && canonicalOf(before[key]) !== canonicalOf(after[key]))
    .sort();
}

/**
 * The full value to install: FINAL-01 cadence/evidence, the M1 roster (every reviewed `sales_rep`
 * link, scheduled all seven days at the default goal 100, P08a/FAST-01), the FAST-01 backfill
 * scope (90 days + upcoming moves). Controls, migration pacing, intake gate fields and existing
 * day overrides are carried over from the current value; only `enableControls` are switched on.
 * Root namespaces the installer does not own are carried over verbatim (re-verified on the result).
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
  // Keys FINAL-01 does not name (optional keys added after FINAL-01, at the root or inside a
  // namespace) are carried over, never dropped.
  const value = salesOutreachConfigurationValueSchema.parse({
    ...input.current,
    controls,
    transition: {
      ...input.current.transition,
      backfill_lookback_days: 90,
      backfill_include_upcoming_moves: true,
      ...(input.intakeAdmissionAt ? { intake_admission_enabled: true, intake_admission_at: input.intakeAdmissionAt.toISOString() } : {}),
    },
    cadence: { ...input.current.cadence, ...FINAL01_CADENCE },
    evidence: { ...input.current.evidence, ...final01Evidence(rosterVersion) },
    migration: input.migrationPaused === undefined ? input.current.migration : { ...input.current.migration, paused: input.migrationPaused },
    goals: {
      ...input.current.goals,
      roster_version: rosterVersion,
      rep_work_schedules: agents.map((agent_id) => ({ agent_id, working_days: ALL_WEEKDAYS, scheduled_goal: null })),
      default_scheduled_goal: 100,
      effective_day_overrides: keptOverrides,
      zero_goal_rule: "no_goal_today_excluded_from_denominator",
    },
  });
  const changed = foreignNamespaceChanges(input.current, value);
  if (changed.length) throw new Error(`A policy install would change namespaces it does not own: ${changed.join(", ")}`);
  return value;
}

export type InstallArgs = {
  target: string;
  apply: boolean;
  enableControls: InstallableControl[];
  /** `--disable=<controls>`: switches listed controls off; only with `--set-controls`. */
  disableControls: InstallableControl[];
  /** `--set-controls`: change controls / migration pacing / intake only; every policy namespace stays verbatim. */
  setControls: boolean;
  /** `--force-policy`: a policy install overwrites a stored policy that differs from FINAL-01. */
  forcePolicy: boolean;
  /** `--refresh-roster` (with `--set-controls`): add newly reviewed reps, keep existing rows and goals. */
  refreshRoster: boolean;
  /** `--drop-unreviewed` (with `--refresh-roster`): also remove roster agents no longer reviewed. */
  dropUnreviewed: boolean;
  /** Present only when `--migration-paused=true|false` was given. */
  migrationPaused?: boolean;
  /** Present only when `--intake-admission-at=<ISO instant|now>` was given. */
  intakeAdmissionAt?: Date;
  /** The `--intake-admission-at` value as typed (`now` stays `now`), echoed in refusal hints. */
  intakeAdmissionArg?: string;
};

/**
 * `--target=<database>` is required; dry run unless `--apply`. `--enable=desk_enabled,goal_metrics_enabled`
 * switches listed controls on in the same version; `--migration-paused=false` unpauses enrollment (the
 * FAST-TRACK step-6 gate `apply` checks); `--intake-admission-at=<ISO instant|now>` opens prospective intake
 * (sets `transition.intake_admission_enabled` and `intake_admission_at`). `--migration=running|paused` is an
 * alias of `--migration-paused` (S4 lane brief); the two spellings must agree when both are given. Unknown
 * flags and values are refused.
 *
 * Modes (olr B5): `--set-controls` changes only controls (`--enable`, `--disable`), migration pacing and
 * intake admission; `--refresh-roster` (and `--drop-unreviewed`) need it. `--force-policy` lets a policy
 * install overwrite a drifted policy and cannot be combined with `--set-controls`. Whether the switch
 * flags also need `--set-controls` depends on the stored value (`assertInstallMode`).
 */
export function parseInstallArgs(argv: readonly string[]): InstallArgs {
  let target: string | null = null;
  let apply = false;
  let enableControls: InstallableControl[] = [];
  let disableControls: InstallableControl[] = [];
  let setControls = false;
  let forcePolicy = false;
  let refreshRoster = false;
  let dropUnreviewed = false;
  let migrationPaused: boolean | undefined;
  let intakeAdmissionAt: Date | undefined;
  let intakeAdmissionArg: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg.startsWith("--enable=")) enableControls = parseControls(arg.slice("--enable=".length));
    else if (arg.startsWith("--disable=")) disableControls = parseControls(arg.slice("--disable=".length));
    else if (arg === "--set-controls") setControls = true;
    else if (arg === "--force-policy") forcePolicy = true;
    else if (arg === "--refresh-roster") refreshRoster = true;
    else if (arg === "--drop-unreviewed") dropUnreviewed = true;
    else if (arg.startsWith("--migration-paused=")) {
      const raw = arg.slice("--migration-paused=".length).trim();
      if (raw !== "true" && raw !== "false") throw new Error(`--migration-paused must be true or false, got: ${raw}`);
      migrationPaused = setMigrationPaused(migrationPaused, raw === "true");
    } else if (arg.startsWith("--migration=")) {
      const raw = arg.slice("--migration=".length).trim();
      if (raw !== "running" && raw !== "paused") throw new Error(`--migration must be running or paused, got: ${raw}`);
      migrationPaused = setMigrationPaused(migrationPaused, raw === "paused");
    } else if (arg.startsWith("--intake-admission-at=")) {
      const raw = arg.slice("--intake-admission-at=".length).trim();
      const at = raw === "now" ? new Date() : new Date(raw);
      if (!raw || Number.isNaN(at.getTime())) throw new Error(`--intake-admission-at must be an ISO instant or "now", got: ${raw}`);
      intakeAdmissionAt = at;
      intakeAdmissionArg = raw;
    } else if (arg === "--allow-schema-drift") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  if (forcePolicy && setControls) throw new Error("--force-policy and --set-controls are mutually exclusive");
  if (disableControls.length && !setControls) throw new Error("--disable requires --set-controls");
  if (refreshRoster && !setControls) throw new Error("--refresh-roster requires --set-controls");
  if (dropUnreviewed && !refreshRoster) throw new Error("--drop-unreviewed requires --refresh-roster");
  const both = enableControls.filter((c) => disableControls.includes(c));
  if (both.length) throw new Error(`Controls both enabled and disabled: ${both.join(",")}`);
  return {
    target,
    apply,
    enableControls,
    disableControls,
    setControls,
    forcePolicy,
    refreshRoster,
    dropUnreviewed,
    ...(migrationPaused === undefined ? {} : { migrationPaused }),
    ...(intakeAdmissionAt === undefined ? {} : { intakeAdmissionAt, intakeAdmissionArg }),
  };
}

function parseControls(raw: string): InstallableControl[] {
  const names = raw.split(",").map((v) => v.trim()).filter(Boolean);
  for (const name of names)
    if (!(INSTALLABLE_CONTROLS as readonly string[]).includes(name)) throw new Error(`Unknown control: ${name}`);
  return [...new Set(names)] as InstallableControl[];
}

function setMigrationPaused(previous: boolean | undefined, next: boolean): boolean {
  if (previous !== undefined && previous !== next) throw new Error("--migration-paused and --migration disagree");
  return next;
}

/** Deterministic Idempotency-Key: a re-run after a lost response replays instead of writing twice. */
export function installIdempotencyKey(contentHash: string, expectedRevision: number): string {
  return `install-final01:${FINAL01_APPROVAL_REF}:${expectedRevision}:${contentHash.slice(0, 32)}`;
}

/** Same scheme as `installIdempotencyKey` for a `--set-controls` write (its own key prefix). */
export function setControlsIdempotencyKey(contentHash: string, expectedRevision: number): string {
  return `set-controls:${expectedRevision}:${contentHash.slice(0, 32)}`;
}

// ---------------------------------------------------------------------------------------------
// Drift guard and control-only changes (olr B5)
// ---------------------------------------------------------------------------------------------

/** One policy key whose stored value differs from what a FINAL-01 policy install would write. */
export type PolicyDrift = { path: string; current: unknown; installer: unknown };

/** Shown in a drift row for a key that one side does not carry. */
export const ABSENT_KEY = "(absent)";

/** A value carries an installed policy once `cadence.policy_version` is set; the bootstrap value has none. */
export function policyInstalled(value: SalesOutreachConfigurationValue): boolean {
  return value.cadence.policy_version !== null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Canonical JSON with `undefined` (an absent optional key) dropped, as the stored document has it. */
function canonicalOf(value: unknown): string {
  return value === undefined ? ABSENT_KEY : canonicalJson(JSON.parse(JSON.stringify(value)));
}

/** Objects recurse key by key (union of both sides); arrays and scalars compare whole. */
function diffInto(out: PolicyDrift[], path: string, current: unknown, installer: unknown): void {
  if (isPlainObject(current) && isPlainObject(installer)) {
    const keys = [...new Set([...Object.keys(current), ...Object.keys(installer)])].sort();
    for (const key of keys) diffInto(out, `${path}.${key}`, current[key], installer[key]);
    return;
  }
  if (canonicalOf(current) === canonicalOf(installer)) return;
  out.push({ path, current: current === undefined ? ABSENT_KEY : current, installer: installer === undefined ? ABSENT_KEY : installer });
}

function withoutRosterVersion(evidence: SalesOutreachConfigurationValue["evidence"]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...evidence };
  delete copy.roster_version;
  return copy;
}

/**
 * The policy keys a policy install would overwrite with a different value: every `cadence` key,
 * `evidence` except `roster_version`, the FAST-01 backfill scope, the default goal and zero-goal
 * rule, and `working_days`/`scheduled_goal` of every agent on both rosters. A bootstrap value
 * (no installed policy) has no drift. Roster membership changes are not drift: they are what a
 * re-install is for.
 */
export function policyDrift(current: SalesOutreachConfigurationValue, built: SalesOutreachConfigurationValue): PolicyDrift[] {
  if (!policyInstalled(current)) return [];
  const drift: PolicyDrift[] = [];
  diffInto(drift, "cadence", current.cadence, built.cadence);
  diffInto(drift, "evidence", withoutRosterVersion(current.evidence), withoutRosterVersion(built.evidence));
  for (const key of ["backfill_lookback_days", "backfill_include_upcoming_moves"] as const)
    diffInto(drift, `transition.${key}`, current.transition[key], built.transition[key]);
  for (const key of ["default_scheduled_goal", "zero_goal_rule"] as const) diffInto(drift, `goals.${key}`, current.goals[key], built.goals[key]);
  const builtRows = new Map((built.goals.rep_work_schedules ?? []).map((row) => [row.agent_id, row]));
  for (const row of current.goals.rep_work_schedules ?? []) {
    const installer = builtRows.get(row.agent_id);
    if (!installer) continue;
    diffInto(drift, `goals.rep_work_schedules[${row.agent_id}].working_days`, row.working_days, installer.working_days);
    diffInto(drift, `goals.rep_work_schedules[${row.agent_id}].scheduled_goal`, row.scheduled_goal, installer.scheduled_goal);
  }
  return drift;
}

/** Everything a `--set-controls` write must leave untouched, as canonical JSON. */
function outsideControls(value: SalesOutreachConfigurationValue): string {
  const migration: Record<string, unknown> = { ...value.migration };
  delete migration.paused;
  const transition: Record<string, unknown> = { ...value.transition };
  delete transition.intake_admission_enabled;
  delete transition.intake_admission_at;
  // Every root namespace except controls, so namespaces the installer does not own are covered too.
  const rest: Record<string, unknown> = { ...value, transition, migration };
  delete rest.controls;
  return canonicalOf(rest);
}

/**
 * `--set-controls`: `current` with only the listed controls switched, and (when given) migration
 * pacing and the intake admission instant. Cadence, evidence, goals and the rest of transition and
 * migration stay byte-identical; that is re-verified on the result before it is returned.
 */
export function buildControlsChange(input: {
  current: SalesOutreachConfigurationValue;
  enable?: readonly InstallableControl[];
  disable?: readonly InstallableControl[];
  migrationPaused?: boolean;
  intakeAdmissionAt?: Date;
}): SalesOutreachConfigurationValue {
  const { current } = input;
  const controls = { ...current.controls };
  for (const control of input.enable ?? []) controls[control] = true;
  for (const control of input.disable ?? []) controls[control] = false;
  const value = salesOutreachConfigurationValueSchema.parse({
    ...current,
    controls,
    migration: input.migrationPaused === undefined ? current.migration : { ...current.migration, paused: input.migrationPaused },
    transition: input.intakeAdmissionAt
      ? { ...current.transition, intake_admission_enabled: true, intake_admission_at: input.intakeAdmissionAt.toISOString() }
      : current.transition,
  });
  if (outsideControls(value) !== outsideControls(current))
    throw new Error("--set-controls would change more than controls, migration.paused and intake admission");
  return value;
}

export type RosterRefresh = { added: string[]; unreviewed: string[]; dropped: string[] };

/**
 * `--refresh-roster`: add reviewed `sales_rep` agents missing from the roster (all seven days,
 * default goal), keep every existing row with its goals, and list rostered agents who are no
 * longer reviewed; they are removed (with their day overrides) only with `dropUnreviewed`. When
 * membership changes, `goals.roster_version` and `evidence.roster_version` move together;
 * otherwise `current` is returned unchanged.
 */
export function refreshRoster(input: {
  current: SalesOutreachConfigurationValue;
  reviewedAgentIds: readonly string[];
  installedOn: string;
  dropUnreviewed: boolean;
}): { value: SalesOutreachConfigurationValue } & RosterRefresh {
  const { current } = input;
  const reviewed = new Set(input.reviewedAgentIds.map((id) => id.toLowerCase()));
  const rows = current.goals.rep_work_schedules ?? [];
  const onRoster = new Set(rows.map((row) => row.agent_id));
  const added = [...reviewed].filter((id) => !onRoster.has(id)).sort();
  const unreviewed = rows.map((row) => row.agent_id).filter((id) => !reviewed.has(id)).sort();
  const dropped = input.dropUnreviewed ? unreviewed : [];
  if (!added.length && !dropped.length) return { value: current, added, unreviewed, dropped };
  const nextRows = [
    ...rows.filter((row) => !dropped.includes(row.agent_id)),
    ...added.map((agent_id) => ({ agent_id, working_days: ALL_WEEKDAYS, scheduled_goal: null })),
  ];
  const rosterVersion = rosterVersionFor(nextRows.map((row) => row.agent_id), input.installedOn);
  const overrides = current.goals.effective_day_overrides;
  const value = salesOutreachConfigurationValueSchema.parse({
    ...current,
    evidence: { ...current.evidence, roster_version: rosterVersion },
    goals: {
      ...current.goals,
      roster_version: rosterVersion,
      rep_work_schedules: nextRows,
      effective_day_overrides: overrides === null ? null : overrides.filter((o) => !dropped.includes(o.agent_id)),
    },
  });
  return { value, added, unreviewed, dropped };
}

/**
 * Refuses flag combinations that do not fit the stored value. Once a policy is installed, control,
 * migration and intake flips no longer ride a policy install: they need `--set-controls`. A
 * `--set-controls` run needs an installed policy.
 */
export function assertInstallMode(args: InstallArgs, current: SalesOutreachConfigurationValue): void {
  const installed = policyInstalled(current);
  if (args.setControls && !installed)
    throw new Error("--set-controls needs an installed policy; run the policy install (without --set-controls) first");
  if (args.setControls || !installed) return;
  const switches = [
    args.enableControls.length ? `--enable=${args.enableControls.join(",")}` : null,
    args.migrationPaused === undefined ? null : `--migration-paused=${args.migrationPaused}`,
    // Echo the value as typed: a resolved `now` would pin the suggested command to this run's instant.
    args.intakeAdmissionAt === undefined ? null : `--intake-admission-at=${args.intakeAdmissionArg ?? args.intakeAdmissionAt.toISOString()}`,
  ].filter((flag): flag is string => flag !== null);
  if (switches.length)
    throw new Error(
      `${switches.join(" ")} requires --set-controls on an installed policy (a policy install no longer flips switches). ` +
        `Run: pnpm outreach:install-policy --target=${args.target} --set-controls ${switches.join(" ")}`,
    );
}

export type InstallPlan =
  | { kind: "refused"; refused: "policy_drift"; drift: PolicyDrift[]; hint: string }
  | {
      kind: "write";
      mode: "policy_install" | "set_controls";
      value: SalesOutreachConfigurationValue;
      content_hash: string;
      idempotency_key: string;
      /** CSI operator request id for the PATCH actor. */
      request_id: string;
      /** Drift a `--force-policy` install overwrites (empty otherwise). */
      drift: PolicyDrift[];
      forced: boolean;
      roster: RosterRefresh | null;
    };

/**
 * What one installer run would write, decided from the stored value only (no I/O):
 * - `--set-controls`: `buildControlsChange` (after `refreshRoster` when asked);
 * - otherwise a FINAL-01 policy install, refused with `policy_drift` when the stored policy
 *   differs from FINAL-01, unless `--force-policy`.
 */
export function planInstall(input: {
  args: InstallArgs;
  current: SalesOutreachConfigurationValue;
  expectedRevision: number;
  reviewedAgentIds: readonly string[];
  installedOn: string;
}): InstallPlan {
  const { args, current } = input;
  assertInstallMode(args, current);
  if (args.setControls) {
    const refreshed = args.refreshRoster
      ? refreshRoster({ current, reviewedAgentIds: input.reviewedAgentIds, installedOn: input.installedOn, dropUnreviewed: args.dropUnreviewed })
      : null;
    const value = buildControlsChange({
      current: refreshed?.value ?? current,
      enable: args.enableControls,
      disable: args.disableControls,
      migrationPaused: args.migrationPaused,
      intakeAdmissionAt: args.intakeAdmissionAt,
    });
    const content_hash = configurationContentHash(value);
    return {
      kind: "write",
      mode: "set_controls",
      value,
      content_hash,
      idempotency_key: setControlsIdempotencyKey(content_hash, input.expectedRevision),
      request_id: `sod-set-controls-${content_hash.slice(0, 16)}`,
      drift: [],
      forced: false,
      roster: refreshed && { added: refreshed.added, unreviewed: refreshed.unreviewed, dropped: refreshed.dropped },
    };
  }
  const value = buildFinal01Configuration({
    current,
    rosterAgentIds: input.reviewedAgentIds,
    installedOn: input.installedOn,
    enableControls: args.enableControls,
    migrationPaused: args.migrationPaused,
    intakeAdmissionAt: args.intakeAdmissionAt,
  });
  const drift = policyDrift(current, value);
  if (drift.length && !args.forcePolicy)
    return {
      kind: "refused",
      refused: "policy_drift",
      drift,
      hint: "The stored policy differs from FINAL-01 (an Owner edit). Nothing was written. Use --set-controls to flip controls without touching policy, or --force-policy to overwrite the listed keys with FINAL-01.",
    };
  const content_hash = configurationContentHash(value);
  return {
    kind: "write",
    mode: "policy_install",
    value,
    content_hash,
    idempotency_key: installIdempotencyKey(content_hash, input.expectedRevision),
    request_id: `sod-install-final01-${content_hash.slice(0, 16)}`,
    drift,
    forced: drift.length > 0,
    roster: null,
  };
}
