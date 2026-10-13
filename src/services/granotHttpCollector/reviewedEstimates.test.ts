import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReviewedEstimatesWindow } from "./runWorkflow";

const now = new Date("2026-10-14T01:00:00Z"); // still October 13 in New York

test("reviewed Estimates accepts exactly 90 inclusive dates and smaller contiguous windows", () => {
  assertReviewedEstimatesWindow({ from: "07/16/2026", to: "10/13/2026" }, now);
  assertReviewedEstimatesWindow({ from: "10/13/2026", to: "10/13/2026" }, now);
});

test("reviewed Estimates rejects a 91st date, future NY date, reversed or invalid dates", () => {
  for (const window of [
    { from: "07/15/2026", to: "10/13/2026" },
    { from: "10/13/2026", to: "10/14/2026" },
    { from: "10/13/2026", to: "10/12/2026" },
    { from: "02/30/2026", to: "03/01/2026" },
    { from: "7/16/2026", to: "10/13/2026" },
    null,
  ]) assert.throws(() => assertReviewedEstimatesWindow(window, now), { code: "INVALID_BACKFILL_WINDOW" });
});
