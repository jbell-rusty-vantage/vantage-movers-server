import assert from "node:assert/strict";
import { test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { deskRosterVersion, effectiveRoster, onRoster, rosterInstant, rosterRuleOf } from "./rule";

/**
 * P08a-1 (F2): the derived roster is a pure function of the configuration's settings and the desk reps
 * the caller resolved; the explicit rule is the configured list unchanged.
 */

const A = "a".repeat(24);
const B = "b".repeat(24);
const C = "c".repeat(24);

const goalsOf = (extra: Record<string, unknown> = {}) =>
  salesOutreachConfigurationValueSchema.parse({
    goals: {
      roster_version: "roster-explicit",
      default_scheduled_goal: 100,
      zero_goal_rule: "no_goal_today_excluded_from_denominator",
      rep_work_schedules: [
        { agent_id: A, working_days: [1, 2, 3, 4, 5], scheduled_goal: 80 },
        { agent_id: C, working_days: [1, 2, 3, 4, 5, 6, 7] },
      ],
      ...extra,
    },
  }).goals;

test("explicit (absent key): the configured list is the roster with its own version; desk reps are ignored", () => {
  const goals = goalsOf();
  assert.equal(rosterRuleOf(goals), "explicit");
  const roster = effectiveRoster(goals, [A, B]);
  assert.equal(roster.rule, "explicit");
  assert.equal(roster.roster_version, "roster-explicit");
  assert.deepEqual(
    roster.members.map((m) => [m.agent_id, m.schedule_source, m.scheduled_goal]),
    [
      [A, "configured", 80],
      [C, "configured", null],
    ],
  );
  assert.equal(onRoster(roster, B), false);
});

test("desk_reps: the resolved desk reps are the roster; settings join by agent, others take the defaults; the configured non-rep is dropped", () => {
  const goals = goalsOf({ roster_rule: "desk_reps" });
  assert.equal(rosterRuleOf(goals), "desk_reps");
  const roster = effectiveRoster(goals, [B, A, A.toUpperCase()]);
  assert.equal(roster.rule, "desk_reps");
  assert.deepEqual(
    roster.members.map((m) => [m.agent_id, m.schedule_source, [...m.working_days], m.scheduled_goal]),
    [
      [A, "configured", [1, 2, 3, 4, 5], 80],
      [B, "default", [1, 2, 3, 4, 5, 6, 7], null],
    ],
    "sorted by id, de-duplicated case-insensitively; C (configured, not a rep) is not a member",
  );
  assert.equal(onRoster(roster, C), false);
  assert.equal(roster.roster_version, deskRosterVersion([A, B]));
  assert.match(roster.roster_version!, /^roster-desk-[0-9a-f]{12}$/);
});

test("desk_reps: the version is a deterministic digest of the member set (order and case do not matter; membership does)", () => {
  assert.equal(deskRosterVersion([B, A]), deskRosterVersion([A, B]));
  assert.equal(deskRosterVersion([A.toUpperCase(), B]), deskRosterVersion([A, B]));
  assert.notEqual(deskRosterVersion([A, B]), deskRosterVersion([A]));
  assert.equal(effectiveRoster(goalsOf({ roster_rule: "desk_reps" }), null).members.length, 0, "no desk reps resolved = an empty roster, never the explicit list");
});

test("rosterInstant: today and later read at now; a past day at the end of that New York day, never after now", () => {
  const now = new Date("2026-10-06T15:00:00.000Z"); // 11:00 New York on 2026-10-06
  assert.equal(rosterInstant("2026-10-06", "2026-10-06", now).toISOString(), now.toISOString());
  assert.equal(rosterInstant("2026-10-07", "2026-10-06", now).toISOString(), now.toISOString());
  assert.equal(rosterInstant("2026-10-05", "2026-10-06", now).toISOString(), "2026-10-06T04:00:00.000Z", "end of 2026-10-05 New York (EDT)");
  // Just after midnight: yesterday's end is later than now? No — it equals midnight, which is ≤ now.
  const afterMidnight = new Date("2026-10-06T04:00:30.000Z");
  assert.equal(rosterInstant("2026-10-05", "2026-10-06", afterMidnight).toISOString(), "2026-10-06T04:00:00.000Z");
});
