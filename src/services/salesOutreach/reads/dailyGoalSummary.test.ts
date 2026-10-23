import assert from "node:assert/strict";
import { test } from "node:test";
import { readDailyOperationsGoalSummary, readTeam } from "./service";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore, repDayRow } from "./testing";
import { MemoryDeskReadStore } from "./deskTesting";
import { csiOperatorActor } from "../../salesIntelligence/auth";

const now = new Date("2026-10-05T15:00:00Z");
const agent = "a".repeat(24);
const loader = (enabled = true) => fixedConfigurationLoader(activeInspection({
  controls: { desk_enabled: true, goal_metrics_enabled: enabled },
  goals: { roster_rule: "desk_reps", roster_version: "synthetic-roster", rep_work_schedules: [{ agent_id: agent, working_days: [1, 2, 3, 4, 5] }], default_scheduled_goal: 100, zero_goal_rule: "no_goal_today_excluded_from_denominator" },
}));
function store() {
  const value = new MemoryReadStore().coverCalls(new Date("2026-10-05T14:59:00Z"));
  value.names.set(agent, "Synthetic rep");
  value.rows.push(repDayRow({ agent_id: agent, business_day: "2026-10-05", actual_confirmed_all: 50, actual_confirmed_eligible: 10, actual_awaiting_all: 0, actual_awaiting_eligible: 0, actual_confirmed: 50 }));
  return value;
}
test("Daily Operations goal summary preserves authoritative goal math without cadence/SMS/Granot fanout", async () => {
  const source = store();
  const expected = await readTeam({ role: "manager", actor: csiOperatorActor("synthetic-goals"), agent_id: null }, {}, { loader: loader(), store: source, queueStore: new MemoryDeskReadStore(), now });
  const narrow = store();
  narrow.readLastCallWebhookAt = async () => { throw new Error("unneeded webhook query"); };
  narrow.readSmsMailboxes = async () => { throw new Error("unneeded SMS query"); };
  narrow.readLatestGranotObservationAt = async () => { throw new Error("unneeded Granot query"); };
  const result = await readDailyOperationsGoalSummary({ loader: loader(), store: narrow, now });
  assert.deepEqual(result.goals, expected.goals);
  assert.equal(result.daily_call_goals?.[0]?.actual_confirmed, expected.daily_call_goals?.[0]?.actual_confirmed);
  assert.equal("overdue_leads" in result.daily_call_goals![0]!, false);
  assert.equal(narrow.queries.length, 1);
});
test("disabled goal metrics perform no roster/capture/projection queries", async () => {
  const narrow = store();
  narrow.findRepDayRows = async () => { throw new Error("unexpected projection read"); };
  narrow.readCallsCapture = async () => { throw new Error("unexpected capture read"); };
  const result = await readDailyOperationsGoalSummary({ loader: loader(false), store: narrow, now });
  assert.equal(result.goal_metrics_enabled, false);
  assert.equal(result.goals, null);
  assert.equal(result.daily_call_goals, null);
});
