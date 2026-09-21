import assert from "node:assert/strict";
import { test } from "node:test";
import { splitAttentionChunks } from "./attention";

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
