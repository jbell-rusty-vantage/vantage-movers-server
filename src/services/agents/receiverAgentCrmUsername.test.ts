import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import { applyGranotCrmUsernameReceiverMatch } from "./receiverAgentCrmUsername";

type MutableModel = Record<string, unknown>;

const originalFindOne = Agent.findOne as unknown;

afterEach(() => {
  (Agent as unknown as MutableModel).findOne = originalFindOne;
});

test("CRM username receiver match fills an empty receiver from inactive Agents too", async () => {
  const agentId = new mongoose.Types.ObjectId();
  (Agent as unknown as MutableModel).findOne = (filter: unknown) => ({
    exec: async () =>
      Agent.hydrate({
        _id: agentId,
        name: "Mike M",
        normalized_name: "mike m",
        active: false,
        role: "agent",
        created_from: "admin",
        granot_crm_username: "MIKEM",
      }),
    filter,
  });

  const lead: Record<string, unknown> = {};
  const result = await applyGranotCrmUsernameReceiverMatch(lead, " mikem ");

  assert.equal(result.status, "matched");
  assert.equal(result.changed, true);
  assert.equal(lead.receiver_agent?.toString(), agentId.toString());
  assert.equal(lead.receiver_agent_name_snapshot, "Mike M");
  assert.equal(lead.receiver_agent_source, "extension_crm_username_match");
  assert.equal(lead.receiver_agent_source_value, "MIKEM");
  assert.match(result.message, /inactive Agent/);
});

test("CRM username receiver match never overwrites an existing receiver", async () => {
  let findOneCalled = false;
  (Agent as unknown as MutableModel).findOne = () => {
    findOneCalled = true;
    return { exec: async () => null };
  };

  const existingAgentId = new mongoose.Types.ObjectId();
  const lead: Record<string, unknown> = {
    receiver_agent: existingAgentId,
    receiver_agent_name_snapshot: "Existing Agent",
  };

  const result = await applyGranotCrmUsernameReceiverMatch(lead, "MIKEM");

  assert.equal(result.status, "already_linked");
  assert.equal(findOneCalled, false);
  assert.equal(lead.receiver_agent, existingAgentId);
  assert.equal(lead.receiver_agent_name_snapshot, "Existing Agent");
});
