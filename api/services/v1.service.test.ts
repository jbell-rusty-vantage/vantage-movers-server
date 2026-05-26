import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { BookedLead } from "../models/BookedLead";
import { CallLead } from "../models/CallLead";
import { Customer } from "../models/Customer";
import { FormLead } from "../models/FormLead";
import { refreshAttachedBookingFromLead } from "./v1.service";

type StubbedModel = {
  findById?: unknown;
  findOneAndUpdate?: unknown;
};

type CustomerUpdate = {
  full_name: string;
  phone_number: string;
  email?: string;
};

const originalBookedFindById = BookedLead.findById as unknown;
const originalCustomerFindOneAndUpdate = Customer.findOneAndUpdate as unknown;

afterEach(() => {
  (BookedLead as unknown as StubbedModel).findById = originalBookedFindById;
  (Customer as unknown as StubbedModel).findOneAndUpdate = originalCustomerFindOneAndUpdate;
});

test("booked call lead refreshes attached booking customer and local", async () => {
  const leadId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const booking = BookedLead.hydrate({
    _id: bookingId,
    lead_ref: leadId,
    lead_model: "CallLead",
    customer: new mongoose.Types.ObjectId(),
    local: "long_distance",
  });
  let bookingSaves = 0;
  booking.save = async () => {
    bookingSaves += 1;
    return booking;
  };
  stubBookedLead(booking);
  const customerUpdates = stubCustomerUpsert(customerId);
  const lead = CallLead.hydrate({
    _id: leadId,
    booked: bookingId,
    name: "Jane Customer",
    phone_number: "(555) 111-2222",
    email: "JANE@EXAMPLE.COM",
    local: "local",
  });

  const job = await refreshAttachedBookingFromLead(lead, "CallLead", "call_lead.update");

  assert.equal(job.resource, "booking_chain");
  assert.equal(job.operation, "call_lead.update");
  assert.equal(job.bookingId, bookingId.toString());
  assert.equal(booking.customer?.toString(), customerId.toString());
  assert.equal(booking.local, "local");
  assert.equal(bookingSaves, 1);
  assert.deepEqual(customerUpdates, [
    {
      full_name: "Jane Customer",
      phone_number: "(555) 111-2222",
      email: "jane@example.com",
    },
  ]);
});

test("booked form lead refreshes attached booking customer and local", async () => {
  const leadId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const booking = BookedLead.hydrate({
    _id: bookingId,
    lead_ref: leadId,
    lead_model: "FormLead",
    local: "local",
  });
  let bookingSaves = 0;
  booking.save = async () => {
    bookingSaves += 1;
    return booking;
  };
  stubBookedLead(booking);
  const customerUpdates = stubCustomerUpsert(customerId);
  const lead = FormLead.hydrate({
    _id: leadId,
    booked: bookingId,
    name: "John Customer",
    phone_number: "555-222-3333",
    email: "john@example.com",
    local: "long_distance",
  });

  const job = await refreshAttachedBookingFromLead(lead, "FormLead", "form_lead.update");

  assert.equal(job.resource, "booking_chain");
  assert.equal(job.operation, "form_lead.update");
  assert.equal(job.bookingId, bookingId.toString());
  assert.equal(booking.customer?.toString(), customerId.toString());
  assert.equal(booking.local, "long_distance");
  assert.equal(bookingSaves, 1);
  assert.deepEqual(customerUpdates, [
    {
      full_name: "John Customer",
      phone_number: "555-222-3333",
      email: "john@example.com",
    },
  ]);
});

test("unbooked lead keeps source lead sync target", async () => {
  let bookingLookupCount = 0;
  let customerUpsertCount = 0;
  (BookedLead as unknown as { findById: () => Promise<null> }).findById = async () => {
    bookingLookupCount += 1;
    return null;
  };
  (Customer as unknown as { findOneAndUpdate: () => unknown }).findOneAndUpdate = () => {
    customerUpsertCount += 1;
    return { orFail: async () => undefined };
  };
  const lead = CallLead.hydrate({
    _id: new mongoose.Types.ObjectId(),
    name: "Jane Customer",
    phone_number: "555-111-2222",
  });

  const job = await refreshAttachedBookingFromLead(lead, "CallLead", "call_lead.update");

  assert.deepEqual(job, {
    resource: "source_lead",
    operation: "call_lead.update",
    leadModel: "CallLead",
    leadId: lead._id.toString(),
  });
  assert.equal(bookingLookupCount, 0);
  assert.equal(customerUpsertCount, 0);
});

test("stale booking reference falls back to source lead sync", async () => {
  stubBookedLead(null);
  let customerUpsertCount = 0;
  (Customer as unknown as { findOneAndUpdate: () => unknown }).findOneAndUpdate = () => {
    customerUpsertCount += 1;
    return { orFail: async () => undefined };
  };
  const lead = CallLead.hydrate({
    _id: new mongoose.Types.ObjectId(),
    booked: new mongoose.Types.ObjectId(),
    name: "Jane Customer",
    phone_number: "555-111-2222",
  });

  const job = await refreshAttachedBookingFromLead(lead, "CallLead", "call_lead.update");

  assert.equal(job.resource, "source_lead");
  assert.equal(job.leadModel, "CallLead");
  assert.equal(job.leadId, lead._id.toString());
  assert.equal(customerUpsertCount, 0);
});

test("mismatched booking reference falls back to source lead sync", async () => {
  const leadId = new mongoose.Types.ObjectId();
  const booking = BookedLead.hydrate({
    _id: new mongoose.Types.ObjectId(),
    lead_ref: new mongoose.Types.ObjectId(),
    lead_model: "FormLead",
  });
  let bookingSaves = 0;
  booking.save = async () => {
    bookingSaves += 1;
    return booking;
  };
  stubBookedLead(booking);
  let customerUpsertCount = 0;
  (Customer as unknown as { findOneAndUpdate: () => unknown }).findOneAndUpdate = () => {
    customerUpsertCount += 1;
    return { orFail: async () => undefined };
  };
  const lead = CallLead.hydrate({
    _id: leadId,
    booked: booking._id,
    name: "Jane Customer",
    phone_number: "555-111-2222",
  });

  const job = await refreshAttachedBookingFromLead(lead, "CallLead", "call_lead.update");

  assert.equal(job.resource, "source_lead");
  assert.equal(job.leadModel, "CallLead");
  assert.equal(job.leadId, leadId.toString());
  assert.equal(bookingSaves, 0);
  assert.equal(customerUpsertCount, 0);
});

function stubBookedLead(booking: mongoose.HydratedDocument<unknown> | null) {
  (BookedLead as unknown as { findById: () => Promise<typeof booking> }).findById = async () =>
    booking;
}

function stubCustomerUpsert(customerId: mongoose.Types.ObjectId): CustomerUpdate[] {
  const updates: CustomerUpdate[] = [];
  (Customer as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    _query: unknown,
    update: CustomerUpdate,
  ) => {
    updates.push(update);
    return {
      orFail: async () =>
        Customer.hydrate({
          _id: customerId,
          ...update,
        }),
    };
  };
  return updates;
}
