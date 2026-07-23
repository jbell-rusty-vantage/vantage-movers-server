import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { getBookedLeadForCancellation } from "./cancellationResolver";

const originalFindById = BookedLead.findById as unknown;

afterEach(() => {
  (BookedLead as any).findById = originalFindById;
});

test("getBookedLeadForCancellation allows unresolved employee leadless bookings", async () => {
  (BookedLead as any).findById = () => ({
    session() {
      return this;
    },
    populate: async () =>
      BookedLead.hydrate({
        _id: "64c0f47e4d8b0e4444444444",
        booking_origin: "employee_booking",
        is_leadless_booking: true,
        is_referral_booking: false,
        cancelled: null,
        agent_allocations: [{ agent_name_snapshot: "Agent One", binder_amount: 100, agent: "64c0f47e4d8b0e5555555555" }],
        total_binder_amount: 100,
        deposit_amount: 10,
        merchant: "Card",
        source: "Top10 Forms",
        book_date: new Date("2026-07-23T00:00:00.000Z"),
      }),
  });

  const booking = await getBookedLeadForCancellation("64c0f47e4d8b0e4444444444");
  assert.equal(booking.booking_origin, "employee_booking");
  assert.equal(booking.is_leadless_booking, true);
});

test("CancelledLead validates an unresolved employee Booking without Lead metadata", async () => {
  const cancellation = new CancelledLead({
    booked_lead: "64c0f47e4d8b0e4444444444",
    cancel_date: new Date("2026-07-23T00:00:00.000Z"),
    refund_amount: 0,
  });

  await assert.doesNotReject(() => cancellation.validate());
  assert.equal(cancellation.lead_ref, undefined);
  assert.equal(cancellation.lead_model, undefined);
});
