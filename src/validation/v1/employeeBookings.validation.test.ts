import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBookingLeadReconciliationSchema } from "./employeeBookings.validation";

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

test("create-and-attach requires Phone or Job Number for a Call Lead", () => {
  const result = resolveBookingLeadReconciliationSchema.safeParse({
    action: "create_and_attach",
    revision: 0,
    lead_model: "CallLead",
    lead_fields: { name: "Jane Customer" },
  });

  assert.equal(result.success, false);
});
