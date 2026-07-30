import assert from "node:assert/strict";
import { test } from "node:test";
import { RingCentralInboundRouteAssignment } from "./RingCentralInboundRouteAssignment";

test("RingCentral assignments enforce one active assignment per route with a supported partial index", () => {
  const indexes = RingCentralInboundRouteAssignment.schema.indexes() as Array<
    [
      Record<string, number>,
      {
        unique?: boolean;
        partialFilterExpression?: Record<string, unknown>;
      },
    ]
  >;
  const currentAssignmentIndex = indexes
    .find(
      ([keys, options]) =>
        keys.route === 1 &&
        Object.keys(keys).length === 1 &&
        options.unique === true,
    );

  assert.ok(currentAssignmentIndex);
  assert.deepEqual(currentAssignmentIndex[1].partialFilterExpression, {
    active: true,
  });
});
