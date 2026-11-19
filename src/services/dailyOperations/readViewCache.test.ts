import assert from "node:assert/strict";
import { test } from "node:test";
import type { DailyOperationsReadViewDocument } from "../../models/DailyOperationsReadView";
import { getDailyOperationsReadViewModel } from "../../models/DailyOperationsReadView";
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
