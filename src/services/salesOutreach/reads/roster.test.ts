import assert from "node:assert/strict";
import { test } from "node:test";
import type { SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import { salesOutreachRepDaysSchema, salesOutreachTeamSchema } from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import { MemoryDeskReadStore } from "./deskTesting";
import { readRepDays, readTeam } from "./service";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore, repDayRow } from "./testing";

/**
 * P08a-1 (F1/F2) reads: under `goals.roster_rule: desk_reps` the Team desk lists exactly the desk reps
 * (active Agents with a current reviewed `sales_rep` link), derives their goals from the settings or
 * the defaults, tells the Owner about other callers, and reads a past day's roster at that day's end.
 */

const A = "a".repeat(24); // configured, reviewed, active → desk rep
const B = "b".repeat(24); // not configured, reviewed, active → desk rep with the defaults
const D = "d".repeat(24); // configured, no current link → not a desk rep
const E = "e".repeat(24); // reviewed link, Agent deactivated → not a desk rep
const X = "f".repeat(24); // calls, no link, not an Agent on the roster
const DAY = "2026-10-05"; // Monday
const NOW = new Date("2026-10-05T15:00:00.000Z"); // 11:00 New York
const actor = (role: OutreachActor["role"], agent_id: string | null = null): OutreachActor => ({ role, actor: csiOperatorActor("roster-test"), agent_id });
const owner = actor("owner");
const manager = actor("manager");

const input = (rule: "desk_reps" | "explicit" | null): SalesOutreachConfigurationInput => ({
  controls: { desk_enabled: true, goal_metrics_enabled: true },
  goals: {
    roster_version: "roster-explicit",
    default_scheduled_goal: 100,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: [
      { agent_id: A, working_days: [1, 2, 3, 4, 5, 6, 7] },
      { agent_id: D, working_days: [1, 2, 3, 4, 5], scheduled_goal: 60 },
      { agent_id: E, working_days: [1, 2, 3, 4, 5, 6, 7] },
    ],
    effective_day_overrides: [{ agent_id: E, business_date: DAY, goal: 0, reason: "absence" }],
    ...(rule ? { roster_rule: rule } : {}),
  },
});

function store() {
  const s = new MemoryReadStore().coverCalls(new Date("2026-10-05T14:57:00Z"));
  s.rows = [
    repDayRow({ agent_id: A, business_day: DAY, actual_confirmed: 50, actual_confirmed_all: 50, actual_confirmed_eligible: 10, actual_awaiting_all: 0, actual_awaiting_eligible: 0, unattributed: 40 }),
    repDayRow({ agent_id: X, business_day: DAY, actual_confirmed: 7, actual_awaiting_confirmation: 1, actual_confirmed_all: 7, actual_confirmed_eligible: 0, actual_awaiting_all: 1, actual_awaiting_eligible: 0, unattributed: 7 }),
  ];
  s.names = new Map([
    [A, "Alice"],
    [B, "Bob"],
    [E, "Eve"],
  ]);
  s.inactiveAgents = new Set([E]);
  s.agentNames = new Map([
    [D, "Dan (Agent)"],
    [X, "Xavier (Agent)"],
  ]);
  return s;
}

const deps = (s: MemoryReadStore, rule: "desk_reps" | "explicit" | null, now = NOW) => ({
  loader: fixedConfigurationLoader(activeInspection(input(rule), "v-roster", 9)),
  store: s,
  queueStore: new MemoryDeskReadStore(),
  now,
});

test("desk_reps: GET /team lists exactly the desk reps with derived goals; others are the Owner's other_callers footnote", async () => {
  const s = store();
  const team = salesOutreachTeamSchema.parse(await readTeam(owner, { business_day: DAY }, deps(s, "desk_reps")));
  assert.deepEqual(
    team.daily_call_goals!.map((row) => [row.agent_id, row.agent_name, row.reviewed_link, row.goal, row.goal_provenance.basis, row.actual_confirmed]),
    [
      [A, "Alice", true, 100, "default_goal", 50],
      [B, "Bob", true, 100, "default_goal", 0],
    ],
    "A (configured) and B (defaults); D (no link), E (inactive) and X (no link) are not rows",
  );
  assert.match(team.daily_call_goals![0]!.goal_provenance.roster_version!, /^roster-desk-/);
  assert.deepEqual([team.goals!.outbound_calls.goal, team.goals!.outbound_calls.actual, team.goals!.roster_size, team.goals!.reps_at_goal.of], [200, 50, 2, 2]);
  assert.deepEqual(team.goals!.other_callers, { agents: 1, agent_ids: [X], confirmed: 7, awaiting_confirmation: 1 });
  assert.equal(team.roster!.rule, "desk_reps");
  assert.equal(team.roster!.at, NOW.toISOString(), "today's roster is read at now");
  assert.deepEqual(
    team.roster!.members.map((m) => [m.agent_id, m.agent_name, m.schedule_source, m.working_days.length, m.scheduled_goal]),
    [
      [A, "Alice", "configured", 7, null],
      [B, "Bob", "default", 7, null],
    ],
  );
  assert.deepEqual(s.deskRepQueries.map((d) => d.toISOString()), [NOW.toISOString()]);
});

test("desk_reps: a Manager gets the same rows and roster but no other_callers footnote", async () => {
  const team = salesOutreachTeamSchema.parse(await readTeam(manager, { business_day: DAY }, deps(store(), "desk_reps")));
  assert.deepEqual(team.daily_call_goals!.map((row) => row.agent_id), [A, B]);
  assert.equal(team.goals!.other_callers, null);
  assert.equal(team.roster!.rule, "desk_reps");
});

test("desk_reps: GET /rep-days narrowed to a non-rep still answers that Agent, as Not on roster", async () => {
  const days = salesOutreachRepDaysSchema.parse(await readRepDays(owner, { business_day: DAY, agent_id: X }, deps(store(), "desk_reps")));
  assert.deepEqual(days.reps!.map((row) => [row.agent_id, row.goal_state, row.actual_confirmed, row.agent_name]), [[X, "not_on_roster", 7, "Xavier (Agent)"]]);
  const all = salesOutreachRepDaysSchema.parse(await readRepDays(owner, { business_day: DAY }, deps(store(), "desk_reps")));
  assert.deepEqual(all.reps!.map((row) => row.agent_id), [A, B], "the unnarrowed read lists desk reps only");
});

test("desk_reps: a past day reads the roster at the end of that New York day, and a member without a current link keeps its Agent name", async () => {
  const s = store();
  const later = new Date("2026-10-07T15:00:00.000Z");
  const team = salesOutreachTeamSchema.parse(await readTeam(owner, { business_day: DAY }, deps(s, "desk_reps", later)));
  assert.deepEqual(s.deskRepQueries.map((d) => d.toISOString()), ["2026-10-06T04:00:00.000Z"], "end of 2026-10-05 New York");
  assert.equal(team.roster!.at, "2026-10-06T04:00:00.000Z");
  assert.deepEqual(team.daily_call_goals!.map((row) => row.agent_id), [A, B]);
});

test("explicit (absent or explicit): the configured list is the roster, extra callers are rows, no footnote, Agent-name fallback for a configured rep without a link", async () => {
  for (const rule of [null, "explicit"] as const) {
    const s = store();
    const team = salesOutreachTeamSchema.parse(await readTeam(owner, { business_day: DAY }, deps(s, rule)));
    assert.deepEqual(
      team.daily_call_goals!.map((row) => [row.agent_id, row.agent_name, row.reviewed_link, row.goal_state, row.goal]),
      [
        [A, "Alice", true, "goal", 100],
        [D, "Dan (Agent)", false, "goal", 60],
        [E, "Eve", true, "no_goal_today", 0],
        [X, "Xavier (Agent)", false, "not_on_roster", null],
      ],
      `rule ${rule}: configured reps first (D's name from the Agent record), then X as a not-on-roster row`,
    );
    assert.equal(team.goals!.other_callers, null);
    assert.deepEqual([team.roster!.rule, team.roster!.roster_version, team.roster!.members.length], ["explicit", "roster-explicit", 3]);
    assert.equal(s.deskRepQueries.length, 0, "no desk-rep lookup under the explicit rule");
  }
});
