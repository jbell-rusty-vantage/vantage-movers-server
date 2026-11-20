/**
 * Stale processing leases (November 20 review): a killed worker's jobs return to `retrying`; a merely slow or
 * live worker's jobs are untouched. Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true with TEST_MODE=true on a loopback replica.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { isLoopbackMongoUri } from "../../../../ops/lib/loopback-mongo";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { connectMongo } from "../../../db";
import { SheetSyncJob } from "../../../models/SheetSyncJob";
import { MAX_STALE_LEASE_RECLAIMS, reclaimStaleProcessingJobs } from "./runSheetSyncDrain";

after(async () => { await mongoose.disconnect().catch(() => undefined); });

test("only jobs whose processing lease expired more than one lease period ago are reclaimed", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true).");
    return;
  }
  // reclaimStaleProcessingJobs updates every stale job in the database, so refuse anything but a loopback replica.
  assert.ok(isLoopbackMongoUri(process.env.MONGO_URI ?? ""), "Only an explicit loopback MONGO_URI is allowed");
  await connectMongo();
  assert.match(mongoose.connection.db?.databaseName ?? "", /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  assert.ok((hello.hosts as string[] | undefined ?? []).every((host) => isLoopbackMongoUri(`mongodb://${host}/`)), "every replica member must be loopback");
  const now = new Date(), lease = 120_000;
  const key = `stale-lease-proof:${new mongoose.Types.ObjectId().toHexString()}`;
  const seed = (name: string, fields: Record<string, unknown>) => ({ resource: "source_lead", operation: "call_lead.update", entity_model: "CallLead",
    entity_id: new mongoose.Types.ObjectId().toHexString(), coalescing_key: `${key}:${name}`, created_by: "api", due_at: new Date(+now - 600_000), ...fields });
  const rows = (await SheetSyncJob.insertMany([
    seed("killed", { status: "processing", lease_owner: "dead-worker", leased_until: new Date(+now - 3 * lease) }),
    seed("slow", { status: "processing", lease_owner: "slow-worker", leased_until: new Date(+now - lease / 2) }),
    seed("live", { status: "processing", lease_owner: "live-worker", leased_until: new Date(+now + lease) }),
    seed("waiting", { status: "pending", leased_until: new Date(0) }),
    seed("exhausted", { status: "processing", lease_owner: "dead-again", leased_until: new Date(+now - 3 * lease), stale_reclaims: MAX_STALE_LEASE_RECLAIMS }),
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
    assert.equal((killed as { stale_reclaims?: number }).stale_reclaims, 1, "each reclaim is counted");
    const exhausted = await byName("exhausted");
    assert.equal(exhausted.status, "failed", "a job that keeps killing its worker stops being reclaimed");
    assert.equal(exhausted.last_error, "stale processing lease reclaim limit reached");
    assert.equal(await reclaimStaleProcessingJobs(now, lease) >= 0, true);
    assert.equal((await byName("killed")).status, "retrying", "idempotent");
  } finally {
    await SheetSyncJob.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
  }
});
