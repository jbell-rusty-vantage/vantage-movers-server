import assert from "node:assert/strict";
import { test } from "node:test";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { ambiguousReviewFixture, unknownCoverageFixture } from "../fixtures";
import { clearParsedAttentionSnapshots, compressAttentionRows, readAttention } from "./attention";
import { payloadHash } from "../transactions";

process.env.TEST_MODE = "true";
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "isolated";

/** A Mongoose query stand-in: the header lookup chains `select().sort().lean()`, the payload load `select().lean()`. */
const query = (value: unknown) => { const chain = { select: () => chain, sort: () => chain, lean: async () => value }; return chain; };

test("the latest list stays readable after freshness expires, including its pagination", async t => {
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  const asOf = new Date("2026-09-21T12:00:00Z");
  const retained = {
    snapshot_id: "outreach:retained", as_of: asOf, expires_at: null,
    counts: { total_items: 2 }, rows: [],
    rows_gzip_base64: compressAttentionRows([ambiguousReviewFixture, ambiguousReviewFixture]),
  };
  clearParsedAttentionSnapshots();
  t.mock.method(Snapshot, "findOne", (filter: Record<string, unknown>) => {
    // The payload load names the header by `_id` only.
    if (!("$and" in filter)) return query(retained);
    // Exercise the reader's real Mongo predicate: a TTL-null header must be
    // eligible; the previous expires_at > now predicate loses this list.
    assert.deepEqual(filter.$and, [
      { $or: [{ expires_at: null }, { expires_at: { $gt: new Date("2026-09-22T12:00:00Z") } }] },
      { chunk_index: null },
      { $or: [{ cursor_expires_at: null }, { cursor_expires_at: { $gt: new Date("2026-09-22T12:00:00Z") } }] },
    ]);
    return query(retained);
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
  t.mock.method(Snapshot, "findOne", () => query(null));
  const deps = { coverage: async () => unknownCoverageFixture };
  assert.equal((await readAttention({}, deps)).data.status, "pending_projection");
  const cursor = Buffer.from(JSON.stringify({ snapshot_id: "outreach:old", offset: 1, digest: payloadHash({}) })).toString("base64url");
  await assert.rejects(readAttention({ cursor }, deps), { code: "ATTENTION_SNAPSHOT_EXPIRED" });
});

test("B8: a snapshot's payload is loaded and parsed once per process; a new snapshot id loads again", async t => {
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  clearParsedAttentionSnapshots();
  const header = (id: string) => ({ _id: id, snapshot_id: id, as_of: new Date("2026-09-22T11:59:00Z"), expires_at: null, counts: { total_items: 2 }, rows: [],
    rows_gzip_base64: compressAttentionRows([ambiguousReviewFixture, ambiguousReviewFixture]) });
  let current = header("outreach:first");
  const payloadLoads: unknown[] = [];
  t.mock.method(Snapshot, "findOne", (filter: Record<string, unknown>) => {
    if ("$and" in filter) return query(current);
    payloadLoads.push(filter._id);
    return query(current);
  });
  const deps = { now: new Date("2026-09-22T12:00:00Z"), coverage: async () => unknownCoverageFixture };
  const first = await readAttention({ limit: 1 }, deps);
  const second = await readAttention({ limit: 1, cursor: first.data.cursor! }, deps);
  await readAttention({ limit: 2 }, deps);
  assert.deepEqual(payloadLoads, ["outreach:first"], "three reads of one snapshot load its payload once");
  assert.equal(second.data.items.length, 1);
  current = header("outreach:second");
  assert.equal((await readAttention({ limit: 2 }, deps)).data.snapshot_id, "outreach:second");
  assert.deepEqual(payloadLoads, ["outreach:first", "outreach:second"]);
});
