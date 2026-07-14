import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Customer } from "../../models/Customer";
import {
  upsertCustomerFromBookingContact,
  upsertCustomerFromLead,
} from "./customerFromLead.service";

type StubbedCustomerModel = {
  findOneAndUpdate: (...args: unknown[]) => unknown;
};

const originalFindOneAndUpdate = Customer.findOneAndUpdate as unknown;

afterEach(() => {
  (Customer as unknown as StubbedCustomerModel).findOneAndUpdate =
    originalFindOneAndUpdate as StubbedCustomerModel["findOneAndUpdate"];
});

test("upsertCustomerFromBookingContact matches by phone when provided", async () => {
  let capturedFilter: Record<string, unknown> | undefined;
  stubFindOneAndUpdate((filter) => {
    capturedFilter = filter as Record<string, unknown>;
    return { _id: "507f1f77bcf86cd799439011", full_name: "Jane Doe" };
  });

  await upsertCustomerFromBookingContact({
    customer_name: "Jane Doe",
    customer_phone: "(240) 555-0199",
  });

  assert.deepEqual(capturedFilter, { phone_number: "(240) 555-0199" });
});

test("upsertCustomerFromBookingContact falls back to lead phone when customer phone is blank", async () => {
  let capturedFilter: Record<string, unknown> | undefined;
  stubFindOneAndUpdate((filter) => {
    capturedFilter = filter as Record<string, unknown>;
    return { _id: "507f1f77bcf86cd799439011", full_name: "Jane Doe" };
  });

  await upsertCustomerFromBookingContact({
    customer_name: "Jane Doe",
    lead: { phone_number: "(240) 555-0100" },
  });

  assert.deepEqual(capturedFilter, { phone_number: "(240) 555-0100" });
});

test("upsertCustomerFromBookingContact matches by normalized name when phone is absent", async () => {
  let capturedFilter: Record<string, unknown> | undefined;
  stubFindOneAndUpdate((filter) => {
    capturedFilter = filter as Record<string, unknown>;
    return { _id: "507f1f77bcf86cd799439011", full_name: "Jane Doe" };
  });

  await upsertCustomerFromBookingContact({
    customer_name: "Jane Doe",
  });

  assert.deepEqual(capturedFilter, { normalized_name: "jane doe" });
});

test("upsertCustomerFromLead allows name-only leads", async () => {
  let capturedFilter: Record<string, unknown> | undefined;
  stubFindOneAndUpdate((filter) => {
    capturedFilter = filter as Record<string, unknown>;
    return { _id: "507f1f77bcf86cd799439011", full_name: "Jane Doe" };
  });

  const customer = await upsertCustomerFromLead({ name: "Jane Doe" });

  assert.ok(customer);
  assert.deepEqual(capturedFilter, { normalized_name: "jane doe" });
});

function stubFindOneAndUpdate(
  handler: (filter: unknown, update: unknown, options: unknown) => unknown,
): void {
  (Customer as unknown as StubbedCustomerModel).findOneAndUpdate = (
    filter: unknown,
    update: unknown,
    options: unknown,
  ) => ({
    orFail: async () => handler(filter, update, options),
  });
}
