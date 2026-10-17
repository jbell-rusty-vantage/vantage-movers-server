import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import type { SalesOutreachRepDaysDto } from "../../../validation/v1/salesOutreachReads";
import type { RecordDailyOperationsFactInput } from "../../dailyOperations/recordDailyOperationsFact";
import type { ActiveConfiguration } from "../config/load";
import { activeInspection } from "../reads/testing";
import { applyContactSources } from "./apply";
import { goalMilestoneFacts, recordGoalMilestones, repMilestoneDedupeKey, resetGoalMilestoneMemo, teamMilestoneDedupeKey } from "./goalMilestones";
import { recountRepDay, repDayGoalMet } from "./repDayService";
import { ContextBuilder, MemoryContactEventStore, SESSION, newId, outboundCall, subjectFacts } from "./testing";
import { MemoryRepDayStore, callMarks } from "./testingPipeline";

/** Goal milestones (doc 16): the recount says when today's row crosses its goal; the recorder turns that into facts. */

const ALICE = newId();
const BOB = newId();
const NUMBER = newId();
const NOW = new Date("2026-10-05T19:00:00.000Z"); // 15:00 New York, Monday
const TODAY = "2026-10-05";

beforeEach(() => resetGoalMilestoneMemo());

test("repDayGoalMet: a positive goal reached by the headline count; zero goals and other states never", () => {
  const snapshot = (goal: number | null) => ({ roster_version: null, configuration_version: null, goal, scheduled: true, override: null });
  assert.equal(repDayGoalMet({ goal_state: "goal", actual_confirmed: 2, goal_snapshot: snapshot(2) }), true);
  assert.equal(repDayGoalMet({ goal_state: "goal", actual_confirmed: 1, goal_snapshot: snapshot(2) }), false);
  assert.equal(repDayGoalMet({ goal_state: "no_goal_today", actual_confirmed: 5, goal_snapshot: snapshot(0) }), false);
  assert.equal(repDayGoalMet({ goal_state: "goal", actual_confirmed: null, goal_snapshot: snapshot(2) }), false);
  assert.equal(repDayGoalMet(null), false);
});

test("recountRepDay: goal_crossed only on the write that takes today's row from below to at its goal", async () => {
  const configuration: SalesOutreachConfigurationInput = {
    controls: { desk_enabled: true, goal_metrics_enabled: true },
    transition: { backfill_lookback_days: 2 },
    goals: {
      roster_version: "roster-1",
      default_scheduled_goal: 100,
      zero_goal_rule: "no_goal_today_excluded_from_denominator",
      rep_work_schedules: [{ agent_id: ALICE, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: 2 }],
      effective_day_overrides: [],
    },
  };
  const active = activeInspection(configuration, "v-test", 3) as ActiveConfiguration;
  const ctx = new ContextBuilder().link(ALICE, "101");
  ctx.lead(NUMBER, subjectFacts({ workflow: "new" }));
  const events = new MemoryContactEventStore(ctx.build());
  const repDays = new MemoryRepDayStore(events);
  repDays.marks = callMarks(new Date("2026-10-06T05:00:00Z"), new Date("2026-10-06T05:00:00Z"), new Date("2026-10-01T04:00:00Z"));
  const key = { agent_id: ALICE, business_day: TODAY };
  const crossings: Array<boolean | undefined> = [];
  for (const start of ["2026-10-05T14:00:00Z", "2026-10-05T14:30:00Z", "2026-10-05T15:00:00Z"]) {
    const row = outboundCall("101", NUMBER, start);
    events.calls.set(row.id, row);
    await applyContactSources([{ source_kind: "call", source_id: row.id }], { now: NOW, queueRepDays: false }, events, SESSION);
    const result = await recountRepDay(key, active, NOW, repDays, SESSION);
    assert.equal(result.outcome, "written");
    crossings.push(result.goal_crossed);
  }
  assert.deepEqual(crossings, [false, true, false]);
});

type Rep = NonNullable<SalesOutreachRepDaysDto["reps"]>[number];
const rep = (agent_id: string, actual: number, goal: number): Rep =>
  ({
    agent_id,
    agent_name: agent_id === ALICE ? "Alice Ames" : "Bob Burns",
    goal_state: "goal",
    goal,
    actual_confirmed: actual,
    goal_reached: actual >= goal,
    count_scope: "all_outbound",
    alternate_scope: null,
    other_outbound: { count: 0 },
  }) as unknown as Rep;
const days = (reps: Rep[], is_today = true) =>
  ({ business_day: TODAY, is_today, goal_metrics_enabled: true, count_scope: "all_outbound", reps, unknown_reason: null }) as unknown as SalesOutreachRepDaysDto;
const change = (agent_id: string, goal_crossed: boolean) => ({ agent_id, business_day: TODAY, publication_revision: 2, goal_crossed });

test("goalMilestoneFacts: a crossed rep gets its fact with name, numbers and rank; the team fact once the sum meets the team goal", () => {
  const facts = goalMilestoneFacts({ changes: [change(ALICE, true)], days: days([rep(ALICE, 60, 60), rep(BOB, 10, 60)]), now: NOW, teamAlreadyRecorded: false });
  assert.equal(facts.length, 1);
  const [fact] = facts;
  assert.equal(fact!.kind, "outreach.rep_goal_met");
  assert.equal(fact!.dedupe_key, repMilestoneDedupeKey(ALICE, TODAY));
  assert.deepEqual(
    [fact!.card?.agent_name, fact!.card?.actual, fact!.card?.goal, fact!.card?.rank, fact!.card?.team_actual, fact!.card?.team_goal, fact!.card?.reps_at_goal, fact!.card?.reps_on_roster],
    ["Alice Ames", 60, 60, 1, 70, 120, 1, 2],
  );

  const team = goalMilestoneFacts({ changes: [change(BOB, true)], days: days([rep(ALICE, 70, 60), rep(BOB, 60, 60)]), now: NOW, teamAlreadyRecorded: false });
  assert.deepEqual(team.map((f) => f.kind), ["outreach.rep_goal_met", "outreach.team_goal_met"]);
  assert.equal(team[1]!.dedupe_key, teamMilestoneDedupeKey(TODAY));
});

test("goalMilestoneFacts: a change that did not cross, a rep the read says is short, and a past day give nothing", () => {
  assert.deepEqual(goalMilestoneFacts({ changes: [change(ALICE, false)], days: days([rep(ALICE, 61, 60), rep(BOB, 0, 60)]), now: NOW, teamAlreadyRecorded: false }), []);
  assert.deepEqual(goalMilestoneFacts({ changes: [change(ALICE, true)], days: days([rep(ALICE, 59, 60), rep(BOB, 0, 60)]), now: NOW, teamAlreadyRecorded: false }), []);
  assert.deepEqual(goalMilestoneFacts({ changes: [change(ALICE, true)], days: days([rep(ALICE, 60, 60)], false), now: NOW, teamAlreadyRecorded: false }), []);
});

test("recordGoalMilestones: records each fact, remembers the team fact, skips past days and never throws", async () => {
  const recorded: RecordDailyOperationsFactInput[] = [];
  let reads = 0;
  const deps = {
    now: () => NOW,
    connected: () => true,
    readDays: async () => {
      reads++;
      return days([rep(ALICE, 60, 60), rep(BOB, 60, 60)]);
    },
    record: async (input: RecordDailyOperationsFactInput) => {
      recorded.push(input);
    },
  };
  await recordGoalMilestones([change(ALICE, true)], deps);
  assert.deepEqual(recorded.map((f) => f.kind), ["outreach.rep_goal_met", "outreach.team_goal_met"]);
  // The team fact is remembered: a later non-crossing change skips the read entirely.
  await recordGoalMilestones([change(BOB, false)], deps);
  assert.equal(reads, 1);
  // Another day's change never reads.
  await recordGoalMilestones([{ agent_id: ALICE, business_day: "2026-10-04", publication_revision: 3, goal_crossed: true }], deps);
  assert.equal(reads, 1);
  // A failing read is swallowed.
  await recordGoalMilestones([change(ALICE, true)], { ...deps, readDays: async () => Promise.reject(new Error("down")) });
  // No database connection: nothing happens.
  resetGoalMilestoneMemo();
  await recordGoalMilestones([change(ALICE, true)], { ...deps, connected: () => false });
  assert.equal(reads, 1);
});
