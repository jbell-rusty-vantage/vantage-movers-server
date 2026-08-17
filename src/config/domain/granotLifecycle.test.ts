import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRANOT_LIFECYCLE_FLAG_DEFAULTS,
  GRANOT_LIFECYCLE_FLAG_NAMES,
  anyLifecycleEffectEnabled,
  classifyExecutionMode,
  getGranotLifecycleFlags,
  parseExplicitBooleanFlag,
} from "./granotLifecycle";

test("[AC-31] foundation execution mode is historical without activation and permanent before cutoff", () => {
  const activatedAt = new Date("2026-08-17T16:00:00.000Z");
  assert.equal(
    classifyExecutionMode({
      captured_at: new Date("2026-08-17T15:00:00.000Z"),
      activated_at: null,
      shadow_mode: false,
    }),
    "historical_shadow",
  );
  assert.equal(
    classifyExecutionMode({
      captured_at: new Date("2026-08-17T15:59:59.999Z"),
      activated_at: activatedAt,
      shadow_mode: false,
    }),
    "historical_shadow",
  );
  assert.equal(
    classifyExecutionMode({
      captured_at: activatedAt,
      activated_at: activatedAt,
      shadow_mode: true,
    }),
    "live_shadow",
  );
  assert.equal(
    classifyExecutionMode({
      captured_at: new Date("2026-08-17T16:00:00.001Z"),
      activated_at: activatedAt,
      shadow_mode: false,
    }),
    "live",
  );
});

test("[AC-31] foundation channel never changes execution mode", () => {
  const input = {
    captured_at: new Date("2026-08-17T17:00:00.000Z"),
    activated_at: new Date("2026-08-17T16:00:00.000Z"),
    shadow_mode: true,
  };
  assert.equal(classifyExecutionMode(input), "live_shadow");
  assert.equal(classifyExecutionMode({ ...input }), "live_shadow");
});

test("lifecycle flags default to processing true, shadow true, and all effects false", () => {
  const flags = getGranotLifecycleFlags({});
  assert.deepEqual(GRANOT_LIFECYCLE_FLAG_NAMES, [
    "GRANOT_LIFECYCLE_PROCESSING_ENABLED",
    "GRANOT_LIFECYCLE_SHADOW_MODE",
    "GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED",
    "GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED",
    "GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED",
    "GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED",
    "GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED",
    "GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED",
    "GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED",
    "GRANOT_LIFECYCLE_EMAIL_ENABLED",
  ]);
  assert.deepEqual(flags, GRANOT_LIFECYCLE_FLAG_DEFAULTS);
  assert.equal(anyLifecycleEffectEnabled(flags), false);
});

test("malformed lifecycle flag values fail closed", () => {
  assert.throws(
    () => parseExplicitBooleanFlag("yes", true, "GRANOT_LIFECYCLE_SHADOW_MODE"),
    /explicit boolean/,
  );
  assert.equal(
    parseExplicitBooleanFlag("false", true, "GRANOT_LIFECYCLE_PROCESSING_ENABLED"),
    false,
  );
  assert.deepEqual(
    getGranotLifecycleFlags({
      GRANOT_LIFECYCLE_PROCESSING_ENABLED: "true",
      GRANOT_LIFECYCLE_SHADOW_MODE: "false",
    }),
    {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      processing_enabled: true,
      shadow_mode: false,
    },
  );
});
