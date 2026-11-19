import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { CancelledLead } from "./CancelledLead";

function cancellationAttrs() {
  return {
    booked_lead: new mongoose.Types.ObjectId(),
    cancel_date: new Date("2026-07-23T00:00:00.000Z"),
    refund_amount: 0,
    job_no_snapshot: "7702",
    normalized_job_no_snapshot: "7702",
    lead_ref_snapshot: { model: "FormLead" as const, id: new mongoose.Types.ObjectId() },
    booking_created_at_snapshot: new Date("2026-03-01T12:00:00.000Z"),
  };
}

test("CancelledLead correlation snapshots are immutable after insert", async () => {
  const cancellation = new CancelledLead(cancellationAttrs());
  await cancellation.validate();
  cancellation.isNew = false;
  cancellation.normalized_job_no_snapshot = "9999";
  await assert.rejects(
    () => cancellation.validate(),
    /normalized_job_no_snapshot is immutable after insert/,
  );
  cancellation.normalized_job_no_snapshot = "7702";
  cancellation.job_no_snapshot = "changed";
  await assert.rejects(
    () => cancellation.validate(),
    /job_no_snapshot is immutable after insert/,
  );
});
