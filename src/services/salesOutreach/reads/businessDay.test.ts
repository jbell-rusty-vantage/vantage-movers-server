import assert from "node:assert/strict";
import { test } from "node:test";
import { newYorkBusinessDay, newYorkDayBounds } from "./businessDay";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { deskTimingOf } from "../config/timing";
import { callsCoverageForDay, requiredCoverageThrough } from "./freshness";

test("DST: fall-back day is 25 hours, spring-forward day is 23 hours, and midnights resolve on both sides", () => {
  const fall = newYorkDayBounds("2026-11-01");
  assert.equal(fall.start.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(fall.end.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(fall.end.getTime() - fall.start.getTime(), 25 * 3_600_000);
  const spring = newYorkDayBounds("2026-03-08");
  assert.equal(spring.start.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(spring.end.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 3_600_000);
  // 23:30 EST on the fall-back day is still Nov 1; 00:00 EST Nov 2 is the next day.
  assert.equal(newYorkBusinessDay(new Date("2026-11-02T04:30:00Z")), "2026-11-01");
  assert.equal(newYorkBusinessDay(new Date("2026-11-02T05:00:00Z")), "2026-11-02");
  // The repeated 01:30 hour (both EDT and EST) is the same business day.
  assert.equal(newYorkBusinessDay(new Date("2026-11-01T05:30:00Z")), "2026-11-01");
  assert.equal(newYorkBusinessDay(new Date("2026-11-01T06:30:00Z")), "2026-11-01");
});

test("coverage for a past fall-back day needs the Call Log through the 25-hour day's end", () => {
  const now = new Date("2026-11-03T15:00:00Z");
  const required = requiredCoverageThrough("2026-11-01", "2026-11-03", now, deskTimingOf(null));
  assert.equal(required.toISOString(), "2026-11-02T05:00:00.000Z");
  // Known complete through 04:59Z (23:59 EST) is not enough; 05:00Z is.
  assert.equal(callsCoverageForDay(new Date("2026-11-02T04:59:00Z"), required).state, "partial");
  assert.equal(callsCoverageForDay(new Date("2026-11-02T05:00:00Z"), required).state, "complete");
  // Today needs coverage through now minus the today tolerance (olr C0: `deskTimingOf`, default 25 min, configurable).
  const today = requiredCoverageThrough("2026-11-03", "2026-11-03", now, deskTimingOf(null));
  assert.equal(today.getTime(), now.getTime() - 25 * 60_000);
  const forty = deskTimingOf(salesOutreachConfigurationValueSchema.parse({ evidence: { today_coverage_tolerance_minutes: 40 } }));
  assert.equal(requiredCoverageThrough("2026-11-03", "2026-11-03", now, forty).getTime(), now.getTime() - 40 * 60_000);
  // The tolerance never moves a past day's requirement.
  assert.equal(requiredCoverageThrough("2026-11-01", "2026-11-03", now, forty).toISOString(), required.toISOString());
});
