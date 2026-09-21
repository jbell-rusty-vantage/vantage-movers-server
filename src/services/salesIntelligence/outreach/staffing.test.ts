import assert from "node:assert/strict";
import { test } from "node:test";
import { staffedMinutesBetween, type Staffing } from "./staffing";

test("an Attention page reuses calendar conversions across old records", (t) => {
  const formatting = t.mock.method(Intl.DateTimeFormat.prototype, "formatToParts");
  const staffing: Staffing = { timezone: "America/New_York", staffed_hours: [1, 2, 3, 4, 5, 6].map(day => ({ day, start_minute: 480, end_minute: 1200 })) };
  for (let i = 0; i < 50; i++) {
    assert.equal(staffedMinutesBetween(new Date("2026-06-01T12:00:00Z"), new Date("2026-09-01T12:00:00Z"), staffing), 79 * 720);
  }
  assert.ok(formatting.mock.callCount() < 2000, `calendar conversions must be shared across a page; got ${formatting.mock.callCount()}`);
});

test("calendar cache follows changed policy hours and timezone", () => {
  const staffing: Staffing = { timezone: "America/New_York", staffed_hours: [{ day: 1, start_minute: 480, end_minute: 1200 }] };
  const start = new Date("2026-09-21T12:00:00Z"), end = new Date("2026-09-21T16:00:00Z");
  assert.equal(staffedMinutesBetween(start, end, staffing), 240);
  staffing.staffed_hours[0]!.start_minute = 600;
  assert.equal(staffedMinutesBetween(start, end, staffing), 120);
  staffing.timezone = "America/Los_Angeles";
  assert.equal(staffedMinutesBetween(start, end, staffing), 0);
});
