import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { eventVerdict, fenceOf } from "./eventRetirement";

const closed = { day: "2026-11-20", status: "closed", closed_at: new Date("2026-11-21T05:05:00Z"), webhook_counts_version: 1 };
const event = { _id: new ObjectId(), day: "2026-11-20", dedupe_key: "sheet_sync:j1:completed", kind: "sheet_sync.completed",
  occurred_at: new Date("2026-11-20T15:00:00Z"), createdAt: new Date("2026-11-20T15:00:01Z"), card: { job_no: "1" }, metric_touches: [] };
const cutoff = "2026-11-21";

test("an event body retires only when its day is closed, frozen, old enough and webhook-versioned; the fence keeps only the dedupe key", () => {
  for (const [name, row, day, expected] of [
    ["closed, versioned day two days back", event, closed, { verdict: "retire" }],
    ["day newer than the cutoff", { ...event, day: "2026-11-22" }, { ...closed, day: "2026-11-22" }, { verdict: "hold", reason: "day_too_recent" }],
    ["no day document", event, undefined, { verdict: "hold", reason: "day_missing" }],
    ["day still open", event, { ...closed, status: "open" }, { verdict: "hold", reason: "day_open" }],
    ["closed without closed_at", event, { ...closed, closed_at: null }, { verdict: "hold", reason: "day_closed_at_missing" }],
    ["webhook counts not versioned", event, { ...closed, webhook_counts_version: undefined }, { verdict: "hold", reason: "day_webhook_counts_unversioned" }],
    ["already a fence", fenceOf(event), closed, { verdict: "hold", reason: "already_fenced" }],
  ] as const) {
    assert.deepEqual(eventVerdict(row, day as never, cutoff), expected, name);
  }
  // No kind, occurred_at, lane or card survive, so no today-scoped reader can count or render a fence.
  assert.deepEqual(Object.keys(fenceOf(event)).sort(), ["_id", "createdAt", "day", "dedupe_key"]);
});
