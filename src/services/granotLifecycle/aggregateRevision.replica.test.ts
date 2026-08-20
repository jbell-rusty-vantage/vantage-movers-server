import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import {
  compareAndSwapDomainRevision,
  DOMAIN_REVISION_CONFLICT,
} from "./aggregateRevision";

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(mongoose.connection.db?.databaseName ?? "")) {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

test("[AC-21] replica CAS: one winner increments once; loser is DOMAIN_REVISION_CONFLICT", async (t) => {
  if (!(await replicaReady(t))) return;
  const collection = mongoose.connection.db?.collection("u09_domain_revision_cas");
  assert.ok(collection);
  await collection.deleteMany({});
  const inserted = await collection.insertOne({ domain_revision: 0 });
  t.after(async () => {
    await collection.deleteMany({ _id: inserted.insertedId });
  });
  const first = await compareAndSwapDomainRevision(collection, {
    _id: inserted.insertedId,
    domain_revision: 0,
  });
  const second = await compareAndSwapDomainRevision(collection, {
    _id: inserted.insertedId,
    domain_revision: 0,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.domain_revision, 1);
  }
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.code, DOMAIN_REVISION_CONFLICT);
  }
  const stored = await collection.findOne({ _id: inserted.insertedId });
  assert.equal(stored?.domain_revision, 1);

  const concurrentId = (await collection.insertOne({ domain_revision: 0 })).insertedId;
  t.after(async () => {
    await collection.deleteOne({ _id: concurrentId });
  });
  const raced = await Promise.race([
    Promise.all([
      compareAndSwapDomainRevision(collection, {
        _id: concurrentId,
        domain_revision: 0,
      }),
      compareAndSwapDomainRevision(collection, {
        _id: concurrentId,
        domain_revision: 0,
      }),
    ]),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("CAS race timed out")), 10_000);
    }),
  ]);
  assert.equal(raced.filter((result) => result.ok).length, 1);
  assert.equal(
    raced.filter((result) => !result.ok && result.code === DOMAIN_REVISION_CONFLICT).length,
    1,
  );
  const racedDoc = await collection.findOne({ _id: concurrentId });
  assert.equal(racedDoc?.domain_revision, 1);
});
