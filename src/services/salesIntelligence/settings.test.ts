import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  CSI_RETIRED_POLICY_FIELDS,
  csiPersistedPolicySchema,
  csiSettingsCommandSchema,
  csiStoredPolicySchema,
  withRetiredPolicyFields,
} from "../../validation/v1/salesIntelligence";
import { defaultCsiPolicy } from "./policy";
import { displayFlags, nextPolicyVersion, policyVersionForCommand } from "./settings";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

test("kill switches are env display only and carry no provider configuration", () => {
  process.env.SALES_INTELLIGENCE_NUDGE_ENABLED = "false";
  process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "true";
  process.env.AI_GATEWAY_API_KEY = "secret-gateway";
  const flags = displayFlags();
  assert.equal(flags.NUDGE_ENABLED, false);
  assert.equal(flags.CAPTURE_WEBHOOK, true);
  assert.equal(JSON.stringify(flags).includes("secret"), false);
  for (const retired of ["STT_ENABLED", "EXTRACTION_ENABLED", "MEDIA_ENABLED", "OUTREACH_ENSURE", "MOVE_ASSESSMENT"]) {
    assert.equal(retired in flags, false, retired);
  }
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

test("a policy version stored before the slimming reads as its retained settings only", () => {
  const legacy = {
    version: "csi-policy-legacy", timezone: "America/New_York",
    staffed_hours: [{ day: 1, start_minute: 480, end_minute: 1200 }],
    first_action_due_staffed_minutes: 30, missed_callback_due_staffed_minutes: 15, going_cold_staffed_minutes: 1440,
    monthly_ceiling_cents: 8000, per_recording_ceiling_cents: 25, cooldown_attempts_24h: 3,
    enabled_capabilities: ["capture", "media", "transcription", "analysis", "nudges"],
    retention: { audio_days: 90, redacted_days: 365, audit_days: 400 },
    inbound_followup_staffed_minutes: 240,
  };
  assert.deepEqual(csiStoredPolicySchema.parse(legacy), {
    version: "csi-policy-legacy", timezone: "America/New_York",
    staffed_hours: [{ day: 1, start_minute: 480, end_minute: 1200 }],
    enabled_capabilities: ["capture", "nudges"],
    retention: { audit_days: 400 },
  });
});

test("policy versions stamped for Owner edits are unique", () => {
  const a = nextPolicyVersion(new Date("2026-09-19T16:00:00.000Z"));
  const b = nextPolicyVersion(new Date("2026-09-19T16:00:00.000Z"));
  assert.match(a, /^csi-policy-2026-09-19T16:00:00.000Z-[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  assert.equal(policyVersionForCommand("same-key"), policyVersionForCommand("same-key"));
  assert.notEqual(policyVersionForCommand("settings-a"), policyVersionForCommand("settings-b"));
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

test("with no previous version only the retained policy is stored, and nothing else may be", () => {
  const policy = defaultCsiPolicy();
  const stored = withRetiredPolicyFields(policy, undefined);
  assert.deepEqual(stored, policy);
  for (const field of CSI_RETIRED_POLICY_FIELDS) assert.equal(field in stored, false, field);
  assert.equal(csiPersistedPolicySchema.safeParse({ ...policy, models: { stt: "x" } }).success, false);
  assert.equal(csiPersistedPolicySchema.safeParse({ ...policy, monthly_ceiling_cents: -1 }).success, false);
  assert.equal(csiPersistedPolicySchema.safeParse({ ...policy, enabled_capabilities: ["analysis"] }).success, false);
});
