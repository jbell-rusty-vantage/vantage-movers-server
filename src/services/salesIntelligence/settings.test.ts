import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { csiSettingsCommandSchema } from "../../validation/v1/salesIntelligence";
import { defaultCsiPolicy } from "./policy";
import { displayFlags, displayModels, nextPolicyVersion, policyVersionForCommand } from "./settings";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

test("kill switches are env display only and models never serialize secrets", () => {
  process.env.SALES_INTELLIGENCE_STT_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_NUDGE_ENABLED = "false";
  process.env.AI_GATEWAY_API_KEY = "secret-gateway";
  process.env.BLOB_READ_WRITE_TOKEN = "secret-blob";
  process.env.SALES_INTELLIGENCE_MCP_ENDPOINT = "https://mcp.example.test";
  const flags = displayFlags();
  const models = displayModels();
  assert.equal(flags.STT_ENABLED, true);
  assert.equal(flags.NUDGE_ENABLED, false);
  assert.equal(flags.EXTRACTION_ENABLED, false);
  assert.match(JSON.stringify(models), /gpt/);
  assert.equal(JSON.stringify({ flags, models }).includes("secret"), false);
  assert.equal(JSON.stringify({ flags, models }).includes("mcp.example"), false);
});

test("settings command requires update_settings and a full policy; extra flag fields are rejected", () => {
  const policy = defaultCsiPolicy();
  assert.equal(
    csiSettingsCommandSchema.safeParse({
      command: "update_settings",
      expected_revision: 1,
      policy,
      reason: "Owner accepted defaults",
    }).success,
    true,
  );
  assert.equal(
    csiSettingsCommandSchema.safeParse({
      expected_revision: 1,
      policy,
      reason: "Owner accepted defaults",
    }).success,
    false,
  );
  assert.equal(
    csiSettingsCommandSchema.safeParse({
      command: "update_settings",
      expected_revision: 1,
      policy,
      reason: "Owner accepted defaults",
      flags: { STT_ENABLED: true },
    }).success,
    false,
  );
});

test("policy versions stamped for Owner edits are unique", () => {
  const a = nextPolicyVersion(new Date("2026-09-19T16:00:00.000Z"));
  const b = nextPolicyVersion(new Date("2026-09-19T16:00:00.000Z"));
  assert.match(a, /^csi-policy-2026-09-19T16:00:00.000Z-[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  assert.equal(policyVersionForCommand("same-key"), policyVersionForCommand("same-key"));
  assert.notEqual(policyVersionForCommand("settings-a"), policyVersionForCommand("settings-b"));
});
