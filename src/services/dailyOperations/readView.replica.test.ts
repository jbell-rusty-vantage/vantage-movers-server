import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { createMongoDailyOperationsReadViewStore, getCachedDailyOperationsReadView, DailyOperationsReadViewUnavailable } from "./readViewCache";
import { getDailyOperationsReadViewModel, type DailyOperationsReadViewDocument } from "../../models/DailyOperationsReadView";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";

const enabled = Boolean(process.env.DAILY_OPERATIONS_REPLICA_URI);
const dbName = process.env.TEST_MONGO_DATABASE_NAME;
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DAILY_OPERATIONS_REPLICA_URI!, /^mongodb:\/\/127\.0\.0\.1:27191\//);
  assert.match(dbName ?? "", /^testvantagemovers_dailyopsread[a-z0-9_]*$/);
  assert.equal(process.env.TEST_MODE, "true");
  assert.equal(getMongoDatabaseName(), dbName);
  process.env.MONGO_URI = process.env.DAILY_OPERATIONS_REPLICA_URI;
  await connectMongo();
  await getDailyOperationsReadViewModel().createCollection();
});
after(async () => {
  if (!enabled) return;
  // This fixture owns only an explicit isolated test database/collection.
  assert.match(getMongoDatabaseName(), /^testvantagemovers_dailyopsread[a-z0-9_]*$/);
  const model = getDailyOperationsReadViewModel();
  assert.ok(model.db.db);
  await model.db.db.collection<DailyOperationsReadViewDocument>(model.collection.collectionName).deleteMany({ _id: { $regex: "replica_" } });
  await mongoose.disconnect();
});

test("replica: concurrent cross-instance cold misses run one materializer", { skip: !enabled }, async () => {
  let builds = 0; const instant = new Date("2026-10-23T18:00:00Z");
  const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => getCachedDailyOperationsReadView({
    scope: "replica_concurrency", intervalMs: 60000, now: () => instant,
    stores: createMongoDailyOperationsReadViewStore(),
    build: async () => { builds++; await new Promise(resolve => setTimeout(resolve, 40)); return { count: 9 }; },
  })));
  assert.equal(builds, 1);
  assert.ok(outcomes.some(r => r.status === "fulfilled"));
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") assert.equal(outcome.value.payload.count, 9);
    else assert.ok(outcome.reason instanceof DailyOperationsReadViewUnavailable);
  }
});

test("replica: crashed lease persists next-attempt deadline and fences old owner", { skip: !enabled }, async () => {
  const store = createMongoDailyOperationsReadViewStore(); const now = new Date("2026-10-23T18:00:00Z");
  const key = "replica_fencing";
  const first = await store.claim({ key, now, token: "first", intervalMs: 60000 });
  assert.ok(first); assert.equal(+new Date(first.next_attempt_at), +now + 60000);
  assert.equal(await store.claim({ key, now: new Date(+now + 16000), token: "too_soon", intervalMs: 60000 }), null);
  assert.equal(await store.publish({ key, token: "first", generation: first.generation, now: new Date(+now + 16000), payload: { invalid: true }, hash: "old" }), null);
  const second = await store.claim({ key, now: new Date(+now + 60000), token: "second", intervalMs: 60000 });
  assert.ok(second); assert.equal(second.generation, first.generation + 1);
  assert.equal(await store.publish({ key, token: "first", generation: first.generation, now: new Date(+now + 60001), payload: { invalid: true }, hash: "old" }), null);
  const published = await store.publish({ key, token: "second", generation: second.generation, now: new Date(+now + 60001), payload: { count: 7 }, hash: "valid" });
  assert.deepEqual(published?.payload, { count: 7 }); assert.equal(published?.revision, 1);
});

test("replica: outage serves stale once and bounds source failures until retry deadline", { skip: !enabled }, async () => {
  const store = createMongoDailyOperationsReadViewStore(); let time = Date.parse("2026-10-23T18:00:00Z"); let builds = 0; let fail = false;
  const args = { scope: "replica_outage", intervalMs: 60000, stores: store, now: () => new Date(time), build: async () => { builds++; if (fail) throw new Error("Redis quota exhausted; transport must be unused"); return { count: 11 }; } };
  assert.equal((await getCachedDailyOperationsReadView(args)).payload.count, 11);
  time += 60000; fail = true;
  const result = await getCachedDailyOperationsReadView(args);
  assert.equal(result.freshness, "stale"); assert.equal(result.payload.count, 11);
  time += 16000;
  await Promise.all(Array.from({ length: 20 }, () => getCachedDailyOperationsReadView(args)));
  assert.equal(builds, 2);
});
