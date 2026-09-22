import assert from "node:assert/strict";
import { test } from "node:test";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { ambiguousReviewFixture, unknownCoverageFixture } from "../fixtures";
import { compressAttentionRows, readAttention } from "./attention";
import { payloadHash } from "../transactions";

test("the latest list stays readable after freshness expires, including its pagination", async t => {
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  const asOf = new Date("2026-09-21T12:00:00Z");
  const retained = {
    snapshot_id: "outreach:retained", as_of: asOf, expires_at: null,
    counts: { total_items: 2 }, rows: [],
    rows_gzip_base64: compressAttentionRows([ambiguousReviewFixture, ambiguousReviewFixture]),
  };
  t.mock.method(Snapshot, "findOne", (filter: Record<string, unknown>) => {
    // Exercise the reader's real Mongo predicate: a TTL-null header must be
    // eligible; the previous expires_at > now predicate loses this list.
    assert.deepEqual(filter.$and, [
      { $or: [{ expires_at: null }, { expires_at: { $gt: new Date("2026-09-22T12:00:00Z") } }] },
      { chunk_index: null },
    ]);
    return { sort: () => ({ lean: async () => retained }) };
  });
  const deps = { now: new Date("2026-09-22T12:00:00Z"), coverage: async () => unknownCoverageFixture };
  const first = await readAttention({ limit: 1 }, deps);
  assert.equal(first.data.status, "ready");
  assert.equal(first.data.stale, true);
  assert.equal(first.data.total_items, 2);
  assert.equal(first.data.items.length, 1);
  assert.equal(first.as_of, asOf.toISOString());
  assert.ok(first.data.cursor);
  const second = await readAttention({ limit: 1, cursor: first.data.cursor }, deps);
  assert.equal(second.data.snapshot_id, first.data.snapshot_id);
  assert.equal(second.data.items.length, 1);
  assert.equal(second.data.cursor, null);
});

test("a collected old cursor still expires and a missing initial list stays pending", async t => {
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  t.mock.method(Snapshot, "findOne", () => ({ sort: () => ({ lean: async () => null }) }));
  const deps = { coverage: async () => unknownCoverageFixture };
  assert.equal((await readAttention({}, deps)).data.status, "pending_projection");
  const cursor = Buffer.from(JSON.stringify({ snapshot_id: "outreach:old", offset: 1, digest: payloadHash({}) })).toString("base64url");
  await assert.rejects(readAttention({ cursor }, deps), { code: "ATTENTION_SNAPSHOT_EXPIRED" });
});
