import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import {
  deriveBookedLeadAgentAllocations,
  officialBookingAllocations,
  receiverAttributionFromPrimaryAllocation,
  resolveAgentAllocations,
  splitBinderEvenly,
} from "./agentAllocation.service";

type MutableModel = Record<string, unknown>;

const originalFindOne = Agent.findOne as unknown;

afterEach(() => {
  (Agent as unknown as MutableModel).findOne = originalFindOne;
});

test("even Binder split uses integer cents and gives the leftover cent to the primary Agent", () => {
  assert.deepEqual(splitBinderEvenly(100, 1), [100]);
  assert.deepEqual(splitBinderEvenly(100, 2), [50, 50]);
  assert.deepEqual(splitBinderEvenly(100.01, 2), [50.01, 50]);
  assert.deepEqual(
    deriveBookedLeadAgentAllocations({
      agent: "Alex",
      split_agent: "Sam",
      binder_amount: 100.01,
    }),
    [
      { agent_name: "Alex", binder_amount: 50.01 },
      { agent_name: "Sam", binder_amount: 50 },
    ],
  );
  assert.deepEqual(
    officialBookingAllocations({
      total_binder_amount: 100.01,
      primary_agent_id: "a".repeat(24),
      secondary_agent_id: "b".repeat(24),
    }),
    [
      { agent_id: "a".repeat(24), binder_amount: 50.01 },
      { agent_id: "b".repeat(24), binder_amount: 50 },
    ],
  );
});

test("Best Relocation allocation resolves an existing inactive agent", async () => {
  const capture: { filter?: unknown } = {};
  (Agent as unknown as MutableModel).findOne = (filter: unknown) => {
    capture.filter = filter;
    return {
      exec: async () => ({
        _id: new mongoose.Types.ObjectId(),
        name: "Former Agent",
        normalized_name: "former agent",
        active: false,
      }),
    };
  };

  const [allocation] = await resolveAgentAllocations(
    [{ agent_name: "Former Agent", binder_amount: 350 }],
    { includeInactive: true },
  );

  assert.deepEqual(capture.filter, {
    $or: [
      { normalized_name: "former agent" },
      { name_aliases: "former agent" },
    ],
  });
  assert.equal(allocation.agent_name_snapshot, "Former Agent");
  assert.equal(allocation.binder_amount, 350);
});

test("primary booking allocation becomes Best Relocation receiver attribution", () => {
  const primaryId = new mongoose.Types.ObjectId();
  const setAt = new Date("2026-07-24T18:30:00.000Z");

  const attribution = receiverAttributionFromPrimaryAllocation(
    [
      { agent: primaryId, agent_name_snapshot: "Manny", binder_amount: 350 },
      {
        agent: new mongoose.Types.ObjectId(),
        agent_name_snapshot: "Patrick",
        binder_amount: 350,
      },
    ],
    "Booked Deals:P123",
    setAt,
  );

  assert.deepEqual(attribution, {
    receiver_agent: primaryId,
    receiver_agent_name_snapshot: "Manny",
    receiver_agent_source: "best_relocation_sheet",
    receiver_agent_source_value: "Booked Deals:P123",
    receiver_agent_set_at: setAt,
  });
});

test("primary booking allocation does not replace existing receiver attribution", () => {
  const attribution = receiverAttributionFromPrimaryAllocation(
    [
      {
        agent: new mongoose.Types.ObjectId(),
        agent_name_snapshot: "Manny",
        binder_amount: 350,
      },
    ],
    "Booked Deals:P123",
    new Date(),
    new mongoose.Types.ObjectId(),
  );

  assert.equal(attribution, undefined);
});
