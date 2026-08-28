import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  bookingHasRecoverableJobNumber,
  cancellationCorrelationSnapshotsFromBooking,
  snapshotsForCancelledLeadCreate,
} from "./cancellationCorrelationSnapshots";

const LEAD_ID = "64c0f47e4d8b0e4444444444";
const CREATED = new Date("2026-03-01T12:00:00.000Z");

test("cancellation snapshots stamp four fields from a surviving Booking", () => {
  const snapshots = cancellationCorrelationSnapshotsFromBooking({
    job_no: "P7702",
    normalized_job_no: "7702",
    lead_ref: new mongoose.Types.ObjectId(LEAD_ID),
    lead_model: "FormLead",
    createdAt: CREATED,
  });
  assert.deepEqual(snapshots, {
    job_no_snapshot: "P7702",
    normalized_job_no_snapshot: "7702",
    lead_ref_snapshot: { model: "FormLead", id: LEAD_ID },
    booking_created_at_snapshot: CREATED,
  });
});

test("cancellation snapshots normalize job_no when Booking normalized field is missing", () => {
  const snapshots = cancellationCorrelationSnapshotsFromBooking({
    job_no: "p7702",
    lead_model: "CallLead",
    lead_ref: LEAD_ID,
    createdAt: CREATED,
  });
  assert.equal(snapshots.job_no_snapshot, "p7702");
  assert.equal(snapshots.normalized_job_no_snapshot, "P7702");
  assert.deepEqual(snapshots.lead_ref_snapshot, { model: "CallLead", id: LEAD_ID });
});

test("cancellation snapshots stay null without a recoverable Booking job", () => {
  const snapshots = cancellationCorrelationSnapshotsFromBooking({
    lead_ref: LEAD_ID,
    lead_model: "FormLead",
    createdAt: CREATED,
  });
  assert.equal(snapshots.job_no_snapshot, null);
  assert.equal(snapshots.normalized_job_no_snapshot, null);
  assert.equal(bookingHasRecoverableJobNumber({}), false);
  assert.equal(bookingHasRecoverableJobNumber({ job_no: "7702" }), true);
});

test("cancellation snapshots refuse silent inference from contact-shaped fields", () => {
  const snapshots = cancellationCorrelationSnapshotsFromBooking({
    job_no: "",
    customer_name: "Not A Job",
    customer_phone: "5550100100",
  } as { job_no?: unknown });
  assert.equal(snapshots.normalized_job_no_snapshot, null);
  assert.equal(snapshots.lead_ref_snapshot, null);
  assert.equal(snapshots.booking_created_at_snapshot, null);
});

test("create-path stamp keeps ObjectId lead ref", () => {
  const stamped = snapshotsForCancelledLeadCreate({
    job_no: "7702",
    normalized_job_no: "7702",
    lead_ref: new mongoose.Types.ObjectId(LEAD_ID),
    lead_model: "FormLead",
    createdAt: CREATED,
  });
  assert.equal(stamped.normalized_job_no_snapshot, "7702");
  assert.equal(stamped.lead_ref_snapshot?.model, "FormLead");
  assert.equal(String(stamped.lead_ref_snapshot?.id), LEAD_ID);
});
