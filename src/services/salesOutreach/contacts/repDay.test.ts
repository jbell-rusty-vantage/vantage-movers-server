import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { deskTimingOf } from "../config/timing";
import { cadenceCallCoverage } from "../evidence/coverage";
import { composeRepDayRow, countRepDay, repDayCoverage, type RepDayEventFacts } from "./repDay";
import { callMarks } from "./testingPipeline";

/**
 * olr C0 (lane A §A3 rep-day part, decision D-A3): rep-day coverage is goal call coverage — the observed
 * Call Log watermark (no provisional-row cap) minus the settlement allowance, never past the derivation —
 * against `as_of − today_coverage_tolerance` today, both from `deskTimingOf`.
 */

const TODAY = "2026-10-05";
const NOW = new Date("2026-10-05T19:00:00.000Z"); // 15:00 New York
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
const DEFAULT = deskTimingOf(null);
const timingOf = (evidence: Record<string, number>) => deskTimingOf(salesOutreachConfigurationValueSchema.parse({ evidence }));

describe("olr C0 rep-day coverage", () => {
  test("a provisional cap that leaves the capped watermark 50 min behind still yields complete with observed 18 min behind", () => {
    const marks = callMarks(min(-50), min(-50), null, { capture: min(-18), derived: min(-17) });
    const coverage = repDayCoverage(TODAY, TODAY, NOW, marks, DEFAULT);
    assert.deepEqual(coverage, {
      state: "complete",
      // min(observed capture − 2 min settlement, observed derivation)
      known_complete_through: min(-20).toISOString(),
      required_through: min(-25).toISOString(),
      gaps: [],
    });
    // The cadence coverage of the same marks (verdicts keep the provisional cap) is still 52 min behind.
    assert.equal(cadenceCallCoverage(marks, DEFAULT)?.toISOString(), min(-52).toISOString());
    // Before the first A3 reconcile/sweep writes the observed fields, the capped ones decide: partial.
    const capped = repDayCoverage(TODAY, TODAY, NOW, callMarks(min(-50), min(-50)), DEFAULT);
    assert.deepEqual([capped.state, capped.known_complete_through, capped.gaps], ["partial", min(-52).toISOString(), [{ from: min(-52).toISOString(), to: min(-25).toISOString() }]]);
  });

  test("the derivation still bounds goal coverage: observed capture ahead of the sweep is not counted", () => {
    const behindSweep = repDayCoverage(TODAY, TODAY, NOW, callMarks(min(-50), min(-50), null, { capture: min(-18), derived: min(-40) }), DEFAULT);
    assert.deepEqual([behindSweep.state, behindSweep.known_complete_through], ["partial", min(-40).toISOString()]);
    assert.equal(repDayCoverage(TODAY, TODAY, NOW, callMarks(null, null, null, { capture: min(-18) }), DEFAULT).state, "unknown", "no derivation row = unknown");
  });

  test("tolerance from configuration", () => {
    const marks = callMarks(min(-50), min(-50), null, { capture: min(-18), derived: min(-17) });
    // Default today tolerance 25 min: complete through as_of − 20 min reaches as_of − 25.
    assert.equal(repDayCoverage(TODAY, TODAY, NOW, marks, DEFAULT).state, "complete");
    // `evidence.today_coverage_tolerance_minutes: 18` (> settlement 2 + finalization 15): as_of − 18 is not reached.
    const tight = repDayCoverage(TODAY, TODAY, NOW, marks, timingOf({ today_coverage_tolerance_minutes: 18 }));
    assert.deepEqual([tight.state, tight.required_through], ["partial", min(-18).toISOString()]);
    // `evidence.call_settlement_allowance_minutes: 8`: observed − 8 = as_of − 26, short of as_of − 25.
    const settled = repDayCoverage(TODAY, TODAY, NOW, marks, timingOf({ call_settlement_allowance_minutes: 8 }));
    assert.deepEqual([settled.state, settled.known_complete_through], ["partial", min(-26).toISOString()]);
  });

  test("a past day needs the whole day; the today tolerance does not move it; before coverage_from it is unknown", () => {
    const after = new Date("2026-10-06T04:30:00Z"); // 00:30 New York on 2026-10-06
    const marksAt = (through: Date) => callMarks(min(-600), min(-600), new Date("2026-10-01T04:00:00Z"), { capture: through, derived: through });
    const short = repDayCoverage(TODAY, "2026-10-06", after, marksAt(new Date("2026-10-06T04:01:00Z")), timingOf({ today_coverage_tolerance_minutes: 120 }));
    assert.deepEqual([short.state, short.required_through], ["partial", "2026-10-06T04:00:00.000Z"]);
    assert.equal(repDayCoverage(TODAY, "2026-10-06", after, marksAt(new Date("2026-10-06T04:02:00Z")), DEFAULT).state, "complete");
    const early = repDayCoverage("2026-09-30", "2026-10-06", after, marksAt(new Date("2026-10-06T04:02:00Z")), DEFAULT);
    assert.deepEqual([early.state, early.known_complete_through], ["unknown", null]);
  });
});

/** olr C1b: both scopes counted in one pass, stored, and part of the fingerprint. */
describe("olr C1b two-scope counts", () => {
  const AGENT = "a".repeat(24);
  const goals = salesOutreachConfigurationValueSchema.parse({
    goals: { roster_version: "r1", default_scheduled_goal: 100, rep_work_schedules: [{ agent_id: AGENT, working_days: [1, 2, 3, 4, 5, 6, 7] }] },
  }).goals;
  const event = (source_id: string, goal_credit: RepDayEventFacts["goal_credit"], goal_scope_eligible: boolean): RepDayEventFacts => ({ source_id, goal_credit, goal_scope_eligible });
  const events = [
    event("c1", "confirmed", true),
    event("c2", "confirmed", false),
    event("c2", "confirmed", false), // a second row of one canonical call: one credit
    event("c3", "confirmed", true),
    event("w1", "awaiting_confirmation", true),
    event("w2", "awaiting_confirmation", false),
    event("w3", "awaiting_confirmation", false),
    event("n1", "none", true), // no credit in either scope
  ];
  const row = (input: readonly RepDayEventFacts[], scope: "all_outbound" | "eligible_new_quoted" = "all_outbound") =>
    composeRepDayRow({
      agent_id: AGENT, business_day: TODAY, today: TODAY, now: NOW, events: input, scope, goals, configuration_version: "v1",
      existing_snapshot: null, watermarks: callMarks(NOW, NOW), timing: DEFAULT,
    });

  test("countRepDay: both scopes from one event set; the headline follows the scope", () => {
    const both = { actual_confirmed_all: 3, actual_confirmed_eligible: 2, actual_awaiting_all: 3, actual_awaiting_eligible: 1, unattributed: 1 };
    assert.deepEqual(countRepDay(events, "all_outbound"), { ...both, actual_confirmed: 3, actual_awaiting_confirmation: 3 });
    assert.deepEqual(countRepDay(events, "eligible_new_quoted"), { ...both, actual_confirmed: 2, actual_awaiting_confirmation: 1 });
    assert.deepEqual(countRepDay([], "all_outbound"), {
      actual_confirmed: 0, actual_awaiting_confirmation: 0, unattributed: 0,
      actual_confirmed_all: 0, actual_confirmed_eligible: 0, actual_awaiting_all: 0, actual_awaiting_eligible: 0,
    });
  });

  test("composeRepDayRow stores the four fields under either scope", () => {
    for (const scope of ["all_outbound", "eligible_new_quoted"] as const) {
      const fields = row(events, scope);
      assert.deepEqual(
        [fields.count_scope, fields.actual_confirmed_all, fields.actual_confirmed_eligible, fields.actual_awaiting_all, fields.actual_awaiting_eligible],
        [scope, 3, 2, 3, 1],
      );
    }
  });

  test("the fingerprint changes when only an eligible count changes (headline, unattributed and scope unchanged)", () => {
    const before = row(events);
    // w2 becomes eligible: the all-outbound headline, awaiting_all and unattributed stay; only actual_awaiting_eligible moves.
    const after = row(events.map((e) => (e.source_id === "w2" ? { ...e, goal_scope_eligible: true } : e)));
    assert.deepEqual(
      [after.actual_confirmed, after.actual_awaiting_confirmation, after.unattributed, after.actual_awaiting_eligible],
      [before.actual_confirmed, before.actual_awaiting_confirmation, before.unattributed, before.actual_awaiting_eligible + 1],
    );
    assert.notEqual(after.input_fingerprint, before.input_fingerprint);
    // Same inputs, same fingerprint.
    assert.equal(row(events).input_fingerprint, before.input_fingerprint);
  });
});
