import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  deriveBookedLeadAgentAllocations,
  officialBookingAllocations,
  receiverAttributionFromPrimaryAllocation,
  splitBinderEvenly,
} from "./agentAllocation.service";

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
