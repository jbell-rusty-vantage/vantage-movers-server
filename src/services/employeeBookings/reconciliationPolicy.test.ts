import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAllowedCaseAction,
  assertExactWarningOverrides,
  assertLiveBookingState,
  applyCursorFilter,
  decodeDateIdCursor,
  deriveTrustedOwnerActor,
  encodeDateIdCursor,
} from "./reconciliationPolicy";

test("deriveTrustedOwnerActor rejects bare api secret actor", () => {
  assert.throws(
    () =>
      deriveTrustedOwnerActor(
        { kind: "secret" },
        { adminUserId: undefined, adminEmail: undefined, adminRole: undefined },
      ),
    /Forbidden/,
  );
});

test("deriveTrustedOwnerActor accepts trusted owner headers with primary secret", () => {
  assert.deepEqual(
    deriveTrustedOwnerActor(
      { kind: "secret" },
      {
        adminUserId: "owner-id",
        adminEmail: "OWNER@example.com",
        adminRole: "owner",
      },
    ),
    {
      actor: "owner:owner@example.com",
      ownerId: "owner-id",
      ownerEmail: "owner@example.com",
    },
  );
});

test("deriveTrustedOwnerActor accepts owner users directly", () => {
  assert.deepEqual(
    deriveTrustedOwnerActor(
      { kind: "user", role: "owner", userId: "user-id", email: "Owner@Example.com" } as any,
      { adminUserId: undefined, adminEmail: undefined, adminRole: undefined },
    ),
    {
      actor: "owner:user-id",
      ownerId: "user-id",
      ownerEmail: "Owner@Example.com",
    },
  );
});

test("deriveTrustedOwnerActor rejects non-owner users and bare secrets", () => {
  assert.throws(
    () =>
      deriveTrustedOwnerActor(
        { kind: "user", role: "member", userId: "user-id", email: "user@example.com" } as any,
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

test("assertAllowedCaseAction allows only valid transitions", () => {
  assert.doesNotThrow(() => assertAllowedCaseAction("pending", "dismiss"));
  assert.doesNotThrow(() => assertAllowedCaseAction("pending", "update_pending"));
  assert.doesNotThrow(() => assertAllowedCaseAction("resolved", "reopen"));
  assert.throws(() => assertAllowedCaseAction("pending", "reopen"), /does not allow reopen/);
  assert.throws(() => assertAllowedCaseAction("dismissed", "attach_existing"), /does not allow attach_existing/);
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
});

test("applyCursorFilter uses date plus id tie-break", () => {
  const at = new Date("2026-07-23T12:00:00.000Z");
  const cursor = decodeDateIdCursor(encodeDateIdCursor(at, "b"))!;
  const filtered = applyCursorFilter(
    [
      { id: "a", sortDate: at },
      { id: "b", sortDate: at },
      { id: "c", sortDate: at },
    ],
    cursor,
    "asc",
  );
  assert.deepEqual(filtered.map((item) => item.id), ["c"]);
});
