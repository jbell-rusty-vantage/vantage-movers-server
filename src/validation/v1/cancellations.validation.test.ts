import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCancelledLeadSchema,
  updateCancelledLeadSchema,
} from "./cancellations.validation";

const createInput = {
  booked_lead: "64c0f47e4d8b0e4444444444",
  refund_amount: 0,
};

test("create and update Cancellation schemas reject client-supplied correlation snapshots", () => {
  const snapshots = {
    job_no_snapshot: "7702",
    normalized_job_no_snapshot: "7702",
    lead_ref_snapshot: { model: "FormLead", id: "64c0f47e4d8b0e5555555555" },
    booking_created_at_snapshot: "2026-03-01T12:00:00.000Z",
  };
  for (const field of Object.keys(snapshots)) {
    assert.equal(
      createCancelledLeadSchema.safeParse({ ...createInput, [field]: snapshots[field as keyof typeof snapshots] }).success,
      false,
      `create must reject ${field}`,
    );
    assert.equal(
      updateCancelledLeadSchema.safeParse({ [field]: snapshots[field as keyof typeof snapshots] }).success,
      false,
      `update must reject ${field}`,
    );
  }
});
