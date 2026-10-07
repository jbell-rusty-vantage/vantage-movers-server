import assert from "node:assert/strict";
import { test } from "node:test";
import type { SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import type { ActiveConfiguration } from "../config/load";
import { activeInspection, fixedConfigurationLoader } from "../reads/testing";
import { applyContactSources } from "./apply";
import { materializesZeroRow, recountRepDay } from "./repDayService";
import { refreshOpenRepDays } from "./sweep";
import { ContextBuilder, MemoryContactEventStore, SESSION, memoryTransaction, newId, outboundCall, subjectFacts } from "./testing";
import { MemoryRepDayStore, callMarks } from "./testingPipeline";
import { effectiveRoster } from "../roster/rule";

/**
 * P08a-1 (F1/F2) recount: under `goals.roster_rule: desk_reps` the rep-day projection freezes the
 * roster of the day (the desk reps at its end), materializes C5 zero rows for desk reps only, and
 * labels a non-rep's activity Not on roster.
 */

const ALICE = newId(); // configured (5 days, goal 80), desk rep
const BOB = newId(); // not configured, desk rep → defaults
const CAROL = newId(); // configured, not a desk rep (link retired / Agent inactive)
const OUTSIDER = newId(); // calls, not a desk rep
const NUMBER = newId();
const NOW = new Date("2026-10-05T19:00:00.000Z"); // 15:00 New York
const AFTER_MIDNIGHT = new Date("2026-10-05T04:30:00.000Z"); // 00:30 New York on 2026-10-05

const desk = (rule: "desk_reps" | undefined): SalesOutreachConfigurationInput => ({
  controls: { desk_enabled: true, goal_metrics_enabled: true },
  transition: { backfill_lookback_days: 2 },
  goals: {
    roster_version: "roster-1",
    default_scheduled_goal: 100,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: [
      { agent_id: ALICE, working_days: [1, 2, 3, 4, 5], scheduled_goal: 80 },
      { agent_id: CAROL, working_days: [1, 2, 3, 4, 5, 6, 7] },
    ],
    effective_day_overrides: [],
    ...(rule ? { roster_rule: rule } : {}),
  },
});
const active = (rule: "desk_reps" | undefined) => activeInspection(desk(rule), "v-test", 3) as ActiveConfiguration;

function world() {
  const ctx = new ContextBuilder().link(ALICE, "101").link(BOB, "102").link(OUTSIDER, "105");
  ctx.lead(NUMBER, subjectFacts({ workflow: "new" }));
  const events = new MemoryContactEventStore(ctx.build());
  const repDays = new MemoryRepDayStore(events);
  repDays.marks = callMarks(new Date("2026-10-06T05:00:00Z"), new Date("2026-10-06T05:00:00Z"), new Date("2026-10-01T04:00:00Z"));
  repDays.deskRepIds = [ALICE, BOB];
  return { ctx, events, repDays };
}
const call = (store: MemoryContactEventStore, row: ReturnType<typeof outboundCall>) => {
  store.calls.set(row.id, row);
  return { source_kind: "call" as const, source_id: row.id };
};

test("desk_reps refresh after midnight: zero rows for the desk reps of yesterday only, frozen with the derived roster version", async () => {
  const w = world();
  await applyContactSources([call(w.events, outboundCall("105", newId(), "2026-10-04T14:20:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
  const deps = { loader: fixedConfigurationLoader(active("desk_reps")), repDays: w.repDays, transaction: memoryTransaction };
  const first = await refreshOpenRepDays(AFTER_MIDNIGHT, deps);
  assert.deepEqual([first.skipped, first.failures], [false, 0]);
  const alice = w.repDays.row(ALICE, "2026-10-04")!;
  const bob = w.repDays.row(BOB, "2026-10-04")!;
  assert.ok(alice && bob, "both desk reps get a frozen zero row");
  // 2026-10-04 is a Sunday: Alice's configured 5-day schedule gives 0 (no goal today); Bob's defaults give 100.
  assert.deepEqual([alice.goal_state, alice.goal_snapshot.goal, alice.goal_snapshot.scheduled], ["no_goal_today", 0, false]);
  assert.deepEqual([bob.goal_state, bob.goal_snapshot.goal, bob.goal_snapshot.scheduled], ["goal", 100, true]);
  const version = effectiveRoster(active("desk_reps").value.goals, [ALICE, BOB]).roster_version;
  assert.match(version!, /^roster-desk-/);
  assert.deepEqual([alice.goal_snapshot.roster_version, bob.goal_snapshot.roster_version, alice.goal_snapshot.configuration_version], [version, version, "v-test"]);
  assert.equal(w.repDays.row(CAROL, "2026-10-04"), null, "configured but not a desk rep: no zero row");
  assert.equal(w.repDays.row(BOB, "2026-10-05"), null, "never today");
  // The roster of yesterday was read at the end of 2026-10-04 New York (00:00 on 2026-10-05 = 04:00Z), never at now.
  assert.ok(w.repDays.deskRepQueries.length > 0);
  for (const at of w.repDays.deskRepQueries) assert.equal(at.toISOString(), "2026-10-05T04:00:00.000Z");
  // Idempotent.
  const before = JSON.stringify([...w.repDays.rows.entries()]);
  assert.equal((await refreshOpenRepDays(AFTER_MIDNIGHT, deps)).recounted, 0);
  assert.equal(JSON.stringify([...w.repDays.rows.entries()]), before);
});

test("desk_reps: a non-rep's calls recount as Not on roster (no goal), today's roster is read at now", async () => {
  const w = world();
  await applyContactSources([call(w.events, outboundCall("105", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
  const result = await recountRepDay({ agent_id: OUTSIDER, business_day: "2026-10-05" }, active("desk_reps"), NOW, w.repDays, SESSION);
  assert.equal(result.outcome, "written");
  assert.deepEqual([result.fields.goal_state, result.fields.goal_snapshot.goal, result.fields.actual_confirmed], ["not_on_roster", null, 1]);
  assert.deepEqual(w.repDays.deskRepQueries.map((d) => d.toISOString()), [NOW.toISOString()]);
  // The same Agent becomes a desk rep: today's (unfrozen) row follows the roster at once.
  w.repDays.deskRepIds = [ALICE, BOB, OUTSIDER];
  const again = await recountRepDay({ agent_id: OUTSIDER, business_day: "2026-10-05" }, active("desk_reps"), NOW, w.repDays, SESSION);
  assert.deepEqual([again.outcome, again.fields.goal_state, again.fields.goal_snapshot.goal], ["written", "goal", 100]);
});

test("materializesZeroRow: a past day and a member of the effective roster; explicit rule keeps the configured list", () => {
  const derived = effectiveRoster(active("desk_reps").value.goals, [ALICE, BOB]);
  assert.equal(materializesZeroRow({ agent_id: BOB, business_day: "2026-10-04" }, derived, "2026-10-05"), true);
  assert.equal(materializesZeroRow({ agent_id: CAROL, business_day: "2026-10-04" }, derived, "2026-10-05"), false);
  assert.equal(materializesZeroRow({ agent_id: BOB, business_day: "2026-10-05" }, derived, "2026-10-05"), false, "never today");
  const explicit = effectiveRoster(active(undefined).value.goals, [ALICE, BOB]);
  assert.equal(materializesZeroRow({ agent_id: CAROL, business_day: "2026-10-04" }, explicit, "2026-10-05"), true);
  assert.equal(materializesZeroRow({ agent_id: BOB, business_day: "2026-10-04" }, explicit, "2026-10-05"), false);
});

test("explicit rule: the recount never asks for desk reps", async () => {
  const w = world();
  await applyContactSources([call(w.events, outboundCall("101", NUMBER, "2026-10-05T14:10:00Z"))], { now: NOW, queueRepDays: false }, w.events, SESSION);
  const result = await recountRepDay({ agent_id: ALICE, business_day: "2026-10-05" }, active(undefined), NOW, w.repDays, SESSION);
  assert.deepEqual([result.outcome, result.fields.goal_snapshot.roster_version, result.fields.goal_snapshot.goal], ["written", "roster-1", 80]);
  assert.equal(w.repDays.deskRepQueries.length, 0);
});
