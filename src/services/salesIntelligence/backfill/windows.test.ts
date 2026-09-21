import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { activationCallFilterForWindow } from "./worker";
import { MS_PER_DAY, planDailyWindows } from "./windows";

test("planDailyWindows returns nothing when days=0 or invalid range", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const to = new Date("2026-01-03T00:00:00.000Z");
  assert.deepEqual(planDailyWindows(from, to, 0), []);
  assert.deepEqual(planDailyWindows(to, from, 3), []);
});

test("planDailyWindows caps by BACKFILL_DAYS from to and splits 24h slices", () => {
  const to = new Date("2026-01-10T12:00:00.000Z");
  const from = new Date("2026-01-01T00:00:00.000Z");
  const windows = planDailyWindows(from, to, 2);
  assert.equal(windows.length, 2);
  assert.equal(windows[0]!.window_from.toISOString(), new Date(to.getTime() - 2 * MS_PER_DAY).toISOString());
  assert.equal(windows[1]!.window_to.toISOString(), to.toISOString());
});

test("activation selects only calls inside its completed historical window", () => {
  const window_from = new Date("2026-01-01T00:00:00.000Z");
  const window_to = new Date("2026-01-02T00:00:00.000Z");
  const numberId = new mongoose.Types.ObjectId("000000000000000000000001");
  const callId = new mongoose.Types.ObjectId("000000000000000000000002");
  assert.deepEqual(activationCallFilterForWindow({ window_from, window_to }, numberId), {
    contact_number_id: numberId,
    merged_into_id: null,
    started_at: { $gte: window_from, $lt: window_to },
  });
  assert.deepEqual(activationCallFilterForWindow({
    window_from, window_to, activation_call_at: new Date("2026-01-01T12:00:00.000Z"), activation_call_id: callId,
  }, numberId), {
    contact_number_id: numberId,
    merged_into_id: null,
    started_at: { $gte: window_from, $lt: window_to },
    $or: [
      { started_at: { $lt: new Date("2026-01-01T12:00:00.000Z") } },
      { started_at: new Date("2026-01-01T12:00:00.000Z"), _id: { $lt: callId } },
    ],
  });
});
