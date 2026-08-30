import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyHistoricalCancellation,
  summarizeCancellationSnapshotInventory,
} from "./cancellation-correlation-snapshots.lib.js";

test("historical analysis stamps only surviving Booking job evidence", () => {
  const deterministic = classifyHistoricalCancellation({
    cancellation: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      booked_lead: "bbbbbbbbbbbbbbbbbbbbbbbb",
      has_normalized_job_no_snapshot: false,
    },
    booking: {
      job_no: "P7702",
      normalized_job_no: "7702",
      lead_ref: "cccccccccccccccccccccccc",
      lead_model: "FormLead",
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
    },
  });
  assert.equal(deterministic.class, "deterministic");
  assert.equal(deterministic.snapshots?.normalized_job_no_snapshot, "7702");
  assert.equal(deterministic.snapshots?.lead_ref_snapshot?.id, "cccccccccccccccccccccccc");
});

test("historical analysis leaves missing Booking links as remainder", () => {
  const remainder = classifyHistoricalCancellation({
    cancellation: {
      id: "dddddddddddddddddddddddd",
      booked_lead: "eeeeeeeeeeeeeeeeeeeeeeee",
      has_normalized_job_no_snapshot: false,
    },
    booking: null,
  });
  assert.equal(remainder.class, "remainder");
  assert.equal(remainder.snapshots, undefined);
});

test("historical analysis does not infer a job from a Booking without job fields", () => {
  const remainder = classifyHistoricalCancellation({
    cancellation: {
      id: "ffffffffffffffffffffffff",
      booked_lead: "111111111111111111111111",
      has_normalized_job_no_snapshot: false,
    },
    booking: {
      lead_ref: "222222222222222222222222",
      lead_model: "FormLead",
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
    },
  });
  assert.equal(remainder.class, "remainder");
});

test("already-stamped historical rows are not remainder and are not reapplied", () => {
  const stamped = classifyHistoricalCancellation({
    cancellation: {
      id: "333333333333333333333333",
      booked_lead: "444444444444444444444444",
      has_normalized_job_no_snapshot: true,
      normalized_job_no_snapshot: "7702",
    },
    booking: { job_no: "7702", normalized_job_no: "7702" },
  });
  assert.equal(stamped.class, "already_stamped");
});

test("inventory summary lists remainder ids only", () => {
  const summary = summarizeCancellationSnapshotInventory([
    { id: "det-1", class: "deterministic" },
    { id: "rem-2", class: "remainder" },
    { id: "rem-1", class: "remainder" },
    { id: "done-1", class: "already_stamped" },
  ]);
  assert.deepEqual(summary, {
    historical: 4,
    already_stamped: 1,
    deterministic: 1,
    remainder: 2,
    remainder_ids: ["rem-1", "rem-2"],
  });
});
