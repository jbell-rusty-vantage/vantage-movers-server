/**
 * Public barrel for the customers service folder.
 *
 * Route-facing CRUD lives in `customer.service.ts`. Booking-time customer
 * upsert lives in `customerFromLead.service.ts` to keep that helper free of
 * any dependency on the booking lifecycle (which itself imports it).
 */

export {
  createCustomer,
  deleteCustomer,
  findAllCustomers,
  updateCustomer,
} from "./customer.service";

export { upsertCustomerFromBookingContact, upsertCustomerFromLead } from "./customerFromLead.service";
