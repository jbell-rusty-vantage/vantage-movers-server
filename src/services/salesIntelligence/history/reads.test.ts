import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { serialize } from "./reads";

test("serialize redacts every string, stringifies ids and dates and drops buffers", () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(serialize({ id, at: new Date("2026-10-01T00:00:00.000Z"), note: "write pat@example.com", raw: Buffer.from("x"), list: ["a"] }), {
    id: String(id), at: "2026-10-01T00:00:00.000Z", note: "write [REDACTED:EMAIL]", raw: null, list: ["a"],
  });
});
