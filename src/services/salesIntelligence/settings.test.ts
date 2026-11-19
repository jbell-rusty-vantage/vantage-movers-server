import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  csiSettingsCommandSchema,
  csiStoredPolicySchema,
  withRetiredPolicyFields,
} from "../../validation/v1/salesIntelligence";
import { defaultCsiPolicy } from "./policy";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

test("settings command requires update_settings and a retained policy; flags and retired settings are rejected", () => {
  const policy = defaultCsiPolicy();
  const command = { command: "update_settings", expected_revision: 1, policy, reason: "Owner accepted defaults" };
  assert.equal(csiSettingsCommandSchema.safeParse(command).success, true);
  assert.equal(csiSettingsCommandSchema.safeParse({ ...command, command: undefined }).success, false);
  assert.equal(csiSettingsCommandSchema.safeParse({ ...command, flags: { STT_ENABLED: true } }).success, false);
  for (const retired of [{ monthly_ceiling_cents: 8000 }, { first_action_due_staffed_minutes: 30 }, { inbound_followup_staffed_minutes: 240 }]) {
    assert.equal(csiSettingsCommandSchema.safeParse({ ...command, policy: { ...policy, ...retired } }).success, false, Object.keys(retired)[0]);
  }
  assert.equal(csiSettingsCommandSchema.safeParse({ ...command, policy: { ...policy, enabled_capabilities: ["analysis"] } }).success, false);
  assert.equal(csiSettingsCommandSchema.safeParse({ ...command, policy: { ...policy, retention: { audit_days: 730, audio_days: 90 } } }).success, false);
});

test("a new policy version carries the retired fields of the previous one forward, for rollback", () => {
  const previous = {
    version: "csi-policy-active", timezone: "America/New_York",
    staffed_hours: [{ day: 1, start_minute: 480, end_minute: 1200 }],
    first_action_due_staffed_minutes: 30, missed_callback_due_staffed_minutes: 15, going_cold_staffed_minutes: 1440,
    monthly_ceiling_cents: 8000, per_recording_ceiling_cents: 25, cooldown_attempts_24h: 3,
    enabled_capabilities: ["capture", "media", "transcription", "analysis", "nudges"],
    retention: { audio_days: 90, redacted_days: 365, audit_days: 400 },
    inbound_followup_staffed_minutes: 240,
    stray_unknown_field: "dropped",
  };
  const next = { ...defaultCsiPolicy(), version: "csi-policy-next", enabled_capabilities: ["capture" as const, "live" as const], retention: { audit_days: 500 } };

  const stored = withRetiredPolicyFields(next, previous);

  // Every field the pre-slimming strict reader requires is present, with the previous values.
  assert.equal(stored.first_action_due_staffed_minutes, 30);
  assert.equal(stored.missed_callback_due_staffed_minutes, 15);
  assert.equal(stored.going_cold_staffed_minutes, 1440);
  assert.equal(stored.monthly_ceiling_cents, 8000);
  assert.equal(stored.per_recording_ceiling_cents, 25);
  assert.equal(stored.cooldown_attempts_24h, 3);
  assert.equal(stored.inbound_followup_staffed_minutes, 240);
  assert.deepEqual(stored.retention, { audio_days: 90, redacted_days: 365, audit_days: 500 });
  // The retained settings are the new ones; retired capabilities are never re-enabled; unknown fields are dropped.
  assert.equal(stored.version, "csi-policy-next");
  assert.deepEqual(stored.enabled_capabilities, ["capture", "live"]);
  assert.equal("stray_unknown_field" in stored, false);
  // The slim reader sees only the retained policy.
  assert.deepEqual(csiStoredPolicySchema.parse(stored), next);
});
