import assert from "node:assert/strict";
import { test } from "node:test";
import { simpleCplScheduleSchema } from "./operationsRegistry.validation";

const granularityId = "507f1f77bcf86cd799439011";

test("Simple CPL validation requires revisions and cents-precise nonnegative amounts", () => {
  assert.deepEqual(
    simpleCplScheduleSchema.parse({
      effective_date: "2026-07-29",
      expected_revisions: { [granularityId]: 4 },
      changes: [{ source_granularity_id: granularityId, amount: 195.25 }],
    }),
    {
      effective_date: "2026-07-29",
      expected_revisions: { [granularityId]: 4 },
      changes: [{ source_granularity_id: granularityId, amount: 195.25 }],
    },
  );

  assert.throws(
    () =>
      simpleCplScheduleSchema.parse({
        effective_date: "2026-07-29",
        expected_revisions: {},
        changes: [{ source_granularity_id: granularityId, amount: 1.001 }],
      }),
    /two decimal places|Expected revision/,
  );
});
