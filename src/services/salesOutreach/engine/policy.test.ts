import assert from "node:assert/strict";
import { test } from "node:test";
import { FINAL_01_CADENCE_VALUE } from "./approvedStartingValues";
import { resolveEnginePolicy } from "./policy";

test("missing, unknown-key and inconsistent values fail closed; nothing falls back to a default", () => {
  assert.equal(resolveEnginePolicy(undefined).ok, false);
  assert.equal(resolveEnginePolicy({}).ok, false);
  assert.equal(resolveEnginePolicy({ ...FINAL_01_CADENCE_VALUE, extra_flag: true }).ok, false);
  const gap = resolveEnginePolicy({
    ...FINAL_01_CADENCE_VALUE,
    new_call_slots: [{ first_day: 1, last_day: 3, deadline_minutes: [720, 1200], optional_extra_calls: 1 }, { first_day: 6, last_day: null, deadline_minutes: [1200], optional_extra_calls: 0 }],
  });
  assert.equal(gap.ok, false);
  const badHours = resolveEnginePolicy({ ...FINAL_01_CADENCE_VALUE, working_days: { ...FINAL_01_CADENCE_VALUE.working_days, opening_minute: 1200, closing_minute: 480 } });
  assert.equal(badHours.ok, false);
  assert.equal(resolveEnginePolicy({ ...FINAL_01_CADENCE_VALUE, timezone: "Mars/Olympus" }).ok, false);
});
