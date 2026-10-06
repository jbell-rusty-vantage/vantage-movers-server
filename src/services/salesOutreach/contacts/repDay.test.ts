import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { deskTimingOf } from "../config/timing";
import { cadenceCallCoverage } from "../evidence/coverage";
import { repDayCoverage } from "./repDay";
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
