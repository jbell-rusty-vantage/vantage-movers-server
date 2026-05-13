import mongoose from "mongoose";
import {
  getCplForSource,
  normalizeSourceCompany,
  type LeadModelName,
  type LocalType,
  type SourceCompany,
} from "../config/domain";
import { BookedLead } from "../models/BookedLead";
import { CallLead } from "../models/CallLead";
import { CancelledLead } from "../models/CancelledLead";
import { Customer } from "../models/Customer";
import { FormLead } from "../models/FormLead";
import { mergeSheetSyncEntries } from "../models/schemaHelpers";
import { generateLeadId } from "../utils/ids";
import { getStateCodeForZip } from "../utils/pickupZipState";
import type {
  CreateBookedLeadInput,
  CreateCallLeadInput,
  CreateCancelledLeadInput,
  CreateCustomerInput,
  CreateFormLeadInput,
  UpdateBookedLeadInput,
  UpdateCallLeadInput,
  UpdateCancelledLeadInput,
  UpdateCustomerInput,
  UpdateFormLeadInput,
} from "../validation/v1.validation";
import {
  syncBookedLeadToSheets,
  syncCallLeadToSheets,
  syncFormLeadToSheets,
} from "./googleSheets.service";

type AnyDoc = mongoose.Document & {
  _id: mongoose.Types.ObjectId;
  sheet_sync?: unknown[];
  save(): Promise<unknown>;
};

export class V1ServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "V1ServiceError";
  }
}

export async function createFormLead(input: CreateFormLeadInput) {
  const source_company = normalizeSourceCompany(input.source_company);
  const location = await resolveRequiredLocation(input);
  const local = deriveLocal(location.pickup_state, location.delivery_state);
  const lead = await FormLead.create({
    ...input,
    ...location,
    source_company,
    local,
    lid: input.lid?.trim() || generateLeadId(),
    ref_no: input.ref_no?.trim() || "not provided",
    timestamp: input.timestamp ?? new Date(),
    move_date: input.move_date ?? new Date(),
    cpl: getCplForSource(source_company, local),
  });

  await syncSourceLead(lead, "FormLead");
  return lead;
}

export async function updateFormLead(id: string, input: UpdateFormLeadInput) {
  const lead = await FormLead.findById(id);
  if (!lead) {
    throw new V1ServiceError("Form lead not found", 404);
  }

  Object.assign(lead, input);
  if (input.source_company) {
    lead.source_company = normalizeSourceCompany(input.source_company);
  }
  if (input.pickup_zip || input.destination_zip || input.pickup_state || input.delivery_state) {
    const location = await resolveRequiredLocation({
      pickup_zip: input.pickup_zip ?? lead.pickup_zip,
      destination_zip: input.destination_zip ?? lead.destination_zip,
      pickup_state: input.pickup_state ?? lead.pickup_state,
      delivery_state: input.delivery_state ?? lead.delivery_state,
    });
    lead.pickup_state = location.pickup_state;
    lead.delivery_state = location.delivery_state;
    lead.local = deriveLocal(location.pickup_state, location.delivery_state);
  }
  lead.cpl = getCplForSource(lead.source_company as SourceCompany, lead.local as LocalType);
  await lead.save();
  await syncSourceLead(lead, "FormLead");
  return lead;
}

export async function createCallLead(input: CreateCallLeadInput) {
  const source_company = normalizeSourceCompany(input.source_company);
  const location = await resolveOptionalLocation(input);
  const local = location.local ?? input.local;
  const lead = await CallLead.create({
    ...input,
    ...location,
    source_company,
    local,
    timestamp: input.timestamp ?? new Date(),
    cpl: getCplForSource(source_company, local),
  });

  await syncSourceLead(lead, "CallLead");
  return lead;
}

export async function updateCallLead(id: string, input: UpdateCallLeadInput) {
  const lead = await CallLead.findById(id);
  if (!lead) {
    throw new V1ServiceError("Call lead not found", 404);
  }

  Object.assign(lead, input);
  if (input.source_company) {
    lead.source_company = normalizeSourceCompany(input.source_company);
  }
  if (
    input.pickup_zip ||
    input.delivery_zip ||
    input.pickup_state ||
    input.delivery_state ||
    input.local
  ) {
    const location = await resolveOptionalLocation({
      pickup_zip: optionalValue(input.pickup_zip ?? lead.pickup_zip),
      delivery_zip: optionalValue(input.delivery_zip ?? lead.delivery_zip),
      pickup_state: optionalValue(input.pickup_state ?? lead.pickup_state),
      delivery_state: optionalValue(input.delivery_state ?? lead.delivery_state),
      local: optionalValue(input.local ?? lead.local),
    });
    lead.pickup_state = location.pickup_state;
    lead.delivery_state = location.delivery_state;
    lead.local = location.local ?? input.local ?? lead.local;
  }
  lead.cpl = getCplForSource(lead.source_company as SourceCompany, lead.local as LocalType | undefined);
  await lead.save();
  await syncSourceLead(lead, "CallLead");
  return lead;
}

export async function createBookedLead(input: CreateBookedLeadInput) {
  const lead = await getLinkedLead(input.lead_model, input.lead_ref);
  const local = input.local ?? lead.local;
  if (!local) {
    throw new V1ServiceError("Booking requires local or a linked lead with local classification");
  }
  const customer = await upsertCustomerFromLead(lead);
  const over_2000 = input.deposit_amount > 2000;
  const over_4000 = input.deposit_amount > 4000;

  const booking = await BookedLead.create({
    ...input,
    timestamp: input.timestamp ?? new Date(),
    customer: customer._id,
    local,
    over_2000,
    over_4000,
  });

  await mirrorBookingToLead(input.lead_model, lead, booking._id, over_2000, over_4000, local);
  await syncBookingAndSource(booking._id, input.lead_model, lead._id.toString());
  return BookedLead.findById(booking._id).populate("customer").orFail();
}

export async function updateBookedLead(id: string, input: UpdateBookedLeadInput) {
  const booking = await BookedLead.findById(id);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }

  Object.assign(booking, input);
  if (input.deposit_amount !== undefined) {
    booking.over_2000 = input.deposit_amount > 2000;
    booking.over_4000 = input.deposit_amount > 4000;
  }

  const lead = await getLinkedLead(booking.lead_model as LeadModelName, booking.lead_ref.toString());
  booking.local = input.local ?? booking.local ?? lead.local;
  await booking.save();
  await mirrorBookingToLead(
    booking.lead_model as LeadModelName,
    lead,
    booking._id,
    booking.over_2000,
    booking.over_4000,
    booking.local as LocalType,
  );
  await syncBookingAndSource(booking._id, booking.lead_model as LeadModelName, lead._id.toString());
  return BookedLead.findById(booking._id).populate("customer").orFail();
}

export async function createCancelledLead(input: CreateCancelledLeadInput) {
  const booking = await BookedLead.findById(input.booked_lead).populate("customer");
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }

  const customer = booking.customer as { _id?: mongoose.Types.ObjectId; full_name?: string } | undefined;
  const cancellation = await CancelledLead.create({
    ...input,
    timestamp: input.timestamp ?? new Date(),
    customer: customer?._id ?? booking.customer,
    lead_ref: booking.lead_ref,
    lead_model: booking.lead_model,
    agent: booking.agent,
    book_date: booking.book_date,
    job_no: booking.job_no,
    customer_name: customer?.full_name,
    binder_amount: booking.binder_amount,
    deposit_amount: booking.deposit_amount,
    merchant: booking.merchant,
    source: booking.source,
    local: booking.local,
  });

  booking.cancelled = cancellation._id;
  await booking.save();
  await mirrorCancellationToLead(booking.lead_model as LeadModelName, booking.lead_ref.toString(), cancellation._id);
  await syncBookingAndSource(booking._id, booking.lead_model as LeadModelName, booking.lead_ref.toString());
  return cancellation;
}

export async function updateCancelledLead(id: string, input: UpdateCancelledLeadInput) {
  const cancellation = await CancelledLead.findByIdAndUpdate(id, input, {
    returnDocument: "after",
  });
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }

  return cancellation;
}

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

export async function findAllFormLeads() {
  return FormLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function findAllCallLeads() {
  return CallLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function findAllBookedLeads() {
  return BookedLead.find().populate("customer").sort({ createdAt: -1 }).limit(200);
}

export async function findAllCancelledLeads() {
  return CancelledLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function findAllCustomers() {
  return Customer.find().sort({ createdAt: -1 }).limit(200);
}

export async function deleteFormLead(id: string, cascade: boolean) {
  const lead = await FormLead.findById(id);
  if (!lead) {
    throw new V1ServiceError("Form lead not found", 404);
  }
  if (lead.booked && !cascade) {
    throw new V1ServiceError("Form lead has a booking; pass cascade=true to delete dependents", 409);
  }
  if (lead.booked && cascade) {
    await deleteBookedLead(lead.booked.toString(), true);
  }
  await lead.deleteOne();
}

export async function deleteCallLead(id: string, cascade: boolean) {
  const lead = await CallLead.findById(id);
  if (!lead) {
    throw new V1ServiceError("Call lead not found", 404);
  }
  if (lead.booked && !cascade) {
    throw new V1ServiceError("Call lead has a booking; pass cascade=true to delete dependents", 409);
  }
  if (lead.booked && cascade) {
    await deleteBookedLead(lead.booked.toString(), true);
  }
  await lead.deleteOne();
}

export async function deleteBookedLead(id: string, cascade: boolean) {
  const booking = await BookedLead.findById(id);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  if (booking.cancelled && !cascade) {
    throw new V1ServiceError("Booked lead has a cancellation; pass cascade=true to delete dependents", 409);
  }
  if (booking.cancelled && cascade) {
    await CancelledLead.findByIdAndDelete(booking.cancelled);
  }
  await clearBookingFromLead(booking.lead_model as LeadModelName, booking.lead_ref.toString());
  await booking.deleteOne();
}

export async function deleteCancelledLead(id: string) {
  const cancellation = await CancelledLead.findById(id);
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }
  await BookedLead.findByIdAndUpdate(cancellation.booked_lead, { $unset: { cancelled: "" } });
  await clearCancellationFromLead(cancellation.lead_model as LeadModelName, cancellation.lead_ref?.toString());
  await cancellation.deleteOne();
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

async function resolveRequiredLocation(input: {
  pickup_zip: string;
  destination_zip: string;
  pickup_state?: string;
  delivery_state?: string;
}) {
  const [pickupStateFromZip, deliveryStateFromZip] = await Promise.all([
    getStateCodeForZip(input.pickup_zip),
    getStateCodeForZip(input.destination_zip),
  ]);
  const pickup_state = normalizeState(pickupStateFromZip ?? input.pickup_state);
  const delivery_state = normalizeState(deliveryStateFromZip ?? input.delivery_state);
  if (!pickup_state || !delivery_state) {
    throw new V1ServiceError("Could not derive pickup_state and delivery_state");
  }

  return { pickup_state, delivery_state };
}

async function resolveOptionalLocation(input: {
  pickup_zip?: string;
  delivery_zip?: string;
  pickup_state?: string;
  delivery_state?: string;
  local?: LocalType;
}) {
  const [pickupStateFromZip, deliveryStateFromZip] = await Promise.all([
    input.pickup_zip ? getStateCodeForZip(input.pickup_zip) : undefined,
    input.delivery_zip ? getStateCodeForZip(input.delivery_zip) : undefined,
  ]);
  const pickup_state = normalizeState(pickupStateFromZip ?? input.pickup_state);
  const delivery_state = normalizeState(deliveryStateFromZip ?? input.delivery_state);
  const local = pickup_state && delivery_state ? deriveLocal(pickup_state, delivery_state) : input.local;
  return { pickup_state, delivery_state, local };
}

function deriveLocal(pickupState: string, deliveryState: string): LocalType {
  return pickupState === deliveryState ? "local" : "long_distance";
}

function normalizeState(value?: string | null): string | undefined {
  return value?.trim().toUpperCase() || undefined;
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

async function getLinkedLead(leadModel: LeadModelName, leadId: string): Promise<any> {
  const lead =
    leadModel === "FormLead"
      ? await FormLead.findById(leadId)
      : await CallLead.findById(leadId);
  if (!lead) {
    throw new V1ServiceError("Linked source lead not found", 404);
  }

  return lead;
}

async function upsertCustomerFromLead(lead: { name?: string; phone_number?: string; email?: string }) {
  if (!lead.name?.trim() || !lead.phone_number?.trim()) {
    throw new V1ServiceError("Linked lead must have name and phone_number to create a customer");
  }

  const update = {
    full_name: lead.name.trim(),
    phone_number: lead.phone_number.trim(),
    ...(lead.email ? { email: lead.email.trim().toLowerCase() } : {}),
  };
  return Customer.findOneAndUpdate({ phone_number: update.phone_number }, update, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true,
  }).orFail();
}

async function mirrorBookingToLead(
  leadModel: LeadModelName,
  lead: any,
  bookingId: mongoose.Types.ObjectId,
  over2000: boolean,
  over4000: boolean,
  local: LocalType,
) {
  lead.booked = bookingId;
  lead.over_2000 = over2000;
  lead.over_4000 = over4000;
  lead.local = local;
  lead.cpl = getCplForSource(lead.source_company as SourceCompany, local);
  await lead.save();
  await syncSourceLead(lead, leadModel);
}

async function mirrorCancellationToLead(
  leadModel: LeadModelName,
  leadId: string,
  cancellationId: mongoose.Types.ObjectId,
) {
  const lead = await getLinkedLead(leadModel, leadId);
  lead.cancelled = cancellationId;
  await lead.save();
}

async function clearBookingFromLead(leadModel: LeadModelName, leadId: string) {
  const lead = await getLinkedLead(leadModel, leadId);
  lead.booked = undefined;
  lead.cancelled = undefined;
  lead.over_2000 = false;
  lead.over_4000 = false;
  await lead.save();
  await syncSourceLead(lead, leadModel);
}

async function clearCancellationFromLead(leadModel: LeadModelName, leadId?: string) {
  if (!leadId) {
    return;
  }
  const lead = await getLinkedLead(leadModel, leadId);
  lead.cancelled = undefined;
  await lead.save();
  await syncSourceLead(lead, leadModel);
}

async function syncBookingAndSource(
  bookingId: mongoose.Types.ObjectId,
  leadModel: LeadModelName,
  leadId: string,
) {
  const booking = await BookedLead.findById(bookingId).populate("customer").orFail();
  await syncAndStore(booking as unknown as AnyDoc, syncBookedLeadToSheets);
  const lead = await getLinkedLead(leadModel, leadId);
  await syncSourceLead(lead, leadModel);
}

async function syncSourceLead(lead: AnyDoc, leadModel: LeadModelName) {
  if (leadModel === "CallLead") {
    await lead.populate({ path: "booked", populate: { path: "customer" } });
    await syncAndStore(lead, syncCallLeadToSheets);
    return;
  }

  await syncAndStore(lead, syncFormLeadToSheets);
}

async function syncAndStore(
  document: AnyDoc,
  syncFn: (doc: any) => Promise<ReturnType<typeof mergeSheetSyncEntries>>,
) {
  const updates = await syncFn(document);
  document.set("sheet_sync", mergeSheetSyncEntries(document.get("sheet_sync"), updates));
  await document.save();
}
