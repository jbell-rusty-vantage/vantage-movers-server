import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import { assertBookingIntakeCancelAllowed } from "./bookingOwnerCommands";

const captured = new Date("2026-08-18T12:00:00.000Z");
const later = new Date("2026-08-18T13:00:00.000Z");
const bookedId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const releaseId = "bbbbbbbbbbbbbbbbbbbbbbbb";

function evidence(
  rows: Array<{ action: "priority_5" | "booked" | "release"; captured_at: Date; observation_id: string }>,
) {
  return rows;
}

function assertConflict(caseRow: Parameters<typeof assertBookingIntakeCancelAllowed>[0]) {
  assert.throws(
    () => assertBookingIntakeCancelAllowed(caseRow),
    (error: unknown) =>
      error instanceof GranotLifecycleError &&
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT &&
      error.statusCode === 409,
  );
}

describe("assertBookingIntakeCancelAllowed", () => {
  it("allows open review_existing_booking with latest Release", () => {
    assert.doesNotThrow(() => assertBookingIntakeCancelAllowed({
      state: "open",
      mode: "review_existing_booking",
      evidence: evidence([
        { action: "booked", captured_at: captured, observation_id: bookedId },
        { action: "release", captured_at: later, observation_id: releaseId },
      ]),
    }));
  });

  it("rejects create_missing_booking even when latest action is Release", () => {
    assertConflict({
      state: "open",
      mode: "create_missing_booking",
      evidence: evidence([{ action: "release", captured_at: later, observation_id: releaseId }]),
    });
  });

  it("rejects create_referral_booking even when latest action is Release", () => {
    assertConflict({
      state: "open",
      mode: "create_referral_booking",
      evidence: evidence([{ action: "release", captured_at: later, observation_id: releaseId }]),
    });
  });

  it("rejects review_existing_booking when latest action is Booked", () => {
    assertConflict({
      state: "open",
      mode: "review_existing_booking",
      evidence: evidence([
        { action: "release", captured_at: captured, observation_id: releaseId },
        { action: "booked", captured_at: later, observation_id: bookedId },
      ]),
    });
  });

  it("rejects a resolved review case even when latest action is Release", () => {
    assertConflict({
      state: "resolved",
      mode: "review_existing_booking",
      evidence: evidence([{ action: "release", captured_at: later, observation_id: releaseId }]),
    });
  });
});
