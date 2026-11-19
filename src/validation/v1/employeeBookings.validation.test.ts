import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBookingLeadReconciliationSchema } from "./employeeBookings.validation";

test("create-and-attach rejects a Call Lead even with valid contact details", () => {
  const result = resolveBookingLeadReconciliationSchema.safeParse({
    action: "create_and_attach",
    revision: 0,
    lead_model: "CallLead",
    lead_fields: { name: "Jane Customer", phone_number: "2125550101", job_no: "5550001" },
  });

  assert.equal(result.success, false);
});
