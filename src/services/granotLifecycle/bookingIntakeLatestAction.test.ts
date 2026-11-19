import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectBookingIntakeLatestAction } from "./bookingIntakeLatestAction";

const captured = new Date("2026-08-18T12:00:00.000Z");
const later = new Date("2026-08-18T13:00:00.000Z");
const lowerHex = "aaaaaaaaaaaaaaaaaaaaaaaa";
const higherHex = "bbbbbbbbbbbbbbbbbbbbbbbb";

describe("selectBookingIntakeLatestAction", () => {
  it("selects the temporally latest booked or release action", () => {
    assert.equal(
      selectBookingIntakeLatestAction([
        { action: "booked", captured_at: captured, observation_id: lowerHex },
        { action: "release", captured_at: later, observation_id: higherHex },
      ]),
      "release",
    );
    assert.equal(
      selectBookingIntakeLatestAction([
        { action: "release", captured_at: captured, observation_id: higherHex },
        { action: "booked", captured_at: later, observation_id: lowerHex },
      ]),
      "booked",
    );
  });

  it("tie-breaks same captured_at with higher Observation id hex", () => {
    assert.equal(
      selectBookingIntakeLatestAction([
        { action: "booked", captured_at: captured, observation_id: lowerHex },
        { action: "release", captured_at: captured, observation_id: higherHex },
      ]),
      "release",
    );
    assert.equal(
      selectBookingIntakeLatestAction([
        { action: "release", captured_at: captured, observation_id: lowerHex },
        { action: "booked", captured_at: captured, observation_id: higherHex },
      ]),
      "booked",
    );
  });
});
