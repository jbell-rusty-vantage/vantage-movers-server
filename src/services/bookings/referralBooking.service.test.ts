import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("Referral Booking create does not open a Booking Lead Reconciliation Case", () => {
  const source = readFileSync(
    path.join(__dirname, "referralBooking.service.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /BookingLeadReconciliationCase/);
  assert.doesNotMatch(source, /owner_booking/);
  assert.doesNotMatch(source, /create_pending/);
});
