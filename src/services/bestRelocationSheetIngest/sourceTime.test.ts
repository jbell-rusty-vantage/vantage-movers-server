import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSourceDate } from "./sourceTime";
import { parseDateTime } from "./parsing";

const serial = (wall: string) => String((Date.parse(`${wall}Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

test("serial and textual source clocks agree across the general backfill cutoff and overnight boundaries", () => {
  for (const [wall, instant] of [
    ["2026-10-31T23:59:59", "2026-11-01T03:59:59.000Z"],
    ["2026-11-01T00:00:00", "2026-11-01T04:00:00.000Z"],
    ["2026-11-01T00:59:59", "2026-11-01T04:59:59.000Z"],
    ["2026-11-01T06:59:59", "2026-11-01T11:59:59.000Z"],
    ["2026-11-01T07:00:00", "2026-11-01T12:00:00.000Z"],
    ["2026-07-01T01:00:00", "2026-07-01T05:00:00.000Z"],
  ]) {
    assert.equal(parseSourceDate(wall)?.toISOString(), instant);
    assert.equal(parseSourceDate(serial(wall))?.toISOString(), instant);
  }
});

test("ambiguous DST clocks remain unresolved without an explicit source offset", () => {
  assert.equal(parseSourceDate("2026-11-01 01:30:00"), undefined);
  assert.equal(parseSourceDate(serial("2026-11-01T01:30:00")), undefined);
  assert.equal(parseSourceDate("2026-11-01T01:30:00-04:00")?.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(parseSourceDate("2026-11-01T01:30:00-05:00")?.toISOString(), "2026-11-01T06:30:00.000Z");
  assert.equal(parseSourceDate("2026-03-08 02:30:00"), undefined);
});

test("explicit workbook timezone controls serial clocks and split date/time serials", () => {
  assert.equal(parseSourceDate(serial("2026-11-03T01:00:00"), "Etc/UTC")?.toISOString(), "2026-11-03T01:00:00.000Z");
  assert.equal(parseDateTime(serial("2026-11-03T00:00:00"), "01:00:00", "America/New_York")?.toISOString(), "2026-11-03T06:00:00.000Z");
});
