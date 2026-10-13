import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatesCronDecision, estimatesDateWindow, newYorkHour } from "./estimatesCron";

test("the estimates cron runs at 08:00, 13:00, and 18:00 New York, including across daylight saving", () => {
  assert.equal(newYorkHour(new Date("2026-07-13T12:00:00.000Z")), 8);
  assert.equal(estimatesCronDecision(new Date("2026-07-13T12:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-07-13T13:00:00.000Z")), 9);
  assert.deepEqual(estimatesCronDecision(new Date("2026-07-13T13:00:00.000Z")), {
    run: false,
    reason: "outside_estimates_hours",
  });
  assert.equal(newYorkHour(new Date("2026-01-13T13:00:00.000Z")), 8);
  assert.equal(estimatesCronDecision(new Date("2026-01-13T13:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-07-13T22:00:00.000Z")), 18);
  assert.equal(estimatesCronDecision(new Date("2026-07-13T22:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-01-13T18:00:00.000Z")), 13);
  assert.equal(estimatesCronDecision(new Date("2026-01-13T18:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-01-13T23:00:00.000Z")), 18);
  assert.equal(estimatesCronDecision(new Date("2026-01-13T23:00:00.000Z")).run, true);
});

test("every estimates run uses Open Date yesterday through today in New York", () => {
  assert.deepEqual(estimatesDateWindow(new Date("2026-07-13T12:00:00.000Z")), {
    from: "07/12/2026",
    to: "07/13/2026",
  });
  assert.deepEqual(estimatesDateWindow(new Date("2026-07-13T22:00:00.000Z")), {
    from: "07/12/2026",
    to: "07/13/2026",
  });
  assert.deepEqual(estimatesDateWindow(new Date("2026-01-13T13:00:00.000Z")), {
    from: "01/12/2026",
    to: "01/13/2026",
  });
  const yearBoundary = estimatesDateWindow(new Date("2026-01-01T13:00:00.000Z"));
  assert.deepEqual(yearBoundary, { from: "12/31/2025", to: "01/01/2026" });
});


test("cron retries share a slot identity, while the next scheduled hour gets a new identity", () => {
  const first = estimatesCronDecision(new Date("2026-10-13T12:00:00Z"));
  const retry = estimatesCronDecision(new Date("2026-10-13T12:59:59Z"));
  const next = estimatesCronDecision(new Date("2026-10-13T17:00:00Z"));
  assert.ok(first.run && retry.run && next.run);
  assert.equal(first.slotKey, retry.slotKey);
  assert.notEqual(first.slotKey, next.slotKey);
});
