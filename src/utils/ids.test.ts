import assert from "node:assert/strict";
import test from "node:test";
import { generateLeadId } from "./ids";

test("generateLeadId returns unique established-format identifiers", () => {
  const ids = Array.from({ length: 100 }, generateLeadId);

  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^LID[0-9a-f]{13}$/);
  }
});
