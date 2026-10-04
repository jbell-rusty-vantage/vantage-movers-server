import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Types } from "mongoose";
import { CSI_RETIRED_JOB_STAGES } from "../../config/domain/salesIntelligence";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { retireLegacyCsiJobs } from "./jobs";

/**
 * Unit view of the retired-stage fence (slimming SPEC §7.4). The replica proof is
 * `ops/test-csi-enqueue-replica.ts`; this pins the exact filter and update without Mongo.
 */
type Call = { filter: Record<string, unknown>; update?: Record<string, unknown> };

const collection = getSalesIntelligenceJobModel().collection as unknown as Record<string, unknown>;
const originals = { find: collection.find, updateMany: collection.updateMany };
const originalDeployment = process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID;

beforeEach(() => {
  process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "csi-unit";
});

afterEach(() => {
  collection.find = originals.find;
  collection.updateMany = originals.updateMany;
  if (originalDeployment === undefined) delete process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID;
  else process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = originalDeployment;
});

function stubCollection(rows: Array<{ _id: Types.ObjectId; stage: string }>) {
  const calls: { find: Call[]; updateMany: Call[] } = { find: [], updateMany: [] };
  collection.find = (filter: Record<string, unknown>) => {
    calls.find.push({ filter });
    const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => rows };
    return cursor;
  };
  collection.updateMany = async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    calls.updateMany.push({ filter, update });
    return { modifiedCount: rows.length };
  };
  return calls;
}

test("the fence marks runnable retired-stage rows retired, revokes their lease and leaves completed_at unset", async () => {
  const rows = [
    { _id: new Types.ObjectId(), stage: "analysis" },
    { _id: new Types.ObjectId(), stage: "outreach_ensure" },
  ];
  const calls = stubCollection(rows);
  const now = new Date("2026-10-04T12:00:00.000Z");

  const result = await retireLegacyCsiJobs({ now });

  assert.deepEqual(result, { retired: 2, stages: { analysis: 1, outreach_ensure: 1 } });
  const filter = calls.find[0]!.filter;
  assert.equal(filter.deployment, "csi-unit");
  assert.deepEqual(filter.stage, { $in: [...CSI_RETIRED_JOB_STAGES] });
  assert.deepEqual(filter.status, { $in: ["pending", "leased", "retry", "paused"] });
  const update = calls.updateMany[0]!.update as { $set: Record<string, unknown>; $inc: Record<string, unknown> };
  assert.deepEqual(update.$set, { status: "retired", reason: "stage_retired", lease_owner: null, leased_until: null, updatedAt: now });
  assert.equal("completed_at" in update.$set, false, "the TTL must not remove a fenced row before the purge backs it up");
  assert.deepEqual(update.$inc, { lease_epoch: 1 });
});

test("the fence writes nothing when no retired-stage row is runnable", async () => {
  const calls = stubCollection([]);

  assert.deepEqual(await retireLegacyCsiJobs(), { retired: 0, stages: {} });
  assert.equal(calls.updateMany.length, 0);
});
