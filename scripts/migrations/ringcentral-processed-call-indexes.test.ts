import assert from "node:assert/strict";
import test from "node:test";
import {
  hasRequiredUniqueCallLogIndex,
  summarizeProcessedCallIdentityCollisions,
} from "./ringcentral-processed-call-indexes.lib";

test("[AC-14] processed call-log collision report is deterministic and masks row ids", () => {
  const collisions = summarizeProcessedCallIdentityCollisions([
    { _id: "507f1f77bcf86cd799439011", callLogId: "synthetic-log-a" },
    { _id: "507f1f77bcf86cd799439012", callLogId: "synthetic-log-a" },
    { _id: "507f1f77bcf86cd799439013", callLogId: "synthetic-log-b" },
    { _id: "507f1f77bcf86cd799439014", callLogId: null },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]!.count, 2);
  assert.equal(collisions[0]!.identity_hash.length, 16);
  assert.deepEqual(collisions[0]!.masked_ids, [
    "507f…9011",
    "507f…9012",
  ]);
  assert.equal(
    JSON.stringify(collisions).includes("synthetic-log-a"),
    false,
  );
});

test("[AC-14] verify requires an exact unique sparse callLogId index", () => {
  assert.equal(
    hasRequiredUniqueCallLogIndex([
      {
        key: { callLogId: 1 },
        unique: true,
        sparse: true,
      },
    ]),
    true,
  );
  assert.equal(
    hasRequiredUniqueCallLogIndex([
      {
        key: { callLogId: 1 },
        sparse: true,
      },
    ]),
    false,
  );
});
