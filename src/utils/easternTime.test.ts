import assert from "node:assert/strict";
import { test } from "node:test";
import { easternWallClockToUtc, parseFloridaCalendarDate } from "./easternTime";

test("parseFloridaCalendarDate stores YYYY-MM-DD as Florida calendar midnight UTC", () => {
  const parsed = parseFloridaCalendarDate("2026-05-21");

  assert.equal(parsed.toISOString(), "2026-05-21T00:00:00.000Z");
});

test("easternWallClockToUtc maps 8:00 AM Eastern to the matching UTC instant", () => {
  assert.equal(
    easternWallClockToUtc(2026, 1, 15, 8)?.toISOString(),
    "2026-01-15T13:00:00.000Z",
  );
  assert.equal(
    easternWallClockToUtc(2026, 7, 15, 8)?.toISOString(),
    "2026-07-15T12:00:00.000Z",
  );
});
