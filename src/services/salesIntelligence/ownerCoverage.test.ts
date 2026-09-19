import assert from "node:assert/strict";
import { test } from "node:test";
import { composeBudget, composeStage } from "./ownerCoverage";

test("budget unknown is distinct from a known zero remaining", () => {
  assert.deepEqual(composeBudget(null, 8000), {
    status: "unknown",
    month: null,
    ceiling_cents: 8000,
    actual_cents: null,
    reserved_cents: null,
    remaining_cents: null,
  });
  assert.deepEqual(
    composeBudget({ month: "2026-09", ceiling_cents: 8000, actual_cents: 1000, reserved_cents: 250 }, 8000),
    {
      status: "known",
      month: "2026-09",
      ceiling_cents: 8000,
      actual_cents: 1000,
      reserved_cents: 250,
      remaining_cents: 6750,
    },
  );
  assert.equal(
    composeBudget({ month: "2026-09", ceiling_cents: 100, actual_cents: 80, reserved_cents: 40 }, 100).remaining_cents,
    0,
  );
});

test("empty stage counts keep oldest queued null instead of a false zero age", () => {
  assert.deepEqual(composeStage({ pending: 0, leased: 0, retry: 0, paused: 0, dead_letter: 0 }, null), {
    pending: 0,
    leased: 0,
    retry: 0,
    paused: 0,
    dead_letter: 0,
    oldest_queued_at: null,
  });
  assert.equal(
    composeStage({ pending: 2, leased: 0, retry: 0, paused: 0, dead_letter: 1 }, new Date("2026-09-19T12:00:00.000Z"))
      .oldest_queued_at,
    "2026-09-19T12:00:00.000Z",
  );
});
