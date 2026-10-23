import assert from "node:assert/strict";
import { test } from "node:test";
import type { DailyOperationsReadViewDocument } from "../../models/DailyOperationsReadView";
import { getDailyOperationsReadViewModel } from "../../models/DailyOperationsReadView";
import { getDailyOperationsRedis } from "../../config/domain/dailyOperations";
import { getCachedDailyOperationsReadView, DailyOperationsReadViewUnavailable, type DailyOperationsReadViewStore } from "./readViewCache";

function memoryStore() {
  const docs = new Map<string, DailyOperationsReadViewDocument>();
  let claims = 0;
  const copy = (doc: DailyOperationsReadViewDocument | undefined) => doc ? structuredClone(doc) : null;
  const store: DailyOperationsReadViewStore = {
    async read(key) { return copy(docs.get(key)); },
    async claim({ key, now, token, intervalMs }) {
      claims++;
      const old = docs.get(key);
      if (old && (+old.next_attempt_at > +now || +old.lease_expires_at > +now)) return null;
      const doc = { ...old, _id: key, generation: (old?.generation ?? 0) + 1, next_attempt_at: new Date(+now + intervalMs), lease_token: token, lease_expires_at: new Date(+now + 15000) };
      docs.set(key, doc); return copy(doc);
    },
    async publish({ key, token, generation, now, payload, hash }) {
      const old = docs.get(key);
      if (!old || old.lease_token !== token || old.generation !== generation || +old.lease_expires_at <= +now) return null;
      const doc = { ...old, payload, content_hash: hash, revision: old.content_hash === hash ? old.revision : (old.revision ?? 0) + 1, generated_at: now, lease_token: null, lease_expires_at: now };
      docs.set(key, doc); return copy(doc);
    },
    async fail({ key, token, generation, now }) {
      const old = docs.get(key);
      if (old?.lease_token === token && old.generation === generation) docs.set(key, { ...old, lease_token: null, lease_expires_at: now });
    },
  };
  return { store, docs, claims: () => claims };
}

test("cross-instance cold misses have one source build and no loser spin", async () => {
  const mem = memoryStore(); let builds = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const args = { scope: "dailyops_core", intervalMs: 60000, stores: mem.store, now: () => new Date("2026-10-23T18:00:00Z"), build: async () => { builds++; await wait; return { count: 3 }; } };
  const first = getCachedDailyOperationsReadView(args);
  await new Promise(resolve => setImmediate(resolve));
  const losers = await Promise.allSettled(Array.from({ length: 15 }, () => getCachedDailyOperationsReadView(args)));
  assert.equal(builds, 1);
  assert.ok(losers.every(r => r.status === "rejected" && r.reason instanceof DailyOperationsReadViewUnavailable));
  release(); assert.equal((await first).payload.count, 3);
  assert.equal((await getCachedDailyOperationsReadView(args)).revision, 1);
  assert.equal(builds, 1);
});

test("failed refresh retains last-good, retry deadline bounds failures, and recovery advances revision", async () => {
  const mem = memoryStore(); let time = Date.parse("2026-10-23T18:00:00Z"); let count = 1; let failure = false; let builds = 0;
  const args = { scope: "dailyops_core", intervalMs: 60000, stores: mem.store, now: () => new Date(time), build: async () => { builds++; if (failure) throw new Error("ERR max requests limit exceeded"); return { count }; } };
  await getCachedDailyOperationsReadView(args);
  time += 60000; failure = true;
  const stale = await getCachedDailyOperationsReadView(args);
  assert.equal(stale.freshness, "stale"); assert.equal(stale.payload.count, 1);
  time += 16000;
  for (let i = 0; i < 10; i++) assert.equal((await getCachedDailyOperationsReadView(args)).payload.count, 1);
  assert.equal(builds, 2);
  time += 44000; failure = false; count = 2;
  assert.equal((await getCachedDailyOperationsReadView(args)).revision, 2);
  assert.equal(getDailyOperationsRedis(), null);
});

test("crashed owner cannot rebuild after lease expiry until persisted retry deadline", async () => {
  const mem = memoryStore(); const start = new Date("2026-10-23T18:00:00Z");
  const key = "local:2026-10-23:dailyops_core:v2";
  await mem.store.claim({ key, now: start, token: "dead", intervalMs: 60000 });
  let builds = 0;
  await assert.rejects(getCachedDailyOperationsReadView({ scope: "dailyops_core", intervalMs: 60000, stores: mem.store, now: () => new Date(+start + 16000), build: async () => { builds++; return {}; } }), DailyOperationsReadViewUnavailable);
  assert.equal(builds, 0); assert.equal(mem.claims(), 1);
});

test("expired owners and stale generations cannot overwrite a successor", async () => {
  const mem = memoryStore(); const start = new Date("2026-10-23T18:00:00Z"); const key = "key";
  const first = await mem.store.claim({ key, now: start, token: "old", intervalMs: 60000 });
  assert.equal(await mem.store.publish({ key, now: new Date(+start + 15001), token: "old", generation: first!.generation, payload: {}, hash: "a" }), null);
  const next = await mem.store.claim({ key, now: new Date(+start + 60000), token: "new", intervalMs: 60000 });
  assert.equal(await mem.store.publish({ key, now: new Date(+start + 60001), token: "old", generation: first!.generation, payload: {}, hash: "a" }), null);
  assert.ok(await mem.store.publish({ key, now: new Date(+start + 60001), token: "new", generation: next!.generation, payload: { correct: true }, hash: "b" }));
});

test("bounded source timeout preserves cold unavailability and no per-request retries", async () => {
  const mem = memoryStore(); let builds = 0;
  const args = { scope: "dailyops_core", intervalMs: 60000, sourceTimeoutMs: 5, stores: mem.store, now: () => new Date("2026-10-23T18:00:00Z"), build: async () => { builds++; return new Promise<never>(() => {}); } };
  await assert.rejects(getCachedDailyOperationsReadView(args), DailyOperationsReadViewUnavailable);
  await assert.rejects(getCachedDailyOperationsReadView(args), DailyOperationsReadViewUnavailable);
  assert.equal(builds, 1);
});

test("unchanged business values keep revision and midnight uses a separate view", async () => {
  const mem = memoryStore(); let time = Date.parse("2026-10-24T03:58:00Z");
  const args = { scope: "dailyops_core", intervalMs: 60000, stores: mem.store, now: () => new Date(time), build: async () => ({ count: 1, generated_at: new Date(time).toISOString() }) };
  assert.equal((await getCachedDailyOperationsReadView(args)).revision, 1);
  time += 60000; assert.equal((await getCachedDailyOperationsReadView(args)).revision, 1);
  time += 60000; assert.equal((await getCachedDailyOperationsReadView(args)).revision, 1);
  assert.equal(mem.docs.size, 2);
  assert.match(getDailyOperationsReadViewModel().collection.collectionName, /^test_daily_operations_read_views$/);
});

test("lease-store outage keeps an already-read last-good view", async () => {
  const mem = memoryStore(); let time = Date.parse("2026-10-23T18:00:00Z");
  const args = { scope: "dailyops_core", intervalMs: 60000, stores: mem.store, now: () => new Date(time), build: async () => ({ count: 4 }) };
  await getCachedDailyOperationsReadView(args);
  time += 60000;
  const unavailableLease = { ...mem.store, claim: async () => { throw new Error("lease storage unavailable"); } };
  const stale = await getCachedDailyOperationsReadView({ ...args, stores: unavailableLease });
  assert.equal(stale.freshness, "stale"); assert.equal(stale.payload.count, 4);
});
