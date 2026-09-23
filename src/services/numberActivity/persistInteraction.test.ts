import assert from "node:assert/strict";
import { test } from "node:test";
import { at } from "./fixtures";
import { captureRollupDelta } from "./persistInteraction";

// S1-ROLLUP (data spec §8): capture's incremental rollup arithmetic, with fixed values.
const rec = (n: number) => Array.from({ length: n }, (_, i) => ({ provider_recording_id: `r${i}`, recording_type: null, observed_at: at(0), lead_conversation_id: null }));
const call = (direction: "Inbound" | "Outbound", recordings: number, startedAt = at(100)) => ({ direction, recordings: rec(recordings), started_at: startedAt });
const stored = { interactions_total: 5, inbound_total: 3, outbound_total: 2, recordings_total: 4, last_inbound_at: at(50), last_outbound_at: at(60) };

test("a new canonical interaction adds its recordings; zero recordings adds zero", () => {
  assert.equal(captureRollupDelta(stored, null, call("Inbound", 2)).recordings_total, 6);
  assert.equal(captureRollupDelta(stored, null, call("Inbound", 0)).recordings_total, 4);
  const next = captureRollupDelta(stored, null, call("Outbound", 1, at(200)));
  assert.deepEqual(next, { interactions_total: 6, inbound_total: 3, outbound_total: 3, recordings_total: 5, last_inbound_at: at(50), last_outbound_at: at(200) });
});

test("an update adds next.recordings.length minus prev.recordings.length and leaves the interaction counts", () => {
  const next = captureRollupDelta(stored, call("Inbound", 0), call("Inbound", 2));
  assert.equal(next.recordings_total, 6);
  assert.equal(next.interactions_total, 5);
  assert.equal(next.inbound_total, 3);
  assert.equal(captureRollupDelta(stored, call("Inbound", 2), call("Inbound", 2)).recordings_total, 4, "unchanged recordings: no change");
  assert.equal(captureRollupDelta(stored, call("Inbound", 2), call("Inbound", 1)).recordings_total, 3);
});

test("an interaction merged away or re-pointed removes its recordings from the Number it leaves", () => {
  const left = captureRollupDelta(stored, call("Outbound", 3), null);
  assert.deepEqual(left, { interactions_total: 4, inbound_total: 3, outbound_total: 1, recordings_total: 1, last_inbound_at: at(50), last_outbound_at: at(60) });
});

test("counts never go below zero, and a row written before recordings_total existed reads zero", () => {
  assert.equal(captureRollupDelta({ ...stored, recordings_total: 1 }, call("Inbound", 2), null).recordings_total, 0);
  const legacy = { interactions_total: 1, inbound_total: 1, outbound_total: 0, last_inbound_at: at(10), last_outbound_at: null };
  assert.equal(captureRollupDelta(legacy, null, call("Inbound", 2)).recordings_total, 2);
  assert.equal(captureRollupDelta(legacy, call("Inbound", 2), null).recordings_total, 0);
  assert.equal(captureRollupDelta(null, null, call("Inbound", 1)).interactions_total, 1);
});

test("merge: the survivor gains the merged recordings and the tombstone's Number loses them, so the sum is conserved", () => {
  // Survivor A (1 recording) absorbs B (2 recordings) on the same Number: the delta for the
  // tombstone is (prev=B, next=null) and for the survivor (prev=A, next=A∪B).
  const afterTombstone = captureRollupDelta({ ...stored, recordings_total: 3 }, call("Inbound", 2), null);
  const afterSurvivor = captureRollupDelta(afterTombstone, call("Inbound", 1), call("Inbound", 3));
  assert.equal(afterSurvivor.recordings_total, 3);
  assert.equal(afterSurvivor.interactions_total, stored.interactions_total - 1);
});
