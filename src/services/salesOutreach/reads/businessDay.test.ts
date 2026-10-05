import assert from "node:assert/strict";
import { test } from "node:test";
import { isoWeekdayOf, newYorkBusinessDay, newYorkDayBounds, nextBusinessDay } from "./businessDay";
import { CAPTURE_CURRENT_TOLERANCE_MS, callsCoverageForDay, requiredCoverageThrough } from "./freshness";
import { resolveBusinessDay } from "./service";

test("NY midnight: the default business day flips at 00:00 New York, not UTC", () => {
  // EDT (UTC−4): 2026-10-04 23:59:59 NY = 2026-10-05T03:59:59Z.
  assert.equal(newYorkBusinessDay(new Date("2026-10-05T03:59:59.999Z")), "2026-10-04");
  assert.equal(newYorkBusinessDay(new Date("2026-10-05T04:00:00.000Z")), "2026-10-05");
  // EST (UTC−5) in winter.
  assert.equal(newYorkBusinessDay(new Date("2026-12-15T04:59:59.999Z")), "2026-12-14");
  assert.equal(newYorkBusinessDay(new Date("2026-12-15T05:00:00.000Z")), "2026-12-15");
  assert.deepEqual(resolveBusinessDay(undefined, new Date("2026-10-05T03:59:59Z")), { business_day: "2026-10-04", today: "2026-10-04" });
});

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

test("calendar helpers: next day across month/year ends and ISO weekdays", () => {
  assert.equal(nextBusinessDay("2026-10-31"), "2026-11-01");
  assert.equal(nextBusinessDay("2026-12-31"), "2027-01-01");
  assert.equal(nextBusinessDay("2028-02-28"), "2028-02-29");
  assert.equal(isoWeekdayOf("2026-10-04"), 7); // Sunday
  assert.equal(isoWeekdayOf("2026-10-05"), 1); // Monday
  assert.equal(isoWeekdayOf("2026-11-01"), 7);
});

test("future business days are refused; past and today are accepted", () => {
  const now = new Date("2026-10-04T16:00:00Z");
  assert.equal(resolveBusinessDay("2026-10-03", now).business_day, "2026-10-03");
  assert.equal(resolveBusinessDay("2026-10-04", now).business_day, "2026-10-04");
  assert.throws(() => resolveBusinessDay("2026-10-05", now), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "INVALID_INPUT");
    return true;
  });
});

test("coverage for a past fall-back day needs the Call Log through the 25-hour day's end", () => {
  const now = new Date("2026-11-03T15:00:00Z");
  const required = requiredCoverageThrough("2026-11-01", "2026-11-03", now);
  assert.equal(required.toISOString(), "2026-11-02T05:00:00.000Z");
  // Known complete through 04:59Z (23:59 EST) is not enough; 05:00Z is.
  assert.equal(callsCoverageForDay(new Date("2026-11-02T04:59:00Z"), required).state, "partial");
  assert.equal(callsCoverageForDay(new Date("2026-11-02T05:00:00Z"), required).state, "complete");
  // Today needs coverage through now minus the current tolerance.
  const today = requiredCoverageThrough("2026-11-03", "2026-11-03", now);
  assert.equal(today.getTime(), now.getTime() - CAPTURE_CURRENT_TOLERANCE_MS);
});
