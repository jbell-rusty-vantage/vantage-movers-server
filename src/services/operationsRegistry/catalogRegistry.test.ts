import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import {
  listRegistryAgents,
  listRegistryMerchants,
} from "./catalogRegistry";

type MutableModel = Record<string, unknown>;

const originalAgentFind = Agent.find;
const originalMerchantFind = Merchant.find;

afterEach(() => {
  (Agent as unknown as MutableModel).find = originalAgentFind;
  (Merchant as unknown as MutableModel).find = originalMerchantFind;
});

test("registry agent list excludes inactive rows by default", async () => {
  const capture: { filter?: unknown } = {};
  (Agent as unknown as MutableModel).find = (filter: unknown) => {
    capture.filter = filter;
    return chain([
      {
        _id: new mongoose.Types.ObjectId(),
        name: "Austin",
        normalized_name: "austin",
        active: true,
        role: "agent",
        created_from: "seed",
      },
    ]);
  };

  const items = await listRegistryAgents();

  assert.deepEqual(capture.filter, { active: true });
  assert.equal(items[0]?.name, "Austin");
  assert.equal(items[0]?.active, true);
});

test("registry merchant list supports include_inactive", async () => {
  const capture: { filter?: unknown } = {};
  (Merchant as unknown as MutableModel).find = (filter: unknown) => {
    capture.filter = filter;
    return chain([]);
  };

  await listRegistryMerchants({ includeInactive: true });

  assert.deepEqual(capture.filter, {});
});

function chain(result: unknown) {
  return {
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}
