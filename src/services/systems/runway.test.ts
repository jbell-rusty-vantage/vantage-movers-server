import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, leastSquaresSlopePerDay, projectRunway, type RunwayPoint } from "./runway";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-07T12:00:00.000Z");
const daily = (values: number[]): RunwayPoint[] =>
  values.map((value, index) => ({ at: new Date(now.getTime() - (values.length - 1 - index) * DAY), value }));

test("fewer than 7 points uses the seed rate and says estimate", () => {
  const runway = projectRunway(daily([100, 100, 100]), 1_100, now, { seedRatePerDay: 10, capYears: 5 });
  assert.equal(runway.basis, "estimate");
  assert.equal(runway.points, 3);
  assert.equal(runway.rate_per_day, 10);
  assert.equal(runway.days_left, 100);
  assert.equal(runway.date, "2027-01-15");
  assert.equal(runway.label, "about 3 months (≈ Jan 2027)");
});

test("no points at all is still an estimate from the live reading", () => {
  const runway = projectRunway([], 1_000, now, { seedRatePerDay: 1, capYears: 5, current: 900 });
  assert.equal(runway.basis, "estimate");
  assert.equal(runway.points, 0);
  assert.equal(runway.days_left, 100);
});

test("7 or more points measures the least-squares slope", () => {
  const runway = projectRunway(daily([0, 2, 4, 6, 8, 10, 12]), 112, now, { seedRatePerDay: 999, capYears: 5 });
  assert.equal(runway.basis, "measured");
  assert.ok(Math.abs(runway.rate_per_day - 2) < 1e-9);
  assert.equal(runway.days_left, 50);
});

test("the slope uses at most the newest 30 points", () => {
  // 10 flat old points, then 30 points climbing 1 a day: only the climb counts.
  const values = [...Array(10).fill(0), ...Array.from({ length: 30 }, (_, i) => i)];
  const runway = projectRunway(daily(values), 1_000, now, { seedRatePerDay: 0, capYears: 15 });
  assert.ok(Math.abs(runway.rate_per_day - 1) < 1e-9);
});

test("a zero or negative slope is not growing", () => {
  const flat = projectRunway(daily([5, 5, 5, 5, 5, 5, 5]), 10, now, { seedRatePerDay: 1, capYears: 5 });
  assert.equal(flat.label, "not growing");
  assert.equal(flat.days_left, null);
  assert.equal(flat.date, null);
  const shrinking = projectRunway(daily([9, 8, 7, 6, 5, 4, 3]), 10, now, { seedRatePerDay: 1, capYears: 5 });
  assert.equal(shrinking.label, "not growing");
  assert.ok(shrinking.rate_per_day < 0);
  const zeroSeed = projectRunway([], 10, now, { seedRatePerDay: 0, capYears: 5, current: 1 });
  assert.equal(zeroSeed.label, "not growing");
});

test("the 5-year cap", () => {
  const runway = projectRunway([], 10_000, now, { seedRatePerDay: 1, capYears: 5, current: 0 });
  assert.equal(runway.label, "more than 5 years");
  assert.equal(runway.days_left, null);
  const inside = projectRunway([], 1_800, now, { seedRatePerDay: 1, capYears: 5, current: 0 });
  assert.equal(inside.days_left, 1_800);
});

test("the 15-year cap", () => {
  const runway = projectRunway([], 10_000_000, now, { seedRatePerDay: 1_478, capYears: 15, current: 363_022 });
  assert.equal(runway.label, "more than 15 years");
  const sixYears = projectRunway([], 10_000, now, { seedRatePerDay: 1, capYears: 15, current: 7_800 });
  assert.match(sixYears.label, /^about 6 years/);
});

test("a reading at or over the limit is already reached", () => {
  const runway = projectRunway([], 100, now, { seedRatePerDay: 1, capYears: 5, current: 120 });
  assert.equal(runway.days_left, 0);
  assert.equal(runway.label, "already reached");
});

test("the live reading overrides the newest point", () => {
  const runway = projectRunway(daily([10]), 110, now, { seedRatePerDay: 1, capYears: 5, current: 60 });
  assert.equal(runway.days_left, 50);
});

test("the duration reads in years and months", () => {
  assert.equal(formatDuration(0.2), "less than a day");
  assert.equal(formatDuration(12), "about 12 days");
  assert.equal(formatDuration(1), "about 1 day");
  assert.equal(formatDuration(365.25), "about 1 year");
  assert.equal(formatDuration(943), "about 2 years 7 months");
  assert.equal(formatDuration(61), "about 2 months");
});

test("the slope of fewer than two points is zero", () => {
  assert.equal(leastSquaresSlopePerDay([]), 0);
  assert.equal(leastSquaresSlopePerDay(daily([4])), 0);
});
