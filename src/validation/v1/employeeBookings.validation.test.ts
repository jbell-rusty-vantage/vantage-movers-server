import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookingLeadReconciliationListQuerySchema,
  resolveBookingLeadReconciliationSchema,
} from "./employeeBookings.validation";

test("reconciliation list query accepts owner_booking origin", () => {
  const parsed = bookingLeadReconciliationListQuerySchema.parse({
    origin: "owner_booking",
  });
  assert.equal(parsed.origin, "owner_booking");
});

test("create-and-attach validates Form Lead fields for its selected model", () => {
  const result = resolveBookingLeadReconciliationSchema.safeParse({
    action: "create_and_attach",
    revision: 0,
    lead_model: "FormLead",
    lead_fields: {
      name: "Jane Customer",
      phone_number: "2125550101",
    },
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) => issue.path.join(".") === "lead_fields.pickup_zip",
      ),
    );
  }
});

test("create-and-attach rejects a Call Lead even with valid contact details", () => {
  const result = resolveBookingLeadReconciliationSchema.safeParse({
    action: "create_and_attach",
    revision: 0,
    lead_model: "CallLead",
    lead_fields: { name: "Jane Customer", phone_number: "2125550101", job_no: "5550001" },
  });

  assert.equal(result.success, false);
});
