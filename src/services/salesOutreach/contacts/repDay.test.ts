import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { deskTimingOf } from "../config/timing";
import { cadenceCallCoverage } from "../evidence/coverage";
import { countRepDay, emptyOtherOutboundBreakdown, repDayCoverage, type RepDayEventFacts } from "./repDay";
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

  test("countRepDay: both scopes from one event set; the headline follows the scope", () => {
    // c2 was derived before olr C8 (no association_reason): its "Other outbound" bucket is `unknown`.
    const other_outbound = { ...emptyOtherOutboundBreakdown(), unknown: 1 };
    const both = { actual_confirmed_all: 3, actual_confirmed_eligible: 2, actual_awaiting_all: 3, actual_awaiting_eligible: 1, unattributed: 1, other_outbound };
    assert.deepEqual(countRepDay(events, "all_outbound"), { ...both, actual_confirmed: 3, actual_awaiting_confirmation: 3 });
    assert.deepEqual(countRepDay(events, "eligible_new_quoted"), { ...both, actual_confirmed: 2, actual_awaiting_confirmation: 1 });
    assert.deepEqual(countRepDay([], "all_outbound"), {
      actual_confirmed: 0, actual_awaiting_confirmation: 0, unattributed: 0,
      actual_confirmed_all: 0, actual_confirmed_eligible: 0, actual_awaiting_all: 0, actual_awaiting_eligible: 0,
      other_outbound: emptyOtherOutboundBreakdown(),
    });
  });
});
