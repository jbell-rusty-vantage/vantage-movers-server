import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deskTimingOf } from "../config/timing";
import {
  cadenceCallCoverage,
  callWatermarksOf,
  goalCallCoverage,
  NO_CALL_WATERMARKS,
  smsCoverage,
  type CallWatermarks,
} from "./coverage";

const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00Z`);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const DEFAULT = deskTimingOf(null);

/** Capture capped 50 min behind by a stuck provisional row; observed only the 15-min lag behind. */
const marks: CallWatermarks = {
  capture_known: t("19:06"),
  capture_observed: t("19:41"),
  derived_known: t("19:06"),
  derived_observed: t("19:41"),
  coverage_from: t("04:00"),
};

describe("evidence coverage (olr A3)", () => {
  test("cadence coverage = min(capped capture − allowance, derivation watermark)", () => {
    assert.equal(iso(cadenceCallCoverage(marks, DEFAULT)), "2026-10-05T19:04:00.000Z", "capture − 2 min binds");
    assert.equal(iso(cadenceCallCoverage({ ...marks, derived_known: t("18:30") }, DEFAULT)), "2026-10-05T18:30:00.000Z", "derivation behind binds (F2)");
    assert.equal(cadenceCallCoverage({ ...marks, derived_known: null }, DEFAULT), null, "nothing derived yet: unknowable");
    assert.equal(cadenceCallCoverage({ ...marks, capture_known: null }, DEFAULT), null);
  });

  test("goal coverage ignores the provisional cap (D-A3) but keeps the allowance and the derivation bound", () => {
    assert.equal(iso(goalCallCoverage(marks, DEFAULT)), "2026-10-05T19:39:00.000Z", "observed − 2 min");
    assert.equal(iso(goalCallCoverage({ ...marks, derived_observed: t("19:20") }, DEFAULT)), "2026-10-05T19:20:00.000Z", "never past what was derived");
    assert.ok(+goalCallCoverage(marks, DEFAULT)! > +cadenceCallCoverage(marks, DEFAULT)!, "the cadence engine keeps the cap");
  });

  test("goal coverage falls back to the capped watermarks before the first A3 run writes the observed ones", () => {
    const legacy = { ...marks, capture_observed: null, derived_observed: null };
    assert.equal(iso(goalCallCoverage(legacy, DEFAULT)), iso(cadenceCallCoverage(legacy, DEFAULT)));
    // Capture already observed, sweep not yet: the derived known bounds it.
    assert.equal(iso(goalCallCoverage({ ...marks, derived_observed: null }, DEFAULT)), "2026-10-05T19:06:00.000Z");
    assert.equal(goalCallCoverage(NO_CALL_WATERMARKS, DEFAULT), null);
    // An observed value older than its capped twin (never written by A3 code) is read as the capped one.
    const stale = { ...marks, derived_known: t("19:30"), derived_observed: t("19:00") };
    assert.equal(iso(goalCallCoverage(stale, DEFAULT)), "2026-10-05T19:30:00.000Z");
    assert.ok(+goalCallCoverage(stale, DEFAULT)! >= +cadenceCallCoverage(stale, DEFAULT)!, "goal coverage is never behind cadence coverage");
  });

  test("the settlement allowance comes from configuration", () => {
    const five = deskTimingOf({ evidence: { call_settlement_allowance_minutes: 5 } } as never);
    assert.equal(iso(cadenceCallCoverage(marks, five)), "2026-10-05T19:01:00.000Z");
    assert.equal(iso(goalCallCoverage(marks, five)), "2026-10-05T19:36:00.000Z");
    const zero = deskTimingOf({ evidence: { call_settlement_allowance_minutes: 0 } } as never);
    assert.equal(iso(cadenceCallCoverage(marks, zero)), "2026-10-05T19:06:00.000Z");
  });

  test("callWatermarksOf maps the two sync-state rows, in any order, either missing", () => {
    const rows = [
      { scope: "outreach_contact_calls", known_complete_through: t("19:00"), observed_complete_through: t("19:30"), cursor: { outreach_coverage_from: t("04:00") } },
      { scope: "rep_sms:101", known_complete_through: t("12:00") },
      { scope: "call_log_all_directions", known_complete_through: t("19:05"), observed_complete_through: t("19:35") },
    ];
    assert.deepEqual(callWatermarksOf(rows), {
      capture_known: t("19:05"),
      capture_observed: t("19:35"),
      derived_known: t("19:00"),
      derived_observed: t("19:30"),
      coverage_from: t("04:00"),
    });
    assert.deepEqual(callWatermarksOf([]), NO_CALL_WATERMARKS);
    assert.deepEqual(callWatermarksOf([{ scope: "call_log_all_directions", known_complete_through: t("19:05") }]), {
      ...NO_CALL_WATERMARKS,
      capture_known: t("19:05"),
    });
  });

  test("SMS coverage is the worst mailbox; none, or any mailbox without coverage, is unknowable", () => {
    assert.equal(iso(smsCoverage([{ known_complete_through: t("19:00") }, { known_complete_through: t("18:20") }, { known_complete_through: t("19:10") }])), "2026-10-05T18:20:00.000Z");
    assert.equal(smsCoverage([]), null);
    assert.equal(smsCoverage([{ known_complete_through: t("19:00") }, { known_complete_through: null }]), null);
    assert.equal(smsCoverage([{ known_complete_through: t("19:00") }, {}]), null);
  });
});
