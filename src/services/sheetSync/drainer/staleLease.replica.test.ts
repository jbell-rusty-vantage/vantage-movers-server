/**
 * Stale processing leases (November 20 review): a killed worker's jobs return to `retrying`; a merely slow or
 * live worker's jobs are untouched. Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true with TEST_MODE=true on a loopback replica.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { connectMongo } from "../../../db";
import { SheetSyncJob } from "../../../models/SheetSyncJob";
import { reclaimStaleProcessingJobs } from "./runSheetSyncDrain";

after(async () => { await mongoose.disconnect().catch(() => undefined); });

test("only jobs whose processing lease expired more than one lease period ago are reclaimed", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true).");
    return;
  }
  await connectMongo();
  assert.match(mongoose.connection.db?.databaseName ?? "", /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  const now = new Date(), lease = 120_000;
  const key = `stale-lease-proof:${new mongoose.Types.ObjectId().toHexString()}`;
  const seed = (name: string, fields: Record<string, unknown>) => ({ resource: "source_lead", operation: "call_lead.update", entity_model: "CallLead",
    entity_id: new mongoose.Types.ObjectId().toHexString(), coalescing_key: `${key}:${name}`, created_by: "api", due_at: new Date(+now - 600_000), ...fields });
  const rows = (await SheetSyncJob.insertMany([
    seed("killed", { status: "processing", lease_owner: "dead-worker", leased_until: new Date(+now - 3 * lease) }),
    seed("slow", { status: "processing", lease_owner: "slow-worker", leased_until: new Date(+now - lease / 2) }),
    seed("live", { status: "processing", lease_owner: "live-worker", leased_until: new Date(+now + lease) }),
    seed("waiting", { status: "pending", leased_until: new Date(0) }),
  ] as never)) as unknown as Array<{ _id: mongoose.Types.ObjectId }>;
  try {
    assert.ok(await reclaimStaleProcessingJobs(now, lease) >= 1);
    const byName = async (name: string) => SheetSyncJob.findOne({ coalescing_key: `${key}:${name}` }).lean().orFail();
    const killed = await byName("killed");
    assert.equal(killed.status, "retrying");
    assert.equal(+killed.due_at, +now);
    assert.equal(+killed.leased_until!, 0);
    assert.equal(killed.last_error, "stale processing lease reclaimed");
    assert.equal(killed.attempts, 0, "a reclaim is not a delivery attempt");
    assert.equal((await byName("slow")).status, "processing", "an expiry within one lease period is left to its owner");
    assert.equal((await byName("live")).status, "processing");
    assert.equal((await byName("waiting")).status, "pending");
    assert.equal(await reclaimStaleProcessingJobs(now, lease) >= 0, true);
    assert.equal((await byName("killed")).status, "retrying", "idempotent");
  } finally {
    await SheetSyncJob.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
  }
});
