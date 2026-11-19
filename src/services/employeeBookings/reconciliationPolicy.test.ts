import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExactWarningOverrides,
  assertLiveBookingState,
  deriveTrustedOwnerActor,
} from "./reconciliationPolicy";

test("deriveTrustedOwnerActor rejects non-owner users and bare secrets", () => {
  assert.throws(
    () =>
      deriveTrustedOwnerActor(
        { kind: "user", roles: ["sales", "customer_service"], userId: "user-id", email: "user@example.com" } as any,
        { adminUserId: undefined, adminEmail: undefined, adminRole: undefined },
      ),
    /Forbidden/,
  );
  assert.throws(
    () =>
      deriveTrustedOwnerActor(
        { kind: "secret" },
        { adminUserId: undefined, adminEmail: undefined, adminRole: undefined },
      ),
    /Forbidden/,
  );
  assert.throws(
    () =>
      deriveTrustedOwnerActor(
        { kind: "secret" },
        {
          adminUserId: "admin-id",
          adminEmail: "admin@example.com",
          adminRole: "admin",
        },
      ),
    /Forbidden/,
  );
});

test("assertExactWarningOverrides requires exact current overrideable warnings", () => {
  assert.throws(
    () => assertExactWarningOverrides(["duplicate_lead", "source_conflict"], ["duplicate_lead"]),
    /exactly match current warnings/,
  );
});

test("assertLiveBookingState blocks cancelled and invalid booking states", () => {
  assert.doesNotThrow(() =>
    assertLiveBookingState({
      cancelled: false,
      hasLead: false,
      action: "attach_existing",
    }),
  );
  assert.throws(
    () =>
      assertLiveBookingState({
        cancelled: true,
        hasLead: false,
        action: "attach_existing",
      }),
    /Booking is cancelled/,
  );
  assert.throws(
    () =>
      assertLiveBookingState({
        cancelled: true,
        hasLead: false,
        action: "update_pending",
      }),
    /Booking is cancelled/,
  );
  assert.throws(
    () =>
      assertLiveBookingState({
        cancelled: true,
        hasLead: true,
        action: "reassign",
      }),
    /Booking is cancelled/,
  );
  assert.doesNotThrow(() =>
    assertLiveBookingState({
      cancelled: true,
      hasLead: false,
      action: "reopen",
    }),
  );
  assert.doesNotThrow(() =>
    assertLiveBookingState({
      cancelled: true,
      hasLead: false,
      action: "dismiss",
    }),
  );
  assert.throws(
    () =>
      assertLiveBookingState({
        cancelled: false,
        hasLead: true,
        action: "dismiss",
      }),
    /already attached to a lead/,
  );
  assert.throws(
    () =>
      assertLiveBookingState({
        cancelled: false,
        hasLead: false,
        action: "reassign",
      }),
    /no attached lead to reassign/,
  );
  assert.throws(
    () =>
      assertLiveBookingState({
        cancelled: false,
        hasLead: true,
        action: "reopen",
      }),
    /already attached to a lead/,
  );
  assert.doesNotThrow(() =>
    assertLiveBookingState({
      cancelled: false,
      hasLead: false,
      action: "reopen",
    }),
  );
});
