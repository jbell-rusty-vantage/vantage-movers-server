import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { salesOutreachRepDaySchema, salesOutreachRepDaysSchema } from "../../../validation/v1/salesOutreachReads";
import { composeRepDayRow } from "../contacts/repDay";
import { callsCoverageForDay } from "./freshness";
import {
  composeRepDay,
  composeTeamGoals,
  dayCountScope,
  fallbackCountScope,
  resolveConfiguredGoal,
  resolveRepDayGoal,
  type RepDayRow,
} from "./goals";
import type { OutreachActor } from "../auth";
import { completeConfigurationInput, TEST_AGENT_A, TEST_AGENT_B } from "../evaluation/testing";
import { MemoryDeskReadStore } from "./deskTesting";
import { readRepDays } from "./service";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore, repDayRow } from "./testing";

/**
 * P08a roster/goal arithmetic (contracts/fixtures/p08a-roster-goals.json) and the honest-count
 * rules of the M1 reads.
 */
const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../docs/sales-outreach-desk/contracts/fixtures/p08a-roster-goals.json"), "utf8"),
) as {
  default_scheduled_day_goal: number;
  rows: Array<{ rep: string; goal: number; actual: number; override?: "partial_day" | "absence"; label?: string; goal_achieved?: boolean }>;
  expected_team_goal: number;
  expected_actual: number;
  expected_goal_enabled_reps: number;
  expected_reps_at_goal: number;
};

const DAY = "2026-10-05"; // Monday
const agentOf = (rep: string) => rep.repeat(24);
const COMPLETE = callsCoverageForDay(new Date("2026-10-06T05:00:00Z"), new Date("2026-10-06T04:00:00Z"));
const PARTIAL = callsCoverageForDay(new Date("2026-10-05T14:00:00Z"), new Date("2026-10-05T15:50:00Z"));

const goals = salesOutreachConfigurationValueSchema.parse({
  goals: {
    roster_version: "roster-p08a",
    default_scheduled_goal: fixture.default_scheduled_day_goal,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: fixture.rows.map((row) => ({ agent_id: agentOf(row.rep), working_days: [1, 2, 3, 4, 5, 6, 7] })),
    effective_day_overrides: fixture.rows
      .filter((row) => row.override)
      .map((row) => ({ agent_id: agentOf(row.rep), business_date: DAY, goal: row.goal, reason: row.override! })),
  },
}).goals;

function compose(agent: string, row: RepDayRow | null, coverage = COMPLETE) {
  return composeRepDay({
    agent_id: agent,
    agent_name: null,
    reviewed_link: true,
    goal: resolveRepDayGoal({ goals, configuration_version: "v1", agent_id: agent, business_day: DAY, today: DAY, row }),
    row,
    fallback_scope: "all_outbound",
    capture_coverage: coverage,
  });
}

test("P08a fixture: team goal 350, actual 255, 4 goal-enabled reps, 2 at goal, absent rep labelled No goal today", () => {
  const reps = fixture.rows.map((row) =>
    compose(agentOf(row.rep), repDayRow({ agent_id: agentOf(row.rep), business_day: DAY, actual_confirmed: row.actual })),
  );
  // composeRepDay serves the goal parts; the cadence counts are composed by the read (repCadence.test.ts).
  const goalPart = salesOutreachRepDaySchema.omit({ overdue_leads: true, calls_due_today: true, sms_due_today: true });
  for (const rep of reps) goalPart.parse(rep);
  const team = composeTeamGoals(reps, "all_outbound");
  assert.equal(team.outbound_calls.goal, fixture.expected_team_goal);
  assert.equal(team.outbound_calls.actual, fixture.expected_actual);
  assert.equal(team.reps_at_goal.of, fixture.expected_goal_enabled_reps);
  assert.equal(team.reps_at_goal.count, fixture.expected_reps_at_goal);
  assert.equal(team.outbound_calls.incomplete, false);
  assert.equal(team.count_scope_label, "Outbound calls");

  const byRep = new Map(fixture.rows.map((row, i) => [row.rep, reps[i]!]));
  const absent = byRep.get("e")!;
  assert.equal(absent.goal_state, "no_goal_today");
  assert.equal(absent.goal_label, "No goal today");
  assert.equal(absent.goal_reached, false);
  assert.equal(absent.actual_confirmed, 10, "zero-goal days keep their actuals");
  assert.equal(absent.progress, null);
  assert.deepEqual(absent.goal_provenance.override, { business_date: DAY, goal: 0, reason: "absence" });
  const partial = byRep.get("d")!;
  assert.deepEqual([partial.goal, partial.remaining, partial.progress, partial.goal_provenance.basis], [50, 25, 0.5, "override"]);
  assert.equal(partial.goal_provenance.override?.reason, "partial_day");
  // c: 120/100 stays visible with capped progress and zero remaining.
  assert.deepEqual([byRep.get("c")!.actual_confirmed, byRep.get("c")!.progress, byRep.get("c")!.remaining], [120, 1, 0]);
  assert.equal(byRep.get("a")!.goal_provenance.basis, "default_goal");
});

test("108/100 displays the actual, capped progress and zero remaining", () => {
  const rep = compose(agentOf("a"), repDayRow({ agent_id: agentOf("a"), business_day: DAY, actual_confirmed: 108 }));
  assert.deepEqual([rep.actual_confirmed, rep.goal, rep.progress, rep.remaining, rep.goal_reached], [108, 100, 1, 0, true]);
});

test("goal provenance: explicit schedule goal, non-working day and not on roster", () => {
  const custom = salesOutreachConfigurationValueSchema.parse({
    goals: {
      roster_version: "r2",
      default_scheduled_goal: 100,
      zero_goal_rule: "no_goal_today_excluded_from_denominator",
      rep_work_schedules: [{ agent_id: agentOf("a"), working_days: [1, 2, 3, 4, 5], scheduled_goal: 80 }],
    },
  }).goals;
  const weekday = resolveConfiguredGoal(custom, "v2", agentOf("a"), "2026-10-05");
  assert.deepEqual([weekday.goal, weekday.goal_state, weekday.provenance.basis, weekday.provenance.roster_version], [80, "goal", "work_schedule", "r2"]);
  const sunday = resolveConfiguredGoal(custom, "v2", agentOf("a"), "2026-10-04");
  assert.deepEqual([sunday.goal, sunday.goal_state, sunday.provenance.basis, sunday.provenance.scheduled_working_day], [0, "no_goal_today", "not_scheduled", false]);
  const stranger = resolveConfiguredGoal(custom, "v2", agentOf("f"), "2026-10-05");
  assert.deepEqual([stranger.goal, stranger.goal_state, stranger.provenance.basis], [null, "not_on_roster", "not_on_roster"]);
  const strangerRow = composeRepDay({
    agent_id: agentOf("f"),
    agent_name: null,
    reviewed_link: false,
    goal: stranger,
    row: repDayRow({ agent_id: agentOf("f"), business_day: "2026-10-05", actual_confirmed: 7 }),
    fallback_scope: "all_outbound",
    capture_coverage: COMPLETE,
  });
  assert.deepEqual([strangerRow.goal_label, strangerRow.actual_confirmed, strangerRow.remaining, strangerRow.goal_reached], ["Not on roster", 7, null, null]);
  // A rep not on the roster does not add to the team goal or actual.
  const team = composeTeamGoals([strangerRow], "all_outbound");
  assert.deepEqual([team.outbound_calls.goal, team.outbound_calls.actual, team.roster_size], [0, 0, 0]);
});

test("past days prefer the frozen goal snapshot; today resolves from the active configuration", () => {
  const row = repDayRow({
    agent_id: agentOf("a"),
    business_day: "2026-10-01",
    actual_confirmed: 60,
    goal_snapshot: { roster_version: "old", configuration_version: "v0", goal: 60, scheduled: true, override: null },
  });
  const past = resolveRepDayGoal({ goals, configuration_version: "v1", agent_id: agentOf("a"), business_day: "2026-10-01", today: DAY, row });
  assert.deepEqual([past.goal, past.provenance.source, past.provenance.configuration_version], [60, "projection_snapshot", "v0"]);
  const todayRow = { ...row, business_day: DAY };
  const today = resolveRepDayGoal({ goals, configuration_version: "v1", agent_id: agentOf("a"), business_day: DAY, today: DAY, row: todayRow });
  assert.deepEqual([today.goal, today.provenance.source], [100, "configuration"]);
  const snapshotOverride = resolveRepDayGoal({
    goals,
    configuration_version: "v1",
    agent_id: agentOf("a"),
    business_day: "2026-10-01",
    today: DAY,
    row: { ...row, goal_snapshot: { ...row.goal_snapshot!, goal: 100, override: { agent_id: agentOf("a"), business_date: "2026-10-01", goal: 0, reason: "absence" } } },
  });
  assert.deepEqual([snapshotOverride.goal, snapshotOverride.goal_state, snapshotOverride.provenance.basis], [0, "no_goal_today", "override"]);
});

test("incomplete evidence is never a confirmed zero", () => {
  // No row and incomplete coverage: pending, not 0.
  const pending = compose(agentOf("b"), null, PARTIAL);
  assert.deepEqual([pending.actual_confirmed, pending.actual_basis, pending.remaining, pending.progress, pending.goal_reached], [null, "pending", null, null, null]);
  assert.equal(pending.unknown_reason, "coverage_incomplete");
  assert.equal(pending.coverage.gaps.length, 1);
  // No row and complete coverage: a recorded zero.
  const zero = compose(agentOf("b"), null, COMPLETE);
  assert.deepEqual([zero.actual_confirmed, zero.actual_basis, zero.remaining, zero.progress], [0, "no_activity_recorded", 100, 0]);
  // A row with 0 and partial coverage is still pending; a positive count is shown as a lower bound.
  const zeroRow = compose(agentOf("b"), repDayRow({ agent_id: agentOf("b"), business_day: DAY }), PARTIAL);
  assert.equal(zeroRow.actual_confirmed, null);
  const some = compose(agentOf("b"), repDayRow({ agent_id: agentOf("b"), business_day: DAY, actual_confirmed: 12, actual_awaiting_confirmation: 2 }), PARTIAL);
  assert.deepEqual([some.actual_confirmed, some.actual_awaiting_confirmation, some.coverage.state], [12, 2, "partial"]);
  // The row's own coverage can only make it worse than capture coverage.
  const rowPartial = compose(
    agentOf("b"),
    repDayRow({ agent_id: agentOf("b"), business_day: DAY, coverage: { state: "partial", known_complete_through: "2026-10-05T12:00:00.000Z", gaps: [] } }),
    COMPLETE,
  );
  assert.deepEqual([rowPartial.coverage.state, rowPartial.actual_confirmed], ["partial", null]);
  // Awaiting-confirmation calls never count toward progress.
  const awaiting = compose(agentOf("a"), repDayRow({ agent_id: agentOf("a"), business_day: DAY, actual_confirmed: 50, actual_awaiting_confirmation: 60 }));
  assert.deepEqual([awaiting.progress, awaiting.remaining, awaiting.goal_reached], [0.5, 50, false]);

  // Team: one pending rep makes the card incomplete and lists it.
  const team = composeTeamGoals([compose(agentOf("a"), repDayRow({ agent_id: agentOf("a"), business_day: DAY, actual_confirmed: 40 })), pending], "all_outbound");
  assert.deepEqual([team.outbound_calls.actual, team.outbound_calls.incomplete, team.outbound_calls.pending_agent_ids, team.reps_at_goal.pending], [40, true, [agentOf("b")], 1]);
  const allPending = composeTeamGoals([pending], "all_outbound");
  assert.equal(allPending.outbound_calls.actual, null);
});

test("count scopes: Other outbound stays separate and mixed scopes never sum", () => {
  const m2 = repDayRow({ agent_id: agentOf("a"), business_day: DAY, count_scope: "eligible_new_quoted", actual_confirmed: 30, unattributed: 9 });
  const rep = compose(agentOf("a"), m2);
  assert.deepEqual([rep.count_scope, rep.count_scope_label, rep.actual_confirmed, rep.other_outbound], [
    "eligible_new_quoted",
    "Outbound calls (New/Quoted leads)",
    30,
    { count: 9, label: "Other outbound" },
  ]);
  const m1 = repDayRow({ agent_id: agentOf("b"), business_day: DAY, actual_confirmed: 20 });
  assert.equal(dayCountScope([m2, m1]), "mixed");
  const team = composeTeamGoals([rep, compose(agentOf("b"), m1)], dayCountScope([m2, m1]));
  assert.deepEqual([team.outbound_calls.actual, team.outbound_calls.unknown_reason, team.count_scope_label], [null, "mixed_count_scope", null]);
  assert.equal(dayCountScope([]), null);
});

test("olr C1a fallbackCountScope: a rep without a row takes the configured scope of the day, never the rows'", () => {
  assert.equal(fallbackCountScope(undefined, DAY), "all_outbound");
  assert.equal(fallbackCountScope({ count_scope_schedule: undefined }, DAY), "all_outbound", "absent schedule = all_outbound (D1 A)");
  const goals = salesOutreachConfigurationValueSchema.parse({
    goals: { count_scope_schedule: [{ from_day: "2026-10-07", scope: "eligible_new_quoted" }] },
  }).goals;
  assert.equal(fallbackCountScope(goals, "2026-10-06"), "all_outbound");
  assert.equal(fallbackCountScope(goals, "2026-10-07"), "eligible_new_quoted");
});

test("olr C1a GET /rep-days: a rep without a row reads the configured scope even when another rep's stale row says eligible", async () => {
  const NOW = new Date("2026-10-05T15:00:00.000Z"); // 11:00 New York on DAY
  const store = new MemoryReadStore();
  // A row an older build wrote under eligible_new_quoted (2026-10-06 before the refresh corrects it).
  store.rows = [repDayRow({ agent_id: TEST_AGENT_A, business_day: DAY, count_scope: "eligible_new_quoted", actual_confirmed: 12, computed_as_of: new Date("2026-10-05T14:55:00Z") })];
  store.calls = { scope: "call_log_all_directions", known_complete_through: new Date("2026-10-05T14:57:00Z"), last_finished_at: NOW, last_error_code: null };
  store.derivation = { known_complete_through: new Date("2026-10-05T14:58:00Z"), coverage_from: new Date("2026-10-01T04:00:00Z") };
  const owner: OutreachActor = { role: "owner", actor: { kind: "owner", id: "owner-1", request_id: "r1", run_id: null }, agent_id: null };
  const read = (input: ReturnType<typeof completeConfigurationInput>) =>
    readRepDays(owner, { business_day: DAY }, { loader: fixedConfigurationLoader(activeInspection(input)), store, queueStore: new MemoryDeskReadStore(), now: NOW });
  const absent = salesOutreachRepDaysSchema.parse(await read(completeConfigurationInput({ goal_metrics_enabled: true })));
  const scopeOf = (body: typeof absent, agent: string) => body.reps!.find((rep) => rep.agent_id === agent)!.count_scope;
  assert.deepEqual([scopeOf(absent, TEST_AGENT_A), scopeOf(absent, TEST_AGENT_B)], ["eligible_new_quoted", "all_outbound"], "the row keeps what it counted; the no-row rep follows the configuration");
  const configured = completeConfigurationInput({ goal_metrics_enabled: true });
  configured.goals = { ...configured.goals, count_scope_schedule: [{ from_day: DAY, scope: "eligible_new_quoted" }] };
  assert.equal(scopeOf(salesOutreachRepDaysSchema.parse(await read(configured)), TEST_AGENT_B), "eligible_new_quoted");
});

test("olr C5: a materialized zero row is pending while coverage is partial and a projected 0 once complete; its frozen goal wins", () => {
  // The refresh after New York midnight writes the zero row of 2026-10-04 (composeRepDayRow, no events).
  const PAST = "2026-10-04";
  const afterMidnight = new Date("2026-10-05T04:30:00Z"); // 00:30 New York on DAY
  const materialized = (through: Date) => {
    const fields = composeRepDayRow({
      agent_id: agentOf("b"), business_day: PAST, today: DAY, now: afterMidnight, events: [], scope: "all_outbound",
      goals, configuration_version: "v1", existing_snapshot: null,
      watermarks: { capture_known_complete_through: through, derived_through: through, coverage_from: null },
    });
    return {
      row: repDayRow({
        agent_id: fields.agent_id, business_day: PAST, goal_snapshot: fields.goal_snapshot, coverage: fields.coverage,
        actual_confirmed: fields.actual_confirmed, actual_awaiting_confirmation: fields.actual_awaiting_confirmation, unattributed: fields.unattributed,
      }),
      coverage: fields.coverage,
    };
  };
  // A later edit (default goal 70, version v2) must not move the frozen day.
  const edited = { ...goals, default_scheduled_goal: 70 };
  const serve = ({ row, coverage }: ReturnType<typeof materialized>) =>
    composeRepDay({
      agent_id: agentOf("b"), agent_name: null, reviewed_link: true,
      goal: resolveRepDayGoal({ goals: edited, configuration_version: "v2", agent_id: agentOf("b"), business_day: PAST, today: DAY, row }),
      row, fallback_scope: "all_outbound", capture_coverage: coverage,
    });

  const partial = serve(materialized(new Date("2026-10-05T03:00:00Z")));
  assert.equal(partial.coverage.state, "partial");
  assert.deepEqual([partial.actual_confirmed, partial.actual_basis, partial.unknown_reason, partial.remaining, partial.goal_reached], [null, "pending", "coverage_incomplete", null, null]);
  assert.deepEqual([partial.goal, partial.goal_provenance.source, partial.goal_provenance.configuration_version], [100, "projection_snapshot", "v1"]);

  const complete = serve(materialized(new Date("2026-10-05T04:20:00Z")));
  assert.equal(complete.coverage.state, "complete");
  assert.deepEqual([complete.actual_confirmed, complete.actual_basis, complete.remaining, complete.progress, complete.goal_reached], [0, "projection", 100, 0, false]);
  assert.deepEqual([complete.goal, complete.goal_provenance.source], [100, "projection_snapshot"]);
});
