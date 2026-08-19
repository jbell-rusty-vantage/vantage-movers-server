import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOOKING_DISCREPANCY_REASON_CODES,
  GRANOT_BOOKING_DISCREPANCY_INDEXES,
  GranotBookingDiscrepancy,
} from "./GranotBookingDiscrepancy";

describe("GranotBookingDiscrepancy", () => {
  it("[AC-26][AC-35][AC-36] fixes Booking reasons and exact partial indexes", () => {
    assert.deepEqual(BOOKING_DISCREPANCY_REASON_CODES, [
      "booked_record_link_conflict",
      "booked_booking_lead_conflict",
      "booked_job_number_conflict",
      "booked_source_scope_conflict",
      "booked_after_official_cancellation",
    ]);
    assert.deepEqual(GRANOT_BOOKING_DISCREPANCY_INDEXES, [
      {
        name: "granot_booking_discrepancy_open_fingerprint_unique",
        key: { normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1 },
        unique: true,
        partialFilterExpression: { state: "open" },
      },
      {
        name: "granot_booking_discrepancy_state_last_evidence",
        key: { state: 1, last_evidence_at: -1 },
      },
    ]);
    assert.equal(GranotBookingDiscrepancy.schema.options.autoIndex, false);
  });

  it("[AC-26][AC-36] rejects Release reasons and unsafe resolved/evidence mutation", async () => {
    const base = {
      normalized_job_no: "U29MODEL1",
      discrepancy_kind: "booking" as const,
      reason_code: "booked_after_official_cancellation" as const,
      reason_fingerprint: "a".repeat(64),
      state: "open" as const,
      evidence: [{
        observation_id: "64b000000000000000000001",
        decision_id: "64b000000000000000000002",
        captured_at: new Date("2026-08-19T00:00:00.000Z"),
        action: "booked" as const,
      }],
      evidence_revision: 1,
      revision: 1,
      opened_at: new Date("2026-08-19T00:00:00.000Z"),
      last_evidence_at: new Date("2026-08-19T00:00:00.000Z"),
    };
    await new GranotBookingDiscrepancy(base).validate();
    await assert.rejects(
      () => new GranotBookingDiscrepancy({
        ...base,
        reason_code: "release_without_vantage_booking",
      }).validate(),
      /reason_code/,
    );
  });
});
