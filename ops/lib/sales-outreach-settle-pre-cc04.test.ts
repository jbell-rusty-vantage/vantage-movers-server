import assert from "node:assert/strict";
import test from "node:test";
import {
  anomalyFilter,
  CC04_INSTANT,
  internalLeftFilter,
  parseSettleArgs,
  settleFilter,
  settleUpdate,
  summarizeSettle,
  type SettleCandidate,
} from "./sales-outreach-settle-pre-cc04";

test("parseSettleArgs: dry run by default, --target required and plain, --apply / --out, guard flag passes through", () => {
  assert.deepEqual(parseSettleArgs(["--target=vantagemovers"]), { target: "vantagemovers", apply: false, out: null });
  assert.deepEqual(parseSettleArgs(["--target=testvantagemovers", "--apply", "--out=ids.json", "--allow-schema-drift"]), {
    target: "testvantagemovers",
    apply: true,
    out: "ids.json",
  });
  assert.throws(() => parseSettleArgs([]), /--target=<database name> is required/);
  assert.throws(() => parseSettleArgs(["--target=vantage movers"]), /plain database name/);
  assert.throws(() => parseSettleArgs(["--target=vantagemovers", "apply"]), /Unknown argument: apply/);
  assert.throws(() => parseSettleArgs(["--target=vantagemovers", "--out="]), /needs a path/);
});

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

test("summarizeSettle: counts by New York day and direction, contact events by goal credit, anomalies", () => {
  const candidates: SettleCandidate[] = [
    // 2026-09-23T03:13Z is still 2026-09-22 in New York (EDT, −4 h).
    { id: "a1", started_at: new Date("2026-09-22T15:51:58Z"), direction: "Outbound" },
    { id: "a2", started_at: new Date("2026-09-23T03:13:53Z"), direction: "Inbound" },
    { id: "a3", started_at: new Date("2026-09-23T06:37:39Z"), direction: "Outbound" },
    { id: "a4", started_at: new Date("2026-09-24T01:02:28Z"), direction: "Outbound" },
  ];
  const summary = summarizeSettle({
    candidates,
    events: [
      { source_id: "a1", business_date: "2026-09-22", goal_credit: "awaiting_confirmation" },
      { source_id: "a2", business_date: "2026-09-22", goal_credit: "none" },
      { source_id: "a3", business_date: "2026-09-23", goal_credit: "awaiting_confirmation" },
      { source_id: "zz", business_date: "2026-09-23", goal_credit: "confirmed" }, // not a candidate: ignored
    ],
    anomaly_ids: ["x2", "x1"],
    internal_left: 3,
  });
  assert.equal(summary.candidates, 4);
  assert.deepEqual(summary.by_day, {
    "2026-09-22": { Inbound: 1, Outbound: 1, total: 2 },
    "2026-09-23": { Inbound: 0, Outbound: 2, total: 2 },
  });
  assert.deepEqual(summary.by_direction, { Inbound: 1, Outbound: 3, total: 4 });
  assert.deepEqual(summary.contact_events, {
    total: 3,
    without_event: 1,
    by_goal_credit: { awaiting_confirmation: 2, none: 1 },
    by_day: { "2026-09-22": { awaiting_confirmation: 1, none: 1 }, "2026-09-23": { awaiting_confirmation: 1 } },
  });
  assert.deepEqual(summary.anomalies, { count: 2, sample_ids: ["x1", "x2"] });
  assert.equal(summary.internal_left, 3);
  assert.equal(summary.cc04_instant, "2026-09-24T01:28:03.000Z");
});

test("summarizeSettle: nothing left to settle reads as an empty, zero summary", () => {
  const summary = summarizeSettle({ candidates: [], events: [], anomaly_ids: [], internal_left: 3 });
  assert.deepEqual([summary.candidates, summary.by_day, summary.by_direction, summary.contact_events.total, summary.anomalies.count], [
    0,
    {},
    { Inbound: 0, Outbound: 0, total: 0 },
    0,
    0,
  ]);
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
