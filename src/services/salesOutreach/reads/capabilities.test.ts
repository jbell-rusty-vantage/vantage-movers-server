import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutreachActor } from "../auth";
import type { ConfigurationInspection } from "../config/load";
import { completeConfigurationInput, TEST_FINAL01_CADENCE } from "../evaluation/testing";
import { salesOutreachCapabilitiesSchema } from "../../../validation/v1/salesOutreachReads";
import { composeCapabilities } from "./capabilities";
import { activeInspection } from "./testing";

/**
 * S4 changes 3–4: `permitted_views` lists Activity for every desk role with the desk and Settings for a
 * Manager with an active configuration; `cadence_summary` copies the configured cadence 1:1 for every
 * role whenever the configuration is active.
 */

const ROLES: Record<OutreachActor["role"], OutreachActor> = {
  owner: { role: "owner", actor: { kind: "owner", id: "o", request_id: "r", run_id: null }, agent_id: null },
  manager: { role: "manager", actor: { kind: "manager", id: "m", request_id: "r", run_id: null }, agent_id: null },
  rep: { role: "rep", actor: { kind: "rep", id: "a", request_id: "r", run_id: null } as never, agent_id: "a".repeat(24) },
};
const base = { contract_version: "sod-v1", as_of: "2026-10-05T15:00:00.000Z", timezone: "America/New_York", scope: { role: "owner", agent_id: null } } as const;
const compose = (role: OutreachActor["role"], inspected: ConfigurationInspection) =>
  salesOutreachCapabilitiesSchema.parse(composeCapabilities(ROLES[role], inspected, { ...base, scope: { role, agent_id: ROLES[role].agent_id } }));

const deskOn = activeInspection(completeConfigurationInput({ goal_metrics_enabled: true }));
const deskOff = activeInspection({ ...completeConfigurationInput(), controls: { desk_enabled: false } });
const uninitialized: ConfigurationInspection = { state: "uninitialized" };
const unavailable: ConfigurationInspection = { state: "unavailable", reason: "hash_mismatch", version: "v9", revision: 9, updated_at: null, updated_by: null };

test("permitted_views: Activity for every desk role with the desk; Manager Settings follows the active configuration; a Rep never gets Settings", () => {
  const views = (role: OutreachActor["role"], inspected: ConfigurationInspection) => compose(role, inspected).permitted_views;
  assert.deepEqual(views("owner", deskOn), ["team", "my", "activity", "settings", "numbers", "accounts"]);
  assert.deepEqual(views("manager", deskOn), ["team", "my", "activity", "settings"]);
  assert.deepEqual(views("rep", deskOn), ["my", "activity"]);
  // Desk off but configuration active: Manager keeps attendance (day_override), Owner keeps Settings.
  assert.deepEqual(views("owner", deskOff), ["settings", "numbers", "accounts"]);
  assert.deepEqual(views("manager", deskOff), ["settings"]);
  assert.ok(compose("manager", deskOff).permitted_commands.includes("day_override"), "Settings matches the command it holds");
  assert.deepEqual(views("rep", deskOff), []);
  for (const inspected of [uninitialized, unavailable]) {
    assert.deepEqual(views("owner", inspected), ["settings", "numbers", "accounts"], "Owner behaviour unchanged");
    assert.deepEqual(views("manager", inspected), []);
    assert.deepEqual(views("rep", inspected), []);
  }
});

test("cadence_summary: the configured cadence copied 1:1, identical for Owner/Manager/Rep, even with the desk off", () => {
  const owner = compose("owner", deskOn).cadence_summary;
  assert.deepEqual(owner, {
    policy_version: TEST_FINAL01_CADENCE.policy_version,
    new: {
      days_1_3_calls: { required: 2, optional: 1 },
      call_slots: [
        { from_day: 1, to_day: 5, calls_per_day: 2 },
        { from_day: 6, to_day: null, calls_per_day: 1 },
      ],
      sms_sequence: { initial_days: [1, 2, 3], repeat_from_day: 6, repeat_every_days: 3 },
    },
    quoted: null,
  });
  assert.deepEqual(compose("manager", deskOn).cadence_summary, owner);
  assert.deepEqual(compose("rep", deskOn).cadence_summary, owner);
  assert.deepEqual(compose("rep", deskOff).cadence_summary, owner);
  const text = JSON.stringify(owner);
  for (const secret of ["minute", "approval_ref", "batch_size", "paused"]) assert.equal(text.includes(secret), false, `no ${secret}`);
});

test("cadence_summary: null when the configuration is uninitialized or unavailable; unconfigured values are null", () => {
  for (const role of ["owner", "manager", "rep"] as const) {
    assert.equal(compose(role, uninitialized).cadence_summary, null);
    assert.equal(compose(role, unavailable).cadence_summary, null);
  }
  const bare = compose("rep", activeInspection({ controls: { desk_enabled: true } })).cadence_summary;
  assert.deepEqual(bare, { policy_version: null, new: { days_1_3_calls: null, call_slots: null, sms_sequence: null }, quoted: null });
});
