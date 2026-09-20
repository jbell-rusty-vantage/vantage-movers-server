import assert from "node:assert/strict";
import { test } from "node:test";
import { csiBudgetMonthBounds } from "./budgetPeriod";

test("budget month uses local date before UTC month rollover", () => {
  const bounds = csiBudgetMonthBounds(new Date("2026-10-01T02:00:00Z"), "America/New_York");
  assert.equal(bounds.month, "2026-09");
  assert.equal(bounds.period_start.toISOString(), "2026-09-01T04:00:00.000Z");
  assert.equal(bounds.period_end.toISOString(), "2026-10-01T04:00:00.000Z");
});

test("budget month spans DST without assuming a fixed UTC offset", () => {
  const bounds = csiBudgetMonthBounds(new Date("2026-03-15T12:00:00Z"), "America/New_York");
  assert.equal(bounds.period_start.toISOString(), "2026-03-01T05:00:00.000Z");
  assert.equal(bounds.period_end.toISOString(), "2026-04-01T04:00:00.000Z");
});

test("budget month rolls December into next year and rejects invalid time", () => {
  const bounds = csiBudgetMonthBounds(new Date("2026-12-20T12:00:00Z"), "Asia/Tokyo");
  assert.equal(bounds.month, "2026-12");
  assert.equal(bounds.period_end.toISOString(), "2026-12-31T15:00:00.000Z");
  assert.throws(() => csiBudgetMonthBounds(new Date(NaN), "America/New_York"));
});
