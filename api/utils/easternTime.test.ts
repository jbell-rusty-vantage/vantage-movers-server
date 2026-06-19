import assert from "node:assert/strict";
import { test } from "node:test";
import {
  floridaCalendarDateInputValue,
  floridaCalendarToday,
  formatFloridaCalendarDate,
  parseFloridaCalendarDate,
  toFloridaTimestamp,
} from "./easternTime";

test("parseFloridaCalendarDate stores YYYY-MM-DD as Florida calendar midnight UTC", () => {
  const parsed = parseFloridaCalendarDate("2026-05-21");

  assert.equal(parsed.toISOString(), "2026-05-21T00:00:00.000Z");
});

test("formatFloridaCalendarDate renders stored calendar dates without local timezone drift", () => {
  const formatted = formatFloridaCalendarDate(new Date("2026-05-21T00:00:00.000Z"));

  assert.equal(formatted, "May 21, 2026");
});

test("floridaCalendarToday uses the America/New_York calendar day", () => {
  const today = floridaCalendarToday(new Date("2026-06-01T03:00:00.000Z"));

  assert.equal(today.toISOString(), "2026-05-31T00:00:00.000Z");
});

test("floridaCalendarDateInputValue returns YYYY-MM-DD in Florida time", () => {
  assert.equal(
    floridaCalendarDateInputValue(new Date("2026-06-01T03:00:00.000Z")),
    "2026-05-31",
  );
});

test("toFloridaTimestamp stores Eastern daylight time clock components", () => {
  const timestamp = toFloridaTimestamp(new Date("2026-05-29T21:35:42.123Z"));

  assert.equal(timestamp.toISOString(), "2026-05-29T17:35:42.123Z");
});

test("toFloridaTimestamp stores Eastern standard time clock components", () => {
  const timestamp = toFloridaTimestamp(new Date("2026-01-15T12:30:00.000Z"));

  assert.equal(timestamp.toISOString(), "2026-01-15T07:30:00.000Z");
});
