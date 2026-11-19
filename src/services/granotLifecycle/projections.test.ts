import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertProjectionSafe,
  collectForbiddenProjectionKeys,
  projectBookingIntakeCapabilities,
  projectOwnerVisibleContact,
} from "./projections";

test("intake case detail hands the Owner the whole contact, not an initial and four digits", () => {
  const raw = {
    first_name: "Synthetic",
    last_name: "Customer",
    phone_number: "+1 (212) 555-0199",
    email: "synthetic-customer@example.invalid",
  };
  assert.deepEqual(projectOwnerVisibleContact(raw), {
    name: "Synthetic Customer",
    phone_number: "+1 (212) 555-0199",
    email: "synthetic-customer@example.invalid",
  });
  assert.equal(projectOwnerVisibleContact({}), undefined);
  assert.equal(projectOwnerVisibleContact(undefined), undefined);
});

test("[AC-35] lifecycle DTO recursive guard rejects raw transport and credentials", () => {
  const safe = { items: [], next_cursor: null, current: {}, capabilities: { booking_cases: true, release_cases: false, discrepancies: false, official_facts: true } };
  assertProjectionSafe(safe);
  assert.deepEqual(collectForbiddenProjectionKeys({ ...safe, payload: { authorization: "redacted" } }).sort(), ["authorization", "payload"]);
  assertProjectionSafe({
    present: true,
    masked_ref: "64c0f4...4444",
    id: "64c0f4a1b2c3d4e5f6a74444",
    public_cancel_allowed: true,
  });
});

test("[AC-R3] capabilities matrix follows spec §7 and hides Confirm Cancellation when commands are off", () => {
  const reviewRelease = projectBookingIntakeCapabilities({
    kind: "booking",
    state: "open",
    mode: "review_existing_booking",
    latest_action: "release",
    booking_commands_enabled: true,
    referral_booking_enabled: false,
    release_commands_enabled: false,
  });
  assert.equal(reviewRelease.commands, true);
  assert.equal(reviewRelease.confirm_cancellation, true);

  const reviewBooked = projectBookingIntakeCapabilities({
    kind: "booking",
    state: "open",
    mode: "review_existing_booking",
    latest_action: "booked",
    booking_commands_enabled: true,
    referral_booking_enabled: false,
    release_commands_enabled: false,
  });
  assert.equal(reviewBooked.commands, true);
  assert.equal(reviewBooked.confirm_cancellation, false);

  const createMissingRelease = projectBookingIntakeCapabilities({
    kind: "booking",
    state: "open",
    mode: "create_missing_booking",
    latest_action: "release",
    booking_commands_enabled: true,
    referral_booking_enabled: false,
    release_commands_enabled: false,
  });
  assert.equal(createMissingRelease.commands, true);
  assert.equal(createMissingRelease.confirm_cancellation, false);

  const createReferralRelease = projectBookingIntakeCapabilities({
    kind: "booking",
    state: "open",
    mode: "create_referral_booking",
    latest_action: "release",
    booking_commands_enabled: true,
    referral_booking_enabled: true,
    release_commands_enabled: false,
  });
  assert.equal(createReferralRelease.commands, true);
  assert.equal(createReferralRelease.confirm_cancellation, false);

  const commandsOff = projectBookingIntakeCapabilities({
    kind: "booking",
    state: "open",
    mode: "review_existing_booking",
    latest_action: "release",
    booking_commands_enabled: false,
    referral_booking_enabled: false,
    release_commands_enabled: true,
  });
  assert.equal(commandsOff.commands, false);
  assert.equal(commandsOff.confirm_cancellation, false);

  const resolved = projectBookingIntakeCapabilities({
    kind: "booking",
    state: "resolved",
    mode: "review_existing_booking",
    latest_action: "release",
    booking_commands_enabled: true,
    referral_booking_enabled: false,
    release_commands_enabled: false,
  });
  assert.equal(resolved.commands, false);
  assert.equal(resolved.confirm_cancellation, false);

  const historicalPriority = projectBookingIntakeCapabilities({
    kind: "booking",
    state: "open",
    mode: "review_existing_booking",
    latest_action: "priority_5",
    booking_commands_enabled: true,
    referral_booking_enabled: false,
    release_commands_enabled: false,
  });
  assert.equal(historicalPriority.commands, true);
  assert.equal(historicalPriority.confirm_cancellation, false);
});
