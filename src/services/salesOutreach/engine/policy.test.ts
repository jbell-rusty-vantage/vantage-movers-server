import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FINAL_01_CADENCE_VALUE } from "./approvedStartingValues";
import { cadenceConfigurationValueSchema, CADENCE_FIELDS, resolveEnginePolicy } from "./policy";

const defaults = JSON.parse(
  readFileSync(join(process.cwd(), "docs/sales-outreach-desk/contracts/configuration-defaults.json"), "utf8"),
) as { value: { cadence: Record<string, unknown> } };

test("the cadence encoding covers exactly the CONTRACTS/configuration-defaults field names", () => {
  assert.deepEqual([...CADENCE_FIELDS].sort(), Object.keys(defaults.value.cadence).sort());
});

test("the bootstrap (all-null) cadence parses but fails closed with every field listed", () => {
  const bootstrap = { ...defaults.value.cadence };
  assert.equal(cadenceConfigurationValueSchema.safeParse(bootstrap).success, true, "nulls are a valid persisted bootstrap");
  const result = resolveEnginePolicy(bootstrap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONFIGURATION_UNAVAILABLE");
    assert.ok(result.reasons.some((r) => r.startsWith("cadence.new_call_slots: missing")));
    assert.ok(!result.reasons.some((r) => r.startsWith("cadence.timezone")), "timezone is present in the bootstrap");
  }
});

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

test("FINAL-01 resolves to the approved engine policy (P01–P06, P10a values)", () => {
  const result = resolveEnginePolicy(FINAL_01_CADENCE_VALUE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const p = result.policy;
  assert.equal(p.calendar.timezone, "America/New_York");
  assert.equal(p.calendar.working_weekdays.length, 7);
  assert.deepEqual([p.calendar.opening_minute, p.calendar.closing_minute], [480, 1200]);
  assert.deepEqual(p.new_cadence.call_bands.map((b) => b.deadline_minutes.length), [2, 2, 1]);
  assert.equal(p.new_cadence.spacing_minutes, 60);
  assert.equal(p.arrival.initial_response_working_minutes, 30);
  assert.equal(p.callback.window_minutes, 15);
  assert.deepEqual(p.cooldown, { threshold: 3, window_hours: 24 });
  assert.equal(p.quoted.activation_call_through_minute, 1170);
});
