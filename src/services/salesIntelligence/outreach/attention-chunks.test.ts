import assert from "node:assert/strict";
import { test } from "node:test";
import { splitAttentionChunks, compressAttentionRows, decompressAttentionRows } from "./attention";

test("Attention cache compression preserves order, Unicode and all fields while reducing repeated DTO storage", () => {
  const rows = Array.from({ length: 6400 }, (_, i) => ({ subject_key: `number:${i}`, name: "José", derived: { reasons: ["missing_responsibility"], attention_band: 6 }, outreach: { state: "unworked", actions: [] } }));
  const encoded = compressAttentionRows(rows)!;
  assert.ok(Buffer.byteLength(encoded) < Buffer.byteLength(JSON.stringify(rows)) / 5);
  assert.deepEqual(decompressAttentionRows(encoded), rows);
  assert.throws(() => decompressAttentionRows("invalid"));
});

test("attention chunks stay under the byte budget and keep row order", () => {
  const rows = ["aaaa", "bbbb", "cccc", "dd"].map(value => ({ value }));
  const chunks = splitAttentionChunks(rows, 20);
  assert.deepEqual(chunks.flat(), rows);
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(chunk)) <= 20 || chunk.length === 1);
  }
  assert.ok(chunks.length > 1);
});
