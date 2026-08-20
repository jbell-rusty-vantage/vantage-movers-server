import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLeadSmsQuietHoursDeferral } from "./quietHours";

test("midnight through 6:59 AM Eastern defers to 8:00 AM the same Eastern day", () => {
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(
      new Date("2026-01-15T05:00:00.000Z"),
    )?.toISOString(),
    "2026-01-15T13:00:00.000Z",
  );
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(
      new Date("2026-01-15T11:59:59.000Z"),
    )?.toISOString(),
    "2026-01-15T13:00:00.000Z",
  );
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(
      new Date("2026-07-15T04:00:00.000Z"),
    )?.toISOString(),
    "2026-07-15T12:00:00.000Z",
  );
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(
      new Date("2026-07-15T10:59:59.000Z"),
    )?.toISOString(),
    "2026-07-15T12:00:00.000Z",
  );
});

test("7:00 AM Eastern and later send immediately", () => {
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(new Date("2026-01-15T12:00:00.000Z")),
    null,
  );
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(new Date("2026-01-16T04:59:59.000Z")),
    null,
  );
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(new Date("2026-07-15T11:00:00.000Z")),
    null,
  );
  assert.equal(
    resolveLeadSmsQuietHoursDeferral(new Date("2026-07-16T03:59:59.000Z")),
    null,
  );
});
