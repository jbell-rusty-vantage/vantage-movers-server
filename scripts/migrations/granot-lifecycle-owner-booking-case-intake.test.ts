import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPERATOR_BOOKING_CASE_INTAKE_REASON,
  OWNER_BOOKING_CASE_INTAKE_VERSION,
  assertOwnerBookingCaseIntakeApplyAllowed,
  buildOwnerBookingCaseIntakeManifest,
  planOwnerBookingCaseIntakeRow,
  planOwnerBookingCaseIntakeWrites,
  scanOwnerBookingCaseIntakeManifestForPii,
  type OwnerBookingCaseIntakeFacts,
  type OwnerBookingCaseIntakeWrite,
} from "./granot-lifecycle-owner-booking-case-intake.lib.js";

function bookedJob(overrides: Partial<OwnerBookingCaseIntakeFacts> = {}): OwnerBookingCaseIntakeFacts {
  return {
    observation_id: "6a874c35eac3718160f4db0b",
    receipt_id: "6a874c34bd5412173dc4e6c5",
    latest_decision_id: "6a874c35eac3718160f4db0c",
    attempt: 1,
    execution_mode: "historical_shadow",
    captured_at: "2026-08-20T18:49:24.824Z",
    observation_job: "5562117",
    source_label: "10best inbounds",
    booking_action: "booked",
    lifecycle_disposition: "source_scoped_lead",
    identity_outcome: "unmatched",
    booking_exists: false,
    case_exists: false,
    booking_classification: {
      kind: "case",
      mode: "create_missing_booking",
      evidence_action: "booked",
    },
    ...overrides,
  };
}

test("missing booking case on a Booked job plans an owner intake case, not a Booking", () => {
  const planned = planOwnerBookingCaseIntakeRow(bookedJob());
  assert.equal(planned.action, "open_booking_case_operator_exception");
  assert.equal(planned.apply_eligible, true);
  assert.equal(planned.open_booking_case, true);
  assert.equal(planned.booking_case_mode, "create_missing_booking");
  assert.equal(planned.operator_reason, OPERATOR_BOOKING_CASE_INTAKE_REASON);
  assert.equal(planned.create_official_booking, false);
  assert.equal(planned.next_attempt, 2);
});

test("Referral Booked plans create_referral_booking", () => {
  const planned = planOwnerBookingCaseIntakeRow(
    bookedJob({
      observation_id: "6a8744e4eac3718160f4dab1",
      observation_job: "5562538",
      source_label: "referral",
      lifecycle_disposition: "referral_booking",
      booking_classification: {
        kind: "case",
        mode: "create_referral_booking",
        evidence_action: "booked",
      },
    }),
  );
  assert.equal(planned.booking_case_mode, "create_referral_booking");
  assert.equal(planned.apply_eligible, true);
});

test("existing official Booking plans review_existing_booking", () => {
  const planned = planOwnerBookingCaseIntakeRow(
    bookedJob({
      observation_id: "6a874f5eeac3718160f4db52",
      observation_job: "5561906",
      execution_mode: "live",
      booking_exists: true,
      booking_id: "6a8747d9bd5412173dc4e6a1",
      booking_classification: {
        kind: "case",
        mode: "review_existing_booking",
        evidence_action: "booked",
        deterministic_booking_id: "6a8747d9bd5412173dc4e6a1",
      },
    }),
  );
  assert.equal(planned.booking_case_mode, "review_existing_booking");
  assert.equal(planned.apply_eligible, true);
  assert.equal(planned.create_official_booking, false);
});

test("already-open case is a no-op", () => {
  const planned = planOwnerBookingCaseIntakeRow(
    bookedJob({
      case_exists: true,
      case_id: "6a875b809f4c8bcfbf5cd875",
    }),
  );
  assert.equal(planned.action, "already_open");
  assert.equal(planned.apply_eligible, false);
});

test("unclassified Booked rows stay out of apply", () => {
  const planned = planOwnerBookingCaseIntakeRow(
    bookedJob({
      booking_classification: { kind: "none", reason: "missing_job_number" },
    }),
  );
  assert.equal(planned.action, "leave_unclassified");
  assert.equal(planned.apply_eligible, false);
});

test("write plan never mints a Booking or mutates the original Decision", () => {
  const writes = planOwnerBookingCaseIntakeWrites([
    planOwnerBookingCaseIntakeRow(bookedJob()),
    planOwnerBookingCaseIntakeRow(bookedJob({ case_exists: true, case_id: "6a875b809f4c8bcfbf5cd875" })),
  ]);
  assert.equal(writes.filter((write) => write.kind === "insert_booking_reconciliation_case").length, 1);
  assert.equal(writes.filter((write) => write.kind === "insert_repair_decision").length, 1);
  assert.equal(writes.some((write) => write.kind === "insert_official_booking"), false);
  assert.equal(writes.some((write) => write.kind === "update_original_decision"), false);
});

test("second apply of already-open rows plans zero writes", () => {
  const writes = planOwnerBookingCaseIntakeWrites([
    planOwnerBookingCaseIntakeRow(bookedJob({ case_exists: true, case_id: "6a875b809f4c8bcfbf5cd875" })),
  ]);
  assert.deepEqual(writes, []);
});

test("apply refuses official Booking writes and unclassified eligible rows", () => {
  const unclassified = planOwnerBookingCaseIntakeRow(
    bookedJob({ booking_classification: { kind: "none", reason: "missing_job_number" } }),
  );
  const writes: OwnerBookingCaseIntakeWrite[] = [
    {
      kind: "insert_official_booking",
      normalized_job_no: "5562117",
    },
  ];
  assert.throws(() =>
    assertOwnerBookingCaseIntakeApplyAllowed({
      rows: [planOwnerBookingCaseIntakeRow(bookedJob())],
      writes,
    }),
  );
  assert.throws(() =>
    assertOwnerBookingCaseIntakeApplyAllowed({
      rows: [{ ...unclassified, apply_eligible: true }],
      writes: [],
    }),
  );
});

test("manifest keeps ids and jobs and strips names, phones, and emails", () => {
  const planned = [planOwnerBookingCaseIntakeRow(bookedJob())];
  const manifest = buildOwnerBookingCaseIntakeManifest({
    databaseName: "vantagemovers",
    mode: "report",
    capturedFrom: "2026-08-20T04:00:00.000Z",
    capturedTo: "2026-08-21T04:00:00.000Z",
    rows: planned,
    writes: planOwnerBookingCaseIntakeWrites(planned),
  });
  assert.equal(manifest.script_version, OWNER_BOOKING_CASE_INTAKE_VERSION);
  assert.equal(manifest.summary.apply_eligible, 1);
  assert.equal(manifest.summary.official_bookings_planned, 0);
  assert.deepEqual(scanOwnerBookingCaseIntakeManifestForPii(manifest), []);
});
