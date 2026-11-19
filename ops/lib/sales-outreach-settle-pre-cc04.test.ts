import assert from "node:assert/strict";
import test from "node:test";
import {
  anomalyFilter,
  CC04_INSTANT,
  internalLeftFilter,
  settleFilter,
  settleUpdate,
} from "./sales-outreach-settle-pre-cc04";

test("settleFilter: null, terminal, unmerged, unpurged Inbound/Outbound rows with Call Log ids before CC-04", () => {
  assert.equal(CC04_INSTANT.toISOString(), "2026-09-24T01:28:03.000Z");
  assert.deepEqual(settleFilter(), {
    call_log_state: null,
    terminal: true,
    merged_into_id: null,
    purged_at: null,
    "call_log_ids.0": { $exists: true },
    direction: { $in: ["Inbound", "Outbound"] },
    started_at: { $lt: CC04_INSTANT },
  });
  // Internal rows are never candidates; anomalies are the same shape at or after CC-04, any direction.
  assert.deepEqual(anomalyFilter(), {
    call_log_state: null,
    terminal: true,
    merged_into_id: null,
    purged_at: null,
    "call_log_ids.0": { $exists: true },
    started_at: { $gte: CC04_INSTANT },
  });
  assert.deepEqual(internalLeftFilter(), { call_log_state: null, direction: "Internal" });
});

test("settleUpdate (olr CW0): updatedAt from the database clock, no operator instant anywhere in the write", () => {
  const update = settleUpdate();
  assert.deepEqual(update, {
    $set: { call_log_state: "settled" },
    $currentDate: { updatedAt: true },
    $inc: { projection_revision: 1 },
  });
  // A fast or slow operator clock cannot reach the sweep cursor: the write carries no client Date.
  const dates: unknown[] = [];
  const walk = (value: unknown) => {
    if (value instanceof Date) dates.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(update);
  assert.deepEqual(dates, []);
  assert.equal("updatedAt" in update.$set, false, "updatedAt is never $set from the client");
});
