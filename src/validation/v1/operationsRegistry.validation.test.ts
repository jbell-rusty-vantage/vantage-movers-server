import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advancedCplScheduleCommandSchema,
  cplCorrectionPreviewSchema,
  simpleCplScheduleSchema,
} from "./operationsRegistry.validation";

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

test("Advanced CPL validation accepts only explicit discriminated commands", () => {
  assert.equal(
    advancedCplScheduleCommandSchema.parse({
      operation: "split",
      expected_revision: 2,
      period_id: "507f191e810c19729de860ea",
      effective_date: "2026-08-01",
      amount: 0,
    }).operation,
    "split",
  );

  assert.throws(
    () =>
      advancedCplScheduleCommandSchema.parse({
        operation: "patch",
        expected_revision: 2,
      }),
    /Invalid discriminator value/,
  );
});

test("Correction preview validates an inclusive ordered business-date window", () => {
  assert.doesNotThrow(() =>
    cplCorrectionPreviewSchema.parse({
      source_granularity_id: granularityId,
      window_from: "2026-07-01",
      window_until: "2026-07-31",
      sample_limit: 25,
    }),
  );
  assert.throws(
    () =>
      cplCorrectionPreviewSchema.parse({
        source_granularity_id: granularityId,
        window_from: "2026-08-01",
        window_until: "2026-07-31",
      }),
    /end must be on or after/,
  );
  assert.throws(
    () =>
      cplCorrectionPreviewSchema.parse({
        source_granularity_id: granularityId,
        window_from: "2024-01-01",
        window_until: "2026-01-01",
      }),
    /cannot exceed 366/,
  );
});
