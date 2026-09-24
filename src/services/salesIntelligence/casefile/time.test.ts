import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDate, dollars, duration, etDaysBetween, fullDate, fullTime, granotMoney, relativeDays, timelineDate, timelineTime } from "./time";

test("ET formats (spec §4.3): full outside the timeline, year dropped inside it only for as_of's year", () => {
  assert.equal(fullTime("2026-09-15T22:30:00.000Z"), "Tue Sep 15, 2026 6:30 PM ET");
  assert.equal(fullDate("2026-09-15T22:30:00.000Z"), "Tue Sep 15, 2026");
  assert.equal(timelineTime("2026-09-15T22:30:00.000Z", "2026-09-23T20:10:00.000Z"), "Tue Sep 15 6:30 PM");
  assert.equal(timelineTime("2025-12-31T22:30:00.000Z", "2026-01-02T20:10:00.000Z"), "Wed Dec 31, 2025 5:30 PM");
  assert.equal(timelineDate("2026-09-18T15:00:00.000Z", "2026-09-23T20:10:00.000Z"), "Fri Sep 18");
  assert.equal(fullTime(null), "an unknown time");
});

test("DST: both sides of the spring-forward and fall-back transitions render in local ET", () => {
  // Spring forward, Sun Mar 8 2026: 1:59 AM EST is 06:59Z; 3:00 AM EDT is 07:00Z.
  assert.equal(fullTime("2026-03-08T06:59:00.000Z"), "Sun Mar 8, 2026 1:59 AM ET");
  assert.equal(fullTime("2026-03-08T07:00:00.000Z"), "Sun Mar 8, 2026 3:00 AM ET");
  // Fall back, Sun Nov 1 2026: 1:30 AM happens twice (05:30Z EDT, 06:30Z EST).
  assert.equal(fullTime("2026-11-01T05:30:00.000Z"), "Sun Nov 1, 2026 1:30 AM ET");
  assert.equal(fullTime("2026-11-01T06:30:00.000Z"), "Sun Nov 1, 2026 1:30 AM ET");
  // Oct 31 11:59 PM EDT (03:59Z) and Nov 1 12:00 AM EDT (04:00Z) are different ET days; 1:30 AM EDT and EST are the same day.
  assert.equal(etDaysBetween("2026-11-01T03:59:00.000Z", "2026-11-01T04:00:00.000Z"), 1);
  assert.equal(etDaysBetween("2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"), 0);
});

test("ET day boundaries: 11:59 PM and 12:00 AM are different days; relative wording from as_of", () => {
  assert.equal(etDaysBetween("2026-09-24T03:59:00.000Z", "2026-09-24T04:00:00.000Z"), 1);
  assert.equal(relativeDays("2026-09-23T13:00:00.000Z", "2026-09-23T20:10:00.000Z"), "today");
  assert.equal(relativeDays("2026-09-22T13:00:00.000Z", "2026-09-23T20:10:00.000Z"), "yesterday");
  assert.equal(relativeDays("2026-09-21T13:00:00.000Z", "2026-09-23T20:10:00.000Z"), "2 days ago");
  assert.equal(relativeDays("2026-09-25T13:00:00.000Z", "2026-09-23T20:10:00.000Z"), "in 2 days");
});

test("money (spec §4.4): normalized only when the raw text parses cleanly, otherwise quoted", () => {
  assert.equal(granotMoney("6600.00"), "$6,600");
  assert.equal(granotMoney("$7,100"), "$7,100");
  assert.equal(granotMoney("7,100.50"), "$7,100.50");
  assert.equal(granotMoney("0"), "$0");
  assert.equal(granotMoney("6600.00 USD"), '"6600.00 USD"');
  assert.equal(granotMoney("TBD"), '"TBD"');
  assert.equal(granotMoney(""), null);
  assert.equal(dollars(4200), "$4,200");
  assert.equal(dollars(1050.5), "$1,050.50");
});

test("calendar dates never shift by zone; durations are compact", () => {
  assert.equal(calendarDate("2026-10-10"), "Oct 10, 2026");
  assert.equal(calendarDate("2026-10-10T00:00:00.000Z"), "Oct 10, 2026");
  assert.equal(duration(252), "4m12s");
  assert.equal(duration(45), "45s");
  assert.equal(duration(3725), "1h02m");
  assert.equal(duration(null), "duration unknown");
});
