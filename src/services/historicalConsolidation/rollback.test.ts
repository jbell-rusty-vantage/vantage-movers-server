import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { buildRollbackUpdate } from "./rollback";

test("rollback restores exact values and unsets fields that were originally absent", () => {
  const id = new ObjectId();
  const update = buildRollbackUpdate(
    { receiver_agent: null, booked: { $oid: id.toHexString() }, updatedAt: { $date: "2026-07-31T12:00:00.000Z" } },
    { receiver_agent: { $exists: false }, booked: id, updatedAt: { $date: "2026-07-31T12:00:00.000Z" } },
  );

  assert.deepEqual(update.unset, { receiver_agent: "" });
  assert.ok(update.set.booked instanceof ObjectId);
  assert.ok(update.set.updatedAt instanceof Date);
  assert.equal(update.set.receiver_agent, undefined);
});
