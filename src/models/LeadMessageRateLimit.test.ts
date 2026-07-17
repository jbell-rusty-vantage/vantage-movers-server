import assert from "node:assert/strict";
import { test } from "node:test";
import { LeadMessageRateLimit } from "./LeadMessageRateLimit";

test("LeadMessageRateLimit validates atomic reservation buckets", async () => {
  const reservation = new LeadMessageRateLimit({
    _id: "hourly:2026-07-17T18:00:00.000Z",
    kind: "hourly",
    count: 1,
    expires_at: new Date("2026-07-17T20:00:00.000Z"),
  });
  await reservation.validate();
  assert.equal(reservation.count, 1);
  assert.equal(reservation.last_reserved_at, null);
  assert.equal(reservation.last_decision_token, null);
});
