import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLeadCplSnapshot } from "./leadCplResolution";

test("lead CPL resolution uses the stored Eastern business calendar day", async () => {
  let resolvedAt: Date | undefined;
  const snapshot = await resolveLeadCplSnapshot(
    {
      sourceGranularityId: "507f1f77bcf86cd799439011",
      storedBusinessTimestamp: new Date("2026-07-29T23:30:00.000Z"),
    },
    {
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolver: async (input) => {
        resolvedAt = input.business_timestamp;
        return {
          status: "resolved",
          amount: 195.25,
          amount_cents: 19_525,
          period_id: "507f191e810c19729de860ea",
        };
      },
    },
  );

  assert.equal(resolvedAt?.toISOString(), "2026-07-29T04:00:00.000Z");
  assert.equal(snapshot.cpl, 195.25);
  assert.equal(snapshot.cpl_resolution_status, "resolved");
  assert.equal(snapshot.cpl_rate_period, "507f191e810c19729de860ea");
});

test("duplicate Call Lead snapshots retain base-period evidence at zero", async () => {
  const snapshot = await resolveLeadCplSnapshot(
    {
      sourceGranularityId: "507f1f77bcf86cd799439011",
      storedBusinessTimestamp: new Date("2026-11-01T01:30:00.000Z"),
      duplicate: true,
    },
    {
      resolver: async () => ({
        status: "duplicate_zero",
        amount: 0,
        base_period_id: "507f191e810c19729de860ea",
      }),
    },
  );

  assert.equal(snapshot.cpl, 0);
  assert.equal(snapshot.cpl_resolution_status, "duplicate_zero");
  assert.equal(snapshot.cpl_rate_period, "507f191e810c19729de860ea");
});

test("missing rates remain compatibility zero with a cleared period reference", async () => {
  const snapshot = await resolveLeadCplSnapshot(
    {
      sourceGranularityId: "507f1f77bcf86cd799439011",
      storedBusinessTimestamp: new Date("2026-01-01T12:00:00.000Z"),
    },
    {
      resolver: async () => ({ status: "missing_rate", fallback_amount: 0 }),
    },
  );

  assert.equal(snapshot.cpl, 0);
  assert.equal(snapshot.cpl_resolution_status, "missing_rate");
  assert.equal(snapshot.cpl_rate_period, null);
});
