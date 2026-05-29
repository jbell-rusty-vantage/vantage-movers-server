import assert from "node:assert/strict";
import { test } from "node:test";
import { toFloridaTimestamp } from "./easternTime";

test("toFloridaTimestamp stores Eastern daylight time clock components", () => {
  const timestamp = toFloridaTimestamp(new Date("2026-05-29T21:35:42.123Z"));

  assert.equal(timestamp.toISOString(), "2026-05-29T17:35:42.123Z");
});

test("toFloridaTimestamp stores Eastern standard time clock components", () => {
  const timestamp = toFloridaTimestamp(new Date("2026-01-15T12:30:00.000Z"));

  assert.equal(timestamp.toISOString(), "2026-01-15T07:30:00.000Z");
});
