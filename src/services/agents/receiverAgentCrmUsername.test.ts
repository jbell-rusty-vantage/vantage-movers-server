import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import {
  applyGranotCrmUsernameReceiverMatch,
  findAgentByGranotCrmUsername,
} from "./receiverAgentCrmUsername";

type MutableModel = Record<string, unknown>;

const originalFindOne = Agent.findOne as unknown;

afterEach(() => {
  (Agent as unknown as MutableModel).findOne = originalFindOne;
});

test("automatic CRM username receiver matching excludes inactive Agents", async () => {
  let capturedFilter: unknown;
  (Agent as unknown as MutableModel).findOne = (filter: unknown) => {
    capturedFilter = filter;
    return { exec: async () => null };
  };

  const lead: Record<string, unknown> = {};
  const result = await applyGranotCrmUsernameReceiverMatch(lead, " mikem ");

  assert.equal(result.status, "not_found");
  assert.equal(result.changed, false);
  assert.deepEqual(capturedFilter, {
    "granot_identity.username": "MIKEM",
    active: true,
  });
  assert.equal(lead.receiver_agent, undefined);
});

test("findAgentByGranotCrmUsername prefers embedded granot_identity username", async () => {
  let capturedFilter: unknown;
  const agentId = new mongoose.Types.ObjectId();
  (Agent as unknown as MutableModel).findOne = (filter: unknown) => {
    capturedFilter = filter;
    return {
      exec: async () => ({
        _id: agentId,
        name: "Mike M",
        normalized_name: "mike m",
        active: true,
        granot_identity: { username: "MIKEM", verified: true },
      }),
    };
  };

  const agent = await findAgentByGranotCrmUsername("mikem");

  assert.ok(agent);
  assert.equal(agent._id.toString(), agentId.toString());
  assert.deepEqual(capturedFilter, {
    "granot_identity.username": "MIKEM",
    active: true,
  });
});

test("findAgentByGranotCrmUsername never reads the retained flat compatibility field", async () => {
  let capturedFilter: unknown;
  (Agent as unknown as MutableModel).findOne = (filter: unknown) => {
    capturedFilter = filter;
    return { exec: async () => null };
  };

  await findAgentByGranotCrmUsername("JACOB");

  assert.deepEqual(capturedFilter, {
    "granot_identity.username": "JACOB",
    active: true,
  });
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
