import assert from "node:assert/strict";
import { test } from "node:test";
import { CREATE_REFERRAL_BOOKING_COMMAND_NAME, createReferralBooking } from "./referralBooking";

test("[AC-28] Referral Booking exposes the canonical command name", () => {
  assert.equal(CREATE_REFERRAL_BOOKING_COMMAND_NAME, "createReferralBooking");
});

test("[AC-28] Referral Booking rejects non-Owner authority before storage access", async () => {
  await assert.rejects(
    createReferralBooking({
      case_id: "64b000000000000000000001",
      expected_case_revision: 1,
      official_booking_details: {
        book_date: "2026-08-20",
        primary_agent_id: "64b000000000000000000002",
        total_binder_amount: 10,
        deposit_amount: 10,
        merchant_id: "64b000000000000000000003",
      },
      idempotency_key: "unit28-non-owner",
      owner: {
        actor_type: "admin",
        actor_id: "unit28-admin",
        actor_label: "Unit 28 admin",
        actor_role: "admin",
        request_id: "unit28-admin-request",
        origin: "vantage_admin",
      },
    }),
    (error: unknown) => (error as { code?: string }).code === "GRANOT_OWNER_REQUIRED",
  );
});
