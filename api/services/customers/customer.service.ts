import { BookedLead } from "../../models/BookedLead";
import { Customer } from "../../models/Customer";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "../../validation/v1.validation";
import { V1ServiceError } from "../v1ServiceError";
// `deleteCustomer` cascades into the booking lifecycle, but pulling the
// booking service synchronously here would create a load-time cycle through
// `bookings/index.ts` -> `bookedLead.service.ts` -> ... -> back into this
// file via the `customers/` barrel. We import from the v1 service facade,
// which re-exports `deleteBookedLead`, so the cycle is broken at module
// load time and resolved at call time. This mirrors the pattern used by
// `leads/formLead.service.ts` and `leads/callLead.service.ts`.
import { deleteBookedLead } from "../v1.service";

export async function createCustomer(input: CreateCustomerInput) {
  return Customer.create(input);
}

export async function updateCustomer(id: string, input: UpdateCustomerInput) {
  const customer = await Customer.findByIdAndUpdate(id, input, { returnDocument: "after" });
  if (!customer) {
    throw new V1ServiceError("Customer not found", 404);
  }

  return customer;
}

export async function findAllCustomers() {
  return Customer.find().sort({ createdAt: -1 }).limit(200);
}

export async function deleteCustomer(id: string, cascade: boolean) {
  const bookings = await BookedLead.find({ customer: id });
  if (bookings.length > 0 && !cascade) {
    throw new V1ServiceError("Customer has bookings; pass cascade=true to delete dependents", 409);
  }
  for (const booking of bookings) {
    await deleteBookedLead(booking._id.toString(), true);
  }
  await Customer.findByIdAndDelete(id);
}
