import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import {
  createCatalogItem,
  listCatalogItems,
  resolveActiveAgentByName,
  resolveAgentByName,
  resolveActiveMerchantName,
} from "./catalog.service";

type MutableModel = Record<string, unknown>;

const originalAgentCreate = Agent.create as unknown;
const originalAgentFind = Agent.find as unknown;
const originalAgentFindOne = Agent.findOne as unknown;
const originalMerchantCreate = Merchant.create as unknown;
const originalMerchantFind = Merchant.find as unknown;
const originalMerchantFindOne = Merchant.findOne as unknown;

afterEach(() => {
  (Agent as unknown as MutableModel).create = originalAgentCreate;
  (Agent as unknown as MutableModel).find = originalAgentFind;
  (Agent as unknown as MutableModel).findOne = originalAgentFindOne;
  (Merchant as unknown as MutableModel).create = originalMerchantCreate;
  (Merchant as unknown as MutableModel).find = originalMerchantFind;
  (Merchant as unknown as MutableModel).findOne = originalMerchantFindOne;
});

test("catalog create trims and normalizes merchant names", async () => {
  (Merchant as unknown as MutableModel).create = async (input: Record<string, unknown>) => ({
    toObject: () => ({ _id: new mongoose.Types.ObjectId(), ...input }),
  });

  const item = await createCatalogItem("merchants", {
    name: "  Paper   Check ",
    active: true,
  });

  assert.equal(item.name, "Paper Check");
  assert.equal(item.normalized_name, "paper check");
  assert.equal(item.active, true);
});

test("active catalog list excludes inactive rows by default", async () => {
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

  const items = await listCatalogItems("agents");

  assert.deepEqual(capture.filter, { active: true });
  assert.equal(items[0].name, "Austin");
});

test("agent resolution rejects inactive or unknown names", async () => {
  (Agent as unknown as MutableModel).findOne = () => ({
    exec: async () => null,
  });

  await assert.rejects(
    () => resolveActiveAgentByName("Former Agent"),
    /Unknown or inactive agent: Former Agent/,
  );
});

test("agent resolution can include an existing inactive agent", async () => {
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

  const agent = await resolveAgentByName("Former Agent", { includeInactive: true });

  assert.deepEqual(capture.filter, { normalized_name: "former agent" });
  assert.equal(agent.active, false);
});

test("merchant resolution returns canonical display name", async () => {
  (Merchant as unknown as MutableModel).findOne = () => ({
    exec: async () => ({ name: "Paper Check" }),
  });

  const name = await resolveActiveMerchantName("paper   check");

  assert.equal(name, "Paper Check");
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
