import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { patchSalesOutreachConfiguration } from "../../src/services/salesOutreach/config/commands";
import { createConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { configurationActivationBlockers } from "../../src/services/salesOutreach/config/reads";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { MemoryConfigurationDb } from "../../src/services/salesOutreach/config/testing";
import { FINAL_01_CADENCE_VALUE } from "../../src/services/salesOutreach/engine/approvedStartingValues";
import { resolveEnginePolicy } from "../../src/services/salesOutreach/engine";
import { deskEnginePolicy } from "../../src/services/salesOutreach/evaluation/policyAdapter";
import { TEST_FINAL01_CADENCE } from "../../src/services/salesOutreach/evaluation/testing";
import { canonicalJson } from "../../src/services/durableWork/checksum";
import { salesOutreachConfigurationValueSchema, type SalesOutreachConfigurationValue } from "../../src/validation/v1/salesOutreach";
import {
  ABSENT_KEY,
  buildControlsChange,
  buildFinal01Configuration,
  FINAL01_APPROVAL_REF,
  FINAL01_POLICY_VERSION,
  installIdempotencyKey,
  parseInstallArgs,
  planInstall,
  policyDrift,
  policyInstalled,
} from "./sales-outreach-final01";

const packet = (path: string) => JSON.parse(readFileSync(resolve(__dirname, "../../docs/sales-outreach-desk", path), "utf8")) as Record<string, unknown>;
const fixture = (name: string) => packet(`contracts/fixtures/${name}`);
const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const bootstrap = () => salesOutreachConfigurationValueSchema.parse({});
/** parseInstallArgs output fields for a run without mode flags. */
const NO_MODE = { enableControls: [], disableControls: [], setControls: false, forcePolicy: false, refreshRoster: false, dropUnreviewed: false };

test("FINAL-01 install values match POLICY-APPROVAL.json and the decision fixtures", () => {
  const approval = packet("POLICY-APPROVAL.json");
  assert.equal(FINAL01_APPROVAL_REF, approval.approval_ref);
  assert.equal(FINAL01_POLICY_VERSION, approval.policy_revision);
  const value = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [A], installedOn: "2026-10-04" });
  const { cadence } = value;
  const hours = fixture("p02c-working-hours.json");
  assert.deepEqual(cadence.working_days?.map((d) => d.iso_weekday), [1, 2, 3, 4, 5, 6, 7]); // P02b Monday–Sunday
  for (const day of cadence.working_days!) assert.deepEqual([day.open_minute, day.close_minute], [hours.opening_minute, hours.closing_minute]);
  assert.equal(cadence.initial_response_working_minutes, fixture("p02d-first-call-deadline.json").first_call_working_minutes);
  assert.equal(cadence.new_call_min_spacing_minutes, fixture("p02e-call-spacing.json").initial_spacing_minutes);
  const deadlines = fixture("p02f-new-daily-deadlines.json");
  assert.deepEqual(cadence.new_call_slots?.[0]?.deadline_minutes, deadlines.two_call_deadline_minutes);
  assert.deepEqual(cadence.new_call_slots?.[1]?.deadline_minutes, [deadlines.one_call_deadline_minute]);
  const arrival = fixture("p02g-arrival-day-calls.json");
  assert.equal(cadence.late_arrival_rule?.two_calls_before_minute, arrival.two_calls_before_minute);
  assert.equal(cadence.late_arrival_rule?.one_call_through_minute, arrival.one_call_through_minute_inclusive);
  const sms = fixture("p02h-sms-deadline-allowance.json");
  assert.equal(cadence.sms_cutoff_minute, sms.sms_cutoff_minute);
  assert.equal(cadence.late_arrival_rule?.sms_through_minute, sms.arrival_threshold_minute_inclusive);
  const fixed = fixture("p03-fixed-sms.json");
  assert.deepEqual(cadence.sms_sequence, { initial_days: fixed.initial_days, repeat_from_day: fixed.later_first_day, repeat_every_days: fixed.later_interval_days });
  assert.equal(cadence.quoted_due_minute, fixture("p04a-quoted-deferral.json").quoted_due_minute);
  assert.equal(cadence.quoted_same_day_cutoff_minute, fixture("p04c-quoted-allowed-dates.json").quoted_same_day_cutoff_minute);
  const cooldown = fixture("p06b-advisory-cooldown.json");
  assert.deepEqual([cadence.cooldown_warning_threshold, cadence.cooldown_warning_hours], [cooldown.warning_threshold, cooldown.rolling_hours]);
  assert.equal(cadence.callback_window_minutes, fixture("p06e-explicit-callback.json").callback_window_elapsed_minutes);
  const known = fixture("p05d-priority-map-manager-read.json").known_priority_map as Record<string, string>;
  assert.deepEqual(cadence.priority_map?.codes.map((c) => c.code), Object.keys(known));
  assert.deepEqual(cadence.priority_map?.codes.slice(0, 3).map((c) => c.workflow), ["new", "quoted", "discretion"]);
  assert.ok(cadence.priority_map?.codes.slice(3).every((c) => c.workflow === "closed"));
  assert.equal(cadence.intake_default_rule?.granot_created, "review"); // P05e
  assert.equal(cadence.holidays?.length, 0); // P02i
  // Nothing required for activation is left null.
  assert.deepEqual(configurationActivationBlockers(value).filter((b) => b.endsWith("_incomplete")), []);
});

test("M1 roster/goals (P08a, FAST-01): every reviewed rep, all seven days, default goal 100; FAST-01 backfill scope", () => {
  const p08a = fixture("p08a-roster-goals.json");
  const value = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [B, A.toUpperCase(), A], installedOn: "2026-10-04" });
  assert.equal(value.goals.default_scheduled_goal, p08a.default_scheduled_day_goal);
  assert.deepEqual(value.goals.rep_work_schedules, [
    { agent_id: A, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: null },
    { agent_id: B, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: null },
  ]);
  assert.equal(value.goals.roster_version, value.evidence.roster_version);
  assert.match(value.goals.roster_version!, /^roster-2026-10-04-[0-9a-f]{10}$/);
  assert.equal(value.goals.zero_goal_rule, "no_goal_today_excluded_from_denominator");
  assert.deepEqual([value.transition.backfill_lookback_days, value.transition.backfill_include_upcoming_moves], [90, true]);
  // Controls stay as they are unless explicitly enabled.
  assert.equal(Object.values(value.controls).some(Boolean), false);
  const enabled = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [A], installedOn: "2026-10-04", enableControls: ["desk_enabled", "goal_metrics_enabled"] });
  assert.deepEqual([enabled.controls.desk_enabled, enabled.controls.goal_metrics_enabled, enabled.controls.cadence_enforcement_enabled], [true, true, false]);
  // Migration pacing is carried over unless the flag names it; only `paused` changes.
  assert.equal(value.migration.paused, true);
  const unpaused = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [A], installedOn: "2026-10-04", migrationPaused: false });
  assert.deepEqual({ ...unpaused.migration, paused: true }, bootstrap().migration);
  assert.equal(unpaused.migration.paused, false);
  assert.equal(value.transition.intake_admission_enabled, false);
  const opened = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [A], installedOn: "2026-10-04", intakeAdmissionAt: new Date("2026-10-05T18:00:00.000Z") });
  assert.deepEqual([opened.transition.intake_admission_enabled, opened.transition.intake_admission_at], [true, "2026-10-05T18:00:00.000Z"]);
});

test("the installer refuses unnamed targets and unknown controls", () => {
  assert.throws(() => parseInstallArgs([]), /--target/);
  assert.throws(() => parseInstallArgs(["--apply"]), /--target/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--enable=everything"]), /Unknown control/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--yes"]), /Unknown argument/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--migration-paused=no"]), /--migration-paused/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--intake-admission-at=yesterday"]), /--intake-admission-at/);
  assert.deepEqual(parseInstallArgs(["--target=vantagemovers", "--intake-admission-at=2026-10-05T18:00:00Z"]).intakeAdmissionAt, new Date("2026-10-05T18:00:00Z"));
  assert.deepEqual(parseInstallArgs(["--target=vantagemovers", "--apply", "--migration-paused=false"]), { ...NO_MODE, target: "vantagemovers", apply: true, migrationPaused: false });
  assert.deepEqual(parseInstallArgs(["--target=vantagemovers"]), { ...NO_MODE, target: "vantagemovers", apply: false });
  assert.deepEqual(parseInstallArgs(["--target=testvantagemovers", "--apply", "--enable=desk_enabled,goal_metrics_enabled"]), {
    ...NO_MODE,
    target: "testvantagemovers",
    apply: true,
    enableControls: ["desk_enabled", "goal_metrics_enabled"],
  });
});

test("--migration=running|paused (S4) is an alias of --migration-paused; values and disagreement are refused", () => {
  assert.deepEqual(parseInstallArgs(["--target=vantagemovers", "--migration=running"]), { ...NO_MODE, target: "vantagemovers", apply: false, migrationPaused: false });
  assert.equal(parseInstallArgs(["--target=vantagemovers", "--apply", "--migration=paused"]).migrationPaused, true);
  assert.equal(parseInstallArgs(["--target=vantagemovers", "--migration=running", "--migration-paused=false"]).migrationPaused, false);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--migration=running", "--migration-paused=true"]), /disagree/);
  for (const bad of ["--migration=", "--migration=resume", "--migration=false", "--migration=RUNNING"])
    assert.throws(() => parseInstallArgs(["--target=vantagemovers", bad]), /--migration must be/, bad);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--migration"]), /Unknown argument/);
});

/**
 * The installer script's decision and write path over an in-memory configuration store: inspect,
 * `planInstall`, then the same PATCH service call with the plan's Idempotency-Key. Returns the plan
 * and the write (null when refused, a dry run, or the content is already active).
 */
function installerOver(db: MemoryConfigurationDb) {
  const loader = createConfigurationLoader(db.store);
  return {
    loader,
    async run(argv: string[], options: { reviewed?: string[]; installedOn?: string } = {}) {
      const args = parseInstallArgs(["--target=testvantagemovers", ...argv]);
      const inspected = await loader.inspect();
      assert.notEqual(inspected.state, "unavailable");
      const current = inspected.state === "active" ? inspected.value : bootstrap();
      const expectedRevision = inspected.state === "active" ? inspected.revision : 0;
      const plan = planInstall({ args, current, expectedRevision, reviewedAgentIds: options.reviewed ?? [A], installedOn: options.installedOn ?? "2026-10-05" });
      if (plan.kind === "refused" || !args.apply) return { plan, write: null };
      if (inspected.state === "active" && inspected.content_hash === plan.content_hash) return { plan, write: null };
      const write = await patchSalesOutreachConfiguration(
        { actor: csiOperatorActor(plan.request_id), idempotency_key: plan.idempotency_key, expected_revision: expectedRevision, value: plan.value },
        db.deps(),
      );
      return { plan, write };
    },
    /** An Owner PATCH from Settings: GET, edit, PATCH with the read revision. */
    async ownerPatch(edit: (value: SalesOutreachConfigurationValue) => SalesOutreachConfigurationValue, key: string) {
      const active = await loader.requireActive();
      return patchSalesOutreachConfiguration(
        { actor: csiOperatorActor(`owner-${key}`), idempotency_key: key, expected_revision: active.revision, value: edit(structuredClone(active.value)) },
        db.deps(),
      );
    },
  };
}

/** Everything except controls, migration.paused and the intake admission fields, as canonical JSON. */
function policyPart(value: SalesOutreachConfigurationValue): string {
  const migration: Record<string, unknown> = { ...value.migration };
  delete migration.paused;
  const transition: Record<string, unknown> = { ...value.transition };
  delete transition.intake_admission_enabled;
  delete transition.intake_admission_at;
  return canonicalJson({ cadence: value.cadence, evidence: value.evidence, goals: value.goals, migration, transition });
}

test("unpausing through --set-controls: one new revision from the installed one, only migration.paused changes, idempotent", async () => {
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  assert.equal((await installer.run(["--apply"])).write?.response.revision, 1);
  const installed = await installer.loader.requireActive();
  assert.equal(installed.value.migration.paused, true, "the bootstrap default stays paused");
  assert.equal((await installer.run(["--apply", "--set-controls", "--migration=running"])).write?.response.revision, 2);
  const running = await installer.loader.requireActive();
  assert.deepEqual(running.value.migration, { ...installed.value.migration, paused: false });
  assert.equal((await installer.run(["--apply", "--set-controls", "--migration-paused=false"])).write, null, "re-running writes nothing");
  assert.equal((await installer.run(["--apply"])).write, null, "a policy install without flags keeps the installed state");
  assert.equal((await installer.run(["--apply", "--set-controls", "--migration=paused"])).write?.response.revision, 3);
});

test("B5: policy install refuses when the stored cadence differs (granot_created: new) and lists the paths; --force-policy writes", async () => {
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  await installer.run(["--apply", "--enable=desk_enabled,goal_metrics_enabled"]);
  // The Owner's D3 PATCH (revision N+1), plus a goal edit for one rep and a longer backfill scope.
  await installer.ownerPatch((value) => {
    value.cadence.intake_default_rule!.granot_created = "new";
    value.goals.rep_work_schedules![0]!.scheduled_goal = 40;
    value.transition.backfill_lookback_days = 120;
    return value;
  }, "owner-d3");
  const patched = await installer.loader.requireActive();
  assert.equal(patched.revision, 2);

  for (const argv of [[], ["--apply"]]) {
    const { plan, write } = await installer.run(argv);
    assert.equal(write, null, "nothing is written");
    assert.equal(plan.kind, "refused");
    if (plan.kind !== "refused") return;
    assert.equal(plan.refused, "policy_drift");
    assert.deepEqual(plan.drift, [
      { path: "cadence.intake_default_rule.granot_created", current: "new", installer: "review" },
      { path: "transition.backfill_lookback_days", current: 120, installer: 90 },
      { path: `goals.rep_work_schedules[${A}].scheduled_goal`, current: 40, installer: null },
    ]);
    assert.match(plan.hint, /--force-policy/);
  }
  const still = await installer.loader.requireActive();
  assert.deepEqual([still.revision, still.content_hash, db.versions.size], [2, patched.content_hash, 2], "the Owner's revision stays active");

  const forced = await installer.run(["--apply", "--force-policy"]);
  assert.equal(forced.plan.kind, "write");
  if (forced.plan.kind !== "write") return;
  assert.deepEqual([forced.plan.forced, forced.plan.drift.length], [true, 3]);
  assert.equal(forced.write?.response.revision, 3);
  const overwritten = await installer.loader.requireActive();
  assert.equal(overwritten.value.cadence.intake_default_rule?.granot_created, "review");
  assert.equal(overwritten.value.transition.backfill_lookback_days, 90);
  assert.deepEqual(overwritten.value.controls, patched.value.controls, "controls are carried over");
  // After the forced install the stored policy is FINAL-01 again: no drift.
  assert.equal((await installer.run([])).plan.kind, "write");
});

test("B5: drift covers every guarded namespace and ignores roster membership, evidence.roster_version and controls", () => {
  const installed = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [A, B], installedOn: "2026-10-05" });
  const rebuilt = (current: SalesOutreachConfigurationValue, agents = [A, B]) => buildFinal01Configuration({ current, rosterAgentIds: agents, installedOn: "2026-10-07" });
  assert.deepEqual(policyDrift(installed, rebuilt(installed)), [], "a re-install on another day is not drift (roster version only)");
  assert.deepEqual(policyDrift(installed, rebuilt(installed, [B, "c".repeat(24)])), [], "membership changes are not drift");
  const edited = structuredClone(installed);
  edited.controls.cadence_enforcement_enabled = false;
  edited.migration.paused = false;
  assert.deepEqual(policyDrift(edited, rebuilt(edited)), [], "controls and migration pacing are not policy");
  edited.cadence.priority_map!.codes = [...edited.cadence.priority_map!.codes, { code: "9", workflow: "closed", closure_reason: "crm_dead_disposition" }];
  edited.evidence.sms_success_rule = null;
  edited.goals.default_scheduled_goal = 80;
  edited.goals.rep_work_schedules![1]!.working_days = [1, 2, 3, 4, 5];
  edited.transition.backfill_include_upcoming_moves = false;
  const built = rebuilt(edited);
  assert.deepEqual(
    policyDrift(edited, built).map((d) => d.path),
    [
      "cadence.priority_map.codes",
      "evidence.sms_success_rule",
      "transition.backfill_include_upcoming_moves",
      "goals.default_scheduled_goal",
      `goals.rep_work_schedules[${B}].working_days`,
    ],
  );
  assert.equal(built.cadence.priority_map?.codes.length, 6, "the installer would have reverted the map");
});

test("B5: bootstrap has no drift", () => {
  const built = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [A], installedOn: "2026-10-05" });
  assert.equal(policyInstalled(bootstrap()), false);
  assert.deepEqual(policyDrift(bootstrap(), built), []);
  const plan = planInstall({ args: parseInstallArgs(["--target=testvantagemovers", "--enable=desk_enabled"]), current: bootstrap(), expectedRevision: 0, reviewedAgentIds: [A], installedOn: "2026-10-05" });
  assert.equal(plan.kind, "write", "the first install may still enable controls in the same version");
  if (plan.kind === "write") assert.deepEqual([plan.mode, plan.value.controls.desk_enabled, plan.forced], ["policy_install", true, false]);
});

test("B5: --set-controls flips only the listed controls and leaves cadence/evidence/goals/transition byte-identical", async () => {
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  await installer.run(["--apply", "--enable=desk_enabled"]);
  // An Owner policy edit must survive a control flip untouched.
  await installer.ownerPatch((value) => {
    value.cadence.intake_default_rule!.granot_created = "new";
    value.goals.rep_work_schedules![0]!.scheduled_goal = 40;
    return value;
  }, "owner-d3");
  const before = await installer.loader.requireActive();
  const { plan, write } = await installer.run(["--apply", "--set-controls", "--enable=goal_metrics_enabled,cadence_shadow_enabled"], { reviewed: [A, B], installedOn: "2026-10-09" });
  assert.equal(plan.kind, "write");
  if (plan.kind !== "write") return;
  assert.equal(plan.mode, "set_controls");
  assert.match(plan.idempotency_key, /^set-controls:2:[0-9a-f]{32}$/);
  assert.equal(plan.roster, null, "the roster is not refreshed without --refresh-roster");
  assert.equal(write?.response.revision, 3);
  const after = await installer.loader.requireActive();
  assert.deepEqual(after.value.controls, { ...before.value.controls, goal_metrics_enabled: true, cadence_shadow_enabled: true });
  assert.equal(policyPart(after.value), policyPart(before.value));
  assert.equal(canonicalJson(after.value.migration), canonicalJson(before.value.migration));
  assert.equal(canonicalJson(after.value.transition), canonicalJson(before.value.transition));
  assert.equal(after.value.cadence.intake_default_rule?.granot_created, "new");
  assert.equal(after.value.goals.rep_work_schedules?.[0]?.scheduled_goal, 40);
  // Intake admission is the other switch the mode may set.
  await installer.run(["--apply", "--set-controls", "--intake-admission-at=2026-10-09T12:00:00Z"]);
  const opened = await installer.loader.requireActive();
  assert.deepEqual([opened.value.transition.intake_admission_enabled, opened.value.transition.intake_admission_at], [true, "2026-10-09T12:00:00.000Z"]);
  assert.equal(policyPart(opened.value), policyPart(before.value));
});

test("B5: --disable turns a control off", async () => {
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  await installer.run(["--apply", "--enable=desk_enabled,goal_metrics_enabled,cadence_shadow_enabled,cadence_enforcement_enabled"]);
  const before = await installer.loader.requireActive();
  const { write } = await installer.run(["--apply", "--set-controls", "--disable=cadence_enforcement_enabled,cadence_shadow_enabled", "--enable=rep_sms_capture_enabled"]);
  assert.equal(write?.response.revision, 2);
  const after = await installer.loader.requireActive();
  assert.deepEqual(after.value.controls, {
    desk_enabled: true,
    goal_metrics_enabled: true,
    cadence_shadow_enabled: false,
    cadence_enforcement_enabled: false,
    rep_sms_capture_enabled: true,
  });
  assert.equal(policyPart(after.value), policyPart(before.value));
  // The pure builder: disabling an already-off control is a no-op on the value.
  assert.equal(canonicalJson(buildControlsChange({ current: after.value, disable: ["cadence_enforcement_enabled"] })), canonicalJson(after.value));
});

test("B5: --enable without --set-controls on an installed policy is refused; mode flags are validated", async () => {
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  await installer.run(["--apply"]);
  for (const argv of [["--enable=desk_enabled"], ["--migration-paused=false"], ["--migration=running"], ["--intake-admission-at=now"]])
    await assert.rejects(installer.run(["--apply", ...argv]), /requires --set-controls/, argv.join(" "));
  assert.equal(db.versions.size, 1, "nothing was written");
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--disable=desk_enabled"]), /--disable requires --set-controls/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--set-controls", "--force-policy"]), /mutually exclusive/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--refresh-roster"]), /--refresh-roster requires --set-controls/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--set-controls", "--drop-unreviewed"]), /--drop-unreviewed requires --refresh-roster/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--set-controls", "--enable=desk_enabled", "--disable=desk_enabled"]), /both enabled and disabled/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--set-controls", "--disable=everything"]), /Unknown control/);
  // --set-controls needs an installed policy.
  const fresh = installerOver(new MemoryConfigurationDb());
  await assert.rejects(fresh.run(["--apply", "--set-controls", "--enable=desk_enabled"]), /needs an installed policy/);
});

test("B5: --refresh-roster adds new reviewed agents and keeps existing goals", async () => {
  const C = "cccccccccccccccccccccccc";
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  await installer.run(["--apply", "--enable=desk_enabled,goal_metrics_enabled"], { reviewed: [A, B] });
  await installer.ownerPatch((value) => {
    value.goals.rep_work_schedules![0]!.scheduled_goal = 40;
    value.goals.rep_work_schedules![1]!.working_days = [1, 2, 3, 4, 5];
    value.goals.effective_day_overrides = [{ agent_id: B, business_date: "2026-10-08", goal: 0, reason: "absence" }];
    return value;
  }, "owner-goals");
  const before = await installer.loader.requireActive();
  // B is no longer reviewed, C is newly reviewed (upper-case id from the link is normalised).
  const kept = await installer.run(["--apply", "--set-controls", "--refresh-roster"], { reviewed: [A, C.toUpperCase()], installedOn: "2026-10-09" });
  assert.equal(kept.plan.kind, "write");
  if (kept.plan.kind !== "write") return;
  assert.deepEqual(kept.plan.roster, { added: [C], unreviewed: [B], dropped: [] });
  const grown = await installer.loader.requireActive();
  assert.deepEqual(grown.value.goals.rep_work_schedules, [
    { agent_id: A, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: 40 },
    { agent_id: B, working_days: [1, 2, 3, 4, 5], scheduled_goal: null },
    { agent_id: C, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: null },
  ]);
  assert.equal(grown.value.goals.effective_day_overrides?.length, 1);
  assert.notEqual(grown.value.goals.roster_version, before.value.goals.roster_version);
  assert.equal(grown.value.evidence.roster_version, grown.value.goals.roster_version);
  assert.equal(canonicalJson(grown.value.cadence), canonicalJson(before.value.cadence));
  assert.deepEqual(grown.value.controls, before.value.controls);
  // Re-running with the same reviewed set changes nothing.
  assert.equal((await installer.run(["--apply", "--set-controls", "--refresh-roster"], { reviewed: [A, C], installedOn: "2026-10-10" })).write, null);
  // --drop-unreviewed removes B and B's day override.
  const dropped = await installer.run(["--apply", "--set-controls", "--refresh-roster", "--drop-unreviewed"], { reviewed: [A, C], installedOn: "2026-10-10" });
  assert.equal(dropped.plan.kind === "write" && dropped.plan.roster?.dropped.join(), B);
  const slim = await installer.loader.requireActive();
  assert.deepEqual(slim.value.goals.rep_work_schedules?.map((r) => r.agent_id), [A, C]);
  assert.deepEqual(slim.value.goals.effective_day_overrides, []);
  assert.equal(slim.value.goals.rep_work_schedules?.[0]?.scheduled_goal, 40);
});

test("B5: re-building an installed value is stable, and a key only one side carries is drift", () => {
  const installed = buildFinal01Configuration({ current: bootstrap(), rosterAgentIds: [A], installedOn: "2026-10-05" });
  const rebuilt = buildFinal01Configuration({ current: installed, rosterAgentIds: [A], installedOn: "2026-10-05" });
  assert.equal(canonicalJson(rebuilt), canonicalJson(installed));
  // An optional key added after FINAL-01 (R0: optional, no default) is compared by key union.
  const later = { ...installed, cadence: { ...installed.cadence, future_optional_rule: "a" } } as unknown as SalesOutreachConfigurationValue;
  assert.deepEqual(policyDrift(later, installed), [{ path: "cadence.future_optional_rule", current: "a", installer: ABSENT_KEY }]);
});

test("installing through the PATCH path is idempotent: same content writes nothing new, a lost response replays", async () => {
  const db = new MemoryConfigurationDb();
  const loader = createConfigurationLoader(db.store);
  const install = async (rosterAgentIds: string[]) => {
    const inspected = await loader.inspect();
    const current = inspected.state === "active" ? inspected.value : bootstrap();
    const expected_revision = inspected.state === "active" ? inspected.revision : 0;
    const value = buildFinal01Configuration({ current, rosterAgentIds, installedOn: "2026-10-04", enableControls: ["desk_enabled", "goal_metrics_enabled"] });
    const hash = configurationContentHash(value);
    if (inspected.state === "active" && inspected.content_hash === hash) return { skipped: true as const };
    const key = installIdempotencyKey(hash, expected_revision);
    const first = await patchSalesOutreachConfiguration({ actor: csiOperatorActor("install"), idempotency_key: key, expected_revision, value }, db.deps());
    return { skipped: false as const, first, key, value, expected_revision };
  };
  const installed = await install([A]);
  assert.equal(installed.skipped, false);
  if (installed.skipped) return;
  assert.equal(installed.first.response.revision, 1);
  const active = await loader.requireActive();
  assert.equal(active.approval_ref, FINAL01_APPROVAL_REF);
  assert.equal(active.value.controls.goal_metrics_enabled, true);
  // Re-run: nothing to do.
  assert.deepEqual(await install([A]), { skipped: true });
  // A lost-response retry of the same command replays the committed result.
  const replay = await patchSalesOutreachConfiguration(
    { actor: csiOperatorActor("install"), idempotency_key: installed.key, expected_revision: installed.expected_revision, value: installed.value },
    db.deps(),
  );
  assert.equal(replay.replayed, true);
  assert.equal(db.versions.size, 1);
  // A newly reviewed rep changes the roster → a new revision.
  const grown = await install([A, B]);
  assert.equal(grown.skipped || grown.first.response.revision, 2);
});

test("the installed FINAL-01 cadence adapts to S2's FINAL-01 engine policy (same rules, our approval labels)", () => {
  const value = buildFinal01Configuration({ current: salesOutreachConfigurationValueSchema.parse({}), rosterAgentIds: ["a".repeat(24)], installedOn: "2026-10-05" });
  assert.deepEqual(value.cadence, salesOutreachConfigurationValueSchema.parse({ cadence: TEST_FINAL01_CADENCE }).cadence, "the evaluator tests use the installed values");
  const ours = deskEnginePolicy(value);
  const theirs = resolveEnginePolicy(FINAL_01_CADENCE_VALUE);
  assert.ok(ours.ok && theirs.ok);
  assert.deepEqual({ ...ours.policy, policy_version: "", approval_ref: "" }, { ...theirs.policy, policy_version: "", approval_ref: "" });
  assert.deepEqual([ours.policy.policy_version, ours.policy.approval_ref], [FINAL01_POLICY_VERSION, FINAL01_APPROVAL_REF]);
});
