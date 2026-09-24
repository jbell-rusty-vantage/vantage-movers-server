import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOverviewPeriod } from "./periods";

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

test("S9 periods: ET day boundaries on the spring-forward Sunday (fixed clock)", () => {
  // 2026-03-08 is the DST start: midnight is EST (05:00Z), the next midnight EDT (04:00Z), a 23-hour day.
  const now = at("2026-03-08T16:00:00.000Z"); // 12:00 EDT, a Sunday
  const today = resolveOverviewPeriod("today", now);
  assert.deepEqual([today.from_day, today.to_day, iso(today.start), iso(today.end)], ["2026-03-08", "2026-03-08", "2026-03-08T05:00:00.000Z", iso(now)]);
  // Lead `timestamp` is stored as ET wall clock in UTC: its bounds are the UTC midnight of the day key → ET wall-clock now.
  assert.deepEqual([iso(today.lead_start), iso(today.lead_end)], ["2026-03-08T00:00:00.000Z", "2026-03-08T12:00:00.000Z"]);
  const yesterday = resolveOverviewPeriod("yesterday", now);
  assert.deepEqual([yesterday.from_day, iso(yesterday.start), iso(yesterday.end)], ["2026-03-07", "2026-03-07T05:00:00.000Z", "2026-03-08T05:00:00.000Z"]);
  assert.deepEqual([iso(yesterday.lead_start), iso(yesterday.lead_end)], ["2026-03-07T00:00:00.000Z", "2026-03-08T00:00:00.000Z"]);
  // This week is Mon–Sun ET: on a Sunday it starts the Monday before.
  const week = resolveOverviewPeriod("this_week", now);
  assert.deepEqual([week.from_day, week.to_day, week.days.length, iso(week.start)], ["2026-03-02", "2026-03-08", 7, "2026-03-02T05:00:00.000Z"]);
  const last7 = resolveOverviewPeriod("last_7_days", now);
  assert.deepEqual([last7.from_day, last7.days.length], ["2026-03-02", 7]);
  const last30 = resolveOverviewPeriod("last_30_days", now);
  assert.deepEqual([last30.from_day, last30.days.length, iso(last30.start)], ["2026-02-07", 30, "2026-02-07T05:00:00.000Z"]);
});

test("S9 periods: late evening ET is still today; the 23-hour and 25-hour days close at the right instant", () => {
  const lateSpring = resolveOverviewPeriod("yesterday", at("2026-03-10T03:30:00.000Z")); // 2026-03-09 23:30 EDT → yesterday = the DST day
  assert.deepEqual([lateSpring.from_day, iso(lateSpring.start), iso(lateSpring.end)], ["2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]);
  const late = resolveOverviewPeriod("today", at("2026-03-09T03:30:00.000Z")); // 23:30 EDT on 03-08
  assert.equal(late.from_day, "2026-03-08");
  // 2026-11-01 is the DST end: midnight EDT (04:00Z) to the next midnight EST (05:00Z), a 25-hour day.
  const fall = resolveOverviewPeriod("yesterday", at("2026-11-02T15:00:00.000Z"));
  assert.deepEqual([fall.from_day, iso(fall.start), iso(fall.end)], ["2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]);
  // 23:59 EST on the 1st is 04:59Z on the 2nd; 05:00Z is midnight EST.
  assert.equal(resolveOverviewPeriod("today", at("2026-11-02T04:59:00.000Z")).from_day, "2026-11-01");
  assert.equal(resolveOverviewPeriod("today", at("2026-11-02T05:00:00.000Z")).from_day, "2026-11-02");
});

test("S9 periods: this month, and custom ranges (inclusive days, capped at today, bounded)", () => {
  const month = resolveOverviewPeriod("this_month", at("2026-10-01T03:00:00.000Z")); // 2026-09-30 23:00 EDT
  assert.deepEqual([month.from_day, month.to_day, month.days.length], ["2026-09-01", "2026-09-30", 30]);
  const now = at("2026-09-24T18:00:00.000Z");
  const custom = resolveOverviewPeriod("custom", now, { from: "2026-03-07", to: "2026-03-08" });
  assert.deepEqual([iso(custom.start), iso(custom.end), iso(custom.lead_start), iso(custom.lead_end)],
    ["2026-03-07T05:00:00.000Z", "2026-03-09T04:00:00.000Z", "2026-03-07T00:00:00.000Z", "2026-03-09T00:00:00.000Z"]);
  const capped = resolveOverviewPeriod("custom", now, { from: "2026-09-20", to: "2026-12-31" });
  assert.deepEqual([capped.to_day, iso(capped.end)], ["2026-09-24", iso(now)]);
  assert.throws(() => resolveOverviewPeriod("custom", now, { from: "2026-03-09", to: "2026-03-08" }));
  assert.throws(() => resolveOverviewPeriod("custom", now, { from: "2026-01-01", to: "2026-09-01" }), "longer than 92 days");
  assert.throws(() => resolveOverviewPeriod("custom", now, { from: "2026-10-01", to: "2026-10-02" }), "entirely in the future");
  assert.throws(() => resolveOverviewPeriod("custom", now, {}));
});
