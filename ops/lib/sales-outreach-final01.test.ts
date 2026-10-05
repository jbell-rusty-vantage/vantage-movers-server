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
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import {
  buildFinal01Configuration,
  FINAL01_APPROVAL_REF,
  FINAL01_POLICY_VERSION,
  installIdempotencyKey,
  parseInstallArgs,
} from "./sales-outreach-final01";

const packet = (path: string) => JSON.parse(readFileSync(resolve(__dirname, "../../docs/sales-outreach-desk", path), "utf8")) as Record<string, unknown>;
const fixture = (name: string) => packet(`contracts/fixtures/${name}`);
const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const bootstrap = () => salesOutreachConfigurationValueSchema.parse({});

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
});

test("the installer refuses unnamed targets and unknown controls", () => {
  assert.throws(() => parseInstallArgs([]), /--target/);
  assert.throws(() => parseInstallArgs(["--apply"]), /--target/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--enable=everything"]), /Unknown control/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--yes"]), /Unknown argument/);
  assert.throws(() => parseInstallArgs(["--target=vantagemovers", "--migration-paused=no"]), /--migration-paused/);
  assert.deepEqual(parseInstallArgs(["--target=vantagemovers", "--apply", "--migration-paused=false"]), { target: "vantagemovers", apply: true, enableControls: [], migrationPaused: false });
  assert.deepEqual(parseInstallArgs(["--target=vantagemovers"]), { target: "vantagemovers", apply: false, enableControls: [] });
  assert.deepEqual(parseInstallArgs(["--target=testvantagemovers", "--apply", "--enable=desk_enabled,goal_metrics_enabled"]), {
    target: "testvantagemovers",
    apply: true,
    enableControls: ["desk_enabled", "goal_metrics_enabled"],
  });
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
