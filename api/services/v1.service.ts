import mongoose from "mongoose";
import {
  getCplForSource,
  resolveSourceCompanyFromLabel,
  resolveSourceCompany,
  type LeadModelName,
  type LocalType,
  type SourceCompany,
} from "../config/domain";
import { Agent } from "../models/Agent";
import { BookedLead, type BookedLeadDocument } from "../models/BookedLead";
import { CallLead } from "../models/CallLead";
import { CancelledLead } from "../models/CancelledLead";
import { Customer } from "../models/Customer";
import { logger } from "../logger";
import type {
  CreateBookedLeadFromSourceInput,
  CreateBookedLeadInput,
  CreateCancelledLeadInput,
  CreateCustomerInput,
  UpdateBookedLeadInput,
  UpdateCancelledLeadInput,
  UpdateCustomerInput,
} from "../validation/v1.validation";
import { normalizePhoneNumberForMatch } from "../utils/phone";
import {
  deleteBookedLeadFromSheets,
  deleteCancelledLeadFromSheets,
} from "./googleSheets.service";
import {
  scheduleFullSheetSyncProcess,
  syncBookingAndSource,
  syncSourceLead,
  syncSourceLeadById,
  type FullSheetSyncJob,
} from "./sheetSync";
import {
  findBestCallLeadMatchByPhone,
  getLinkedLead,
  hasFormFillForCallLead,
  parseSourceCompany,
  resolveSourceLeadById,
  type SourceLeadDocument,
} from "./leads";

// --- Compatibility re-exports -------------------------------------------------
//
// Route layers and other services historically imported these symbols from
// `api/services/v1.service.ts`. As the refactor moves implementations into
// dedicated folders, this facade keeps the original import paths working.

export { V1ServiceError } from "./v1ServiceError";

export {
  scheduleBookingChainSheetSync,
  scheduleCallLeadSheetSync,
} from "./sheetSync";

export {
  createCallLead,
  createFormLead,
  deleteCallLead,
  deleteFormLead,
  findAllCallLeads,
  findAllFormLeads,
  findFormLead,
  updateCallLead,
  updateFormLead,
} from "./leads";

// Local imports of the V1ServiceError class for use inside this file. Re-export
// above keeps it visible at the public facade path.
import { V1ServiceError } from "./v1ServiceError";

// -----------------------------------------------------------------------------
// Booking, cancellation, customer, agent allocation, and mirror behavior below
// still lives here. They will be extracted in refactor plans 04 and 05.

type AgentAllocationInput = CreateBookedLeadInput["agent_allocations"][number];
type AgentAllocationDocumentInput = {
  agent: mongoose.Types.ObjectId;
  agent_name_snapshot: string;
  binder_amount: number;
};
type CreateBookedLeadServiceInput = Omit<CreateBookedLeadInput, "job_no"> & {
  job_no?: string;
};

export async function createBookedLead(input: CreateBookedLeadServiceInput) {
  const lead = await getLinkedLead(input.lead_model, input.lead_ref);
  const sourceCompanyForLead = getFormLeadSourceCompanyForBooking(lead, input);
  const local = optionalValue(input.local ?? lead.local);
  if (!local && input.lead_model !== "CallLead") {
    throw new V1ServiceError("Booking requires local or a linked lead with local classification");
  }
  const customer = await upsertCustomerFromLead(lead);
  const over_2000 = input.deposit_amount > 2000;
  const over_4000 = input.deposit_amount > 4000;
  const agent_allocations = await resolveAgentAllocations(input.agent_allocations);
  const total_binder_amount = resolveTotalBinderAmount(
    agent_allocations,
    input.total_binder_amount,
  );
  const warnings = buildBookedLeadWarnings(agent_allocations);
  const existingBooking = await BookedLead.findOne({
    lead_ref: input.lead_ref,
    lead_model: input.lead_model,
  });

  if (existingBooking) {
    if (input.submission_id && existingBooking.submission_id === input.submission_id) {
      return {
        booking: await populateBookedLead(existingBooking._id),
        message: "Duplicate booked lead submission ignored; existing booking returned.",
        warnings,
        total_binder_amount: existingBooking.total_binder_amount,
      };
    }

    Object.assign(existingBooking, {
      ...input,
      agent_allocations,
      total_binder_amount,
      ...(customer ? { customer: customer._id } : {}),
      local,
      over_2000,
      over_4000,
    });
    await existingBooking.save();
    await mirrorBookingToLead(
      lead,
      existingBooking._id,
      over_2000,
      over_4000,
      local,
      sourceCompanyForLead,
    );
    scheduleFullSheetSyncProcess({
      resource: "booking_chain",
      operation: "booked_lead.upsert",
      bookingId: existingBooking._id.toString(),
    });
    return {
      booking: await populateBookedLead(existingBooking._id),
      message: "Booked lead already existed and was upserted.",
      warnings,
      total_binder_amount,
    };
  }

  const booking = await BookedLead.create({
    ...input,
    agent_allocations,
    total_binder_amount,
    timestamp: input.timestamp ?? new Date(),
    ...(customer ? { customer: customer._id } : {}),
    local,
    over_2000,
    over_4000,
  });

  await mirrorBookingToLead(lead, booking._id, over_2000, over_4000, local, sourceCompanyForLead);
  scheduleFullSheetSyncProcess({
    resource: "booking_chain",
    operation: "booked_lead.create",
    bookingId: booking._id.toString(),
  });
  return {
    booking: await populateBookedLead(booking._id),
    message: "Booked lead created.",
    warnings,
    total_binder_amount,
  };
}

export async function createBookedLeadFromSource(input: CreateBookedLeadFromSourceInput) {
  const { lead, leadModel, jobNo } = await resolveBookingSourceLead(input);
  const effectiveSourceCompany = effectiveBookingSourceCompany(input.source_company, lead);
  if (input.source_company?.trim()) {
    lead.source_company = effectiveSourceCompany;
    await lead.save();
  }

  return createBookedLead({
    timestamp: input.timestamp,
    book_date: input.book_date,
    job_no: jobNo,
    lead_ref: lead._id.toString(),
    lead_model: leadModel,
    agent_allocations: deriveBookedLeadAgentAllocations(input),
    total_binder_amount: input.binder_amount,
    deposit_amount: input.deposit_amount,
    merchant: input.merchant,
    source: effectiveSourceCompany,
    local: lead.local as LocalType | undefined,
    submission_id: input.submission_id,
  });
}

export async function updateBookedLead(id: string, input: UpdateBookedLeadInput) {
  const booking = await BookedLead.findById(id);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }

  const { agent_allocations, agent_allocation_mode, total_binder_amount, ...bookingInput } = input;
  Object.assign(booking, bookingInput);
  if (input.deposit_amount !== undefined) {
    booking.over_2000 = input.deposit_amount > 2000;
    booking.over_4000 = input.deposit_amount > 4000;
  }
  const warnings: string[] = [];
  if (agent_allocations) {
    const resolvedAllocations = await resolveAgentAllocations(agent_allocations);
    const nextAllocations =
      agent_allocation_mode === "replace"
        ? resolvedAllocations
        : patchAgentAllocations(booking.agent_allocations ?? [], resolvedAllocations);
    booking.set("agent_allocations", nextAllocations);
    warnings.push(...buildBookedLeadWarnings(resolvedAllocations));
  }
  if (agent_allocations || total_binder_amount !== undefined) {
    booking.total_binder_amount = resolveTotalBinderAmount(
      booking.agent_allocations ?? [],
      total_binder_amount,
    );
  }

  const lead = await getLinkedLead(booking.lead_model as LeadModelName, booking.lead_ref.toString());
  booking.local = input.local ?? booking.local ?? lead.local;
  await booking.save();
  await mirrorBookingToLead(
    lead,
    booking._id,
    booking.over_2000,
    booking.over_4000,
    booking.local as LocalType | undefined,
  );
  scheduleFullSheetSyncProcess({
    resource: "booking_chain",
    operation: "booked_lead.update",
    bookingId: booking._id.toString(),
  });
  return {
    booking: await populateBookedLead(booking._id),
    message: "Booked lead updated.",
    warnings,
    total_binder_amount: booking.total_binder_amount,
  };
}

export async function createCancelledLead(input: CreateCancelledLeadInput) {
  const booking = await resolveBookedLeadForCancellation(input);

  const customer = booking.customer as { _id?: mongoose.Types.ObjectId; full_name?: string } | undefined;
  const timestamp = input.timestamp ?? new Date();
  const cancellation = await CancelledLead.create({
    timestamp,
    booked_lead: booking._id,
    customer: customer?._id ?? booking.customer,
    lead_ref: booking.lead_ref,
    lead_model: booking.lead_model,
    cancel_date: input.cancel_date ?? timestamp,
    agent: primaryAgentName(booking),
    book_date: booking.book_date,
    job_no: booking.job_no,
    customer_name: customer?.full_name,
    refund_amount: input.refund_amount,
    merchant: booking.merchant,
    source: booking.source,
    reason: input.reason,
    notes: input.notes,
    cancelled_by: input.cancelled_by,
  });

  booking.cancelled = cancellation._id;
  await booking.save();
  await mirrorCancellationToLead(booking.lead_model as LeadModelName, booking.lead_ref.toString(), cancellation._id);
  scheduleFullSheetSyncProcess({
    resource: "cancellation_chain",
    operation: "cancelled_lead.create",
    cancellationId: cancellation._id.toString(),
  });
  return cancellation;
}

async function resolveBookedLeadForCancellation(
  input: CreateCancelledLeadInput,
): Promise<mongoose.HydratedDocument<BookedLeadDocument>> {
  if (input.booked_lead && !input.lead_id) {
    return getBookedLeadForCancellation(input.booked_lead);
  }

  if (!input.lead_id) {
    throw new V1ServiceError("Either booked_lead or lead_id must be provided", 400);
  }

  const { lead, leadModel } = await resolveSourceLeadById(input.lead_id);
  if (!lead.booked) {
    throw new V1ServiceError("Source lead is not booked", 409);
  }

  const booking = await getBookedLeadForCancellation(lead.booked.toString());
  if (input.booked_lead && !booking._id.equals(input.booked_lead)) {
    throw new V1ServiceError("booked_lead does not match the source lead booking", 409);
  }
  if (booking.lead_model !== leadModel || booking.lead_ref.toString() !== lead._id.toString()) {
    throw new V1ServiceError("Booked lead does not match the source lead", 409);
  }

  return booking;
}

async function getBookedLeadForCancellation(
  bookedLeadId: string,
): Promise<mongoose.HydratedDocument<BookedLeadDocument>> {
  const booking = await BookedLead.findById(bookedLeadId).populate("customer");
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  if (booking.cancelled) {
    throw new V1ServiceError("Booked lead is already cancelled", 409);
  }

  return booking;
}

export async function updateCancelledLead(id: string, input: UpdateCancelledLeadInput) {
  const cancellation = await CancelledLead.findByIdAndUpdate(id, input, {
    returnDocument: "after",
  });
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }

  scheduleFullSheetSyncProcess({
    resource: "cancellation_chain",
    operation: "cancelled_lead.update",
    cancellationId: cancellation._id.toString(),
  });
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

export async function findAllBookedLeads() {
  return BookedLead.find()
    .populate("customer")
    .populate("agent_allocations.agent")
    .sort({ createdAt: -1 })
    .limit(200);
}

export async function findAllCancelledLeads() {
  return CancelledLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function findAllCustomers() {
  return Customer.find().sort({ createdAt: -1 }).limit(200);
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
  await deleteBookedLeadFromSheets(booking);
  await booking.deleteOne();
}

export async function deleteCancelledLead(id: string) {
  const cancellation = await CancelledLead.findById(id);
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }
  await deleteCancelledLeadFromSheets(cancellation);
  const booking = await BookedLead.findByIdAndUpdate(
    cancellation.booked_lead,
    { $unset: { cancelled: "" } },
    { returnDocument: "after" },
  );
  await clearCancellationFromLead(
    cancellation.lead_model as LeadModelName,
    cancellation.lead_ref?.toString(),
    false,
  );
  if (booking) {
    await syncBookingAndSource(
      booking._id,
      booking.lead_model as LeadModelName,
      booking.lead_ref.toString(),
    );
  } else if (cancellation.lead_ref) {
    await syncSourceLeadById(
      cancellation.lead_model as LeadModelName,
      cancellation.lead_ref.toString(),
    );
  }
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

async function resolveBookingSourceLead(
  input: CreateBookedLeadFromSourceInput,
): Promise<{ lead: SourceLeadDocument; leadModel: LeadModelName; jobNo?: string }> {
  if (input.lead_type === "FormLead") {
    const lead = await getLinkedLead("FormLead", input.form_lead_id);
    return { lead, leadModel: "FormLead", jobNo: input.job_no };
  }

  const jobNo = input.call_job_no?.trim() || undefined;
  const submittedPhone = input.call_phone_number?.trim();
  const normalizedPhone = normalizePhoneNumberForMatch(submittedPhone);

  const leads = jobNo
    ? await CallLead.find({ job_no: jobNo })
        .sort({ createdAt: -1 })
        .limit(5)
    : [];

  if (leads.length > 1) {
    throw new V1ServiceError(
      `Multiple call leads matched job_no ${jobNo}: ${leads
        .map((lead) => lead._id.toString())
        .join(", ")}`,
      409,
    );
  }

  if (leads.length === 1) {
    const lead = leads[0];
    if (submittedPhone) {
      lead.phone_number = submittedPhone;
      await lead.save();
    }
    return { lead, leadModel: "CallLead", jobNo };
  }

  const source_company = input.source_company?.trim()
    ? parseSourceCompany(input.source_company)
    : "not_provided";

  const phoneMatchedLead = normalizedPhone
    ? await findBestCallLeadMatchByPhone(normalizedPhone)
    : undefined;
  if (phoneMatchedLead) {
    if (jobNo) {
      phoneMatchedLead.job_no = jobNo;
    }
    if (submittedPhone) {
      phoneMatchedLead.phone_number = submittedPhone;
    }
    await phoneMatchedLead.save();
    return { lead: phoneMatchedLead, leadModel: "CallLead", jobNo };
  }

  const form_fill = await hasFormFillForCallLead(source_company, submittedPhone);
  const lead = await CallLead.create({
    ...(jobNo ? { job_no: jobNo } : {}),
    ...(submittedPhone ? { phone_number: submittedPhone } : {}),
    source_company,
    form_fill,
    created_on_unmatched: true,
    timestamp: input.timestamp ?? new Date(),
    cpl: getCplForSource(source_company, undefined),
  });

  return { lead, leadModel: "CallLead", jobNo };
}

function effectiveBookingSourceCompany(
  sourceCompanyOverride: string | undefined,
  lead: SourceLeadDocument,
): SourceCompany {
  const sourceCompanyOverrideText = sourceCompanyOverride?.trim();
  if (sourceCompanyOverrideText) {
    const sourceCompanyFromLabel = resolveSourceCompanyFromLabel(sourceCompanyOverrideText);
    return sourceCompanyFromLabel ?? parseSourceCompany(sourceCompanyOverrideText);
  }

  return parseSourceCompany(String(lead.source_company ?? ""));
}

function getFormLeadSourceCompanyForBooking(
  lead: SourceLeadDocument,
  input: Pick<CreateBookedLeadInput, "lead_model" | "source">,
): SourceCompany | undefined {
  if (input.lead_model !== "FormLead") {
    return undefined;
  }

  const mappedSourceCompany = resolveSourceCompany(input.source);
  if (!mappedSourceCompany || lead.source_company === mappedSourceCompany) {
    return undefined;
  }

  return mappedSourceCompany;
}

function deriveBookedLeadAgentAllocations(
  input: Pick<CreateBookedLeadFromSourceInput, "agent" | "split_agent" | "binder_amount">,
): AgentAllocationInput[] {
  const agent = input.agent.trim().replace(/\s+/g, " ");
  const splitAgent = input.split_agent?.trim().replace(/\s+/g, " ") || undefined;
  if (splitAgent && normalizeAgentName(agent) === normalizeAgentName(splitAgent)) {
    throw new V1ServiceError("split_agent must be different from agent", 400);
  }

  if (!splitAgent) {
    return [{ agent_name: agent, binder_amount: input.binder_amount }];
  }

  const halfBinderAmount = input.binder_amount / 2;
  return [
    { agent_name: agent, binder_amount: halfBinderAmount },
    { agent_name: splitAgent, binder_amount: halfBinderAmount },
  ];
}

async function resolveAgentAllocations(
  allocations: AgentAllocationInput[],
): Promise<AgentAllocationDocumentInput[]> {
  const normalizedNames = new Set<string>();
  const resolved: AgentAllocationDocumentInput[] = [];

  for (const allocation of allocations) {
    const name = allocation.agent_name.trim().replace(/\s+/g, " ");
    const normalizedName = normalizeAgentName(name);
    if (normalizedNames.has(normalizedName)) {
      throw new V1ServiceError(`Duplicate agent allocation for "${name}"`, 400);
    }
    normalizedNames.add(normalizedName);

    const agent = await upsertAgentByName(name);
    resolved.push({
      agent: agent._id,
      agent_name_snapshot: agent.name,
      binder_amount: allocation.binder_amount,
    });
  }

  return resolved;
}

async function upsertAgentByName(name: string) {
  const normalized_name = normalizeAgentName(name);
  const update = {
    $set: { name },
    $setOnInsert: {
      normalized_name,
      active: true,
      role: "agent",
      created_from: "booked_lead",
    },
  };

  try {
    return await Agent.findOneAndUpdate({ normalized_name }, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    }).orFail();
  } catch (error) {
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }
    const agent = await Agent.findOne({ normalized_name });
    if (!agent) {
      throw error;
    }
    return agent;
  }
}

function patchAgentAllocations(
  existingAllocations: AgentAllocationDocumentInput[],
  incomingAllocations: AgentAllocationDocumentInput[],
): AgentAllocationDocumentInput[] {
  const byAgentId = new Map(
    existingAllocations.map((allocation) => [allocation.agent.toString(), allocation]),
  );

  for (const allocation of incomingAllocations) {
    byAgentId.set(allocation.agent.toString(), allocation);
  }

  return [...byAgentId.values()];
}

function resolveTotalBinderAmount(
  allocations: Pick<AgentAllocationDocumentInput, "binder_amount">[],
  submittedTotal?: number,
): number {
  const allocationTotal = allocations.reduce(
    (sum, allocation) => sum + allocation.binder_amount,
    0,
  );
  if (submittedTotal !== undefined && Math.abs(allocationTotal - submittedTotal) >= 0.001) {
    throw new V1ServiceError("total_binder_amount must equal the sum of agent binder amounts", 400);
  }

  return submittedTotal ?? allocationTotal;
}

function buildBookedLeadWarnings(
  allocations: Pick<AgentAllocationDocumentInput, "agent_name_snapshot" | "binder_amount">[],
): string[] {
  return allocations
    .filter((allocation) => allocation.binder_amount === 0)
    .map((allocation) => `${allocation.agent_name_snapshot} has a zero binder amount`);
}

function primaryAgentName(booking: Pick<BookedLeadDocument, "agent_allocations">): string {
  return booking.agent_allocations?.[0]?.agent_name_snapshot ?? "";
}

function normalizeAgentName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function populateBookedLead(id: mongoose.Types.ObjectId) {
  return BookedLead.findById(id).populate("customer").populate("agent_allocations.agent").orFail();
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

function sameObjectId(
  left: mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId } | string | null | undefined,
  right: mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId } | string | null | undefined,
): boolean {
  return objectIdToString(left) === objectIdToString(right);
}

function objectIdToString(
  value: mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId } | string | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }
  return value._id?.toString();
}

async function upsertCustomerFromLead(lead: {
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
}) {
  if (!lead.name?.trim() || !lead.phone_number?.trim()) {
    return undefined;
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

export async function refreshAttachedBookingFromLead(
  lead: SourceLeadDocument,
  leadModel: LeadModelName,
  operation: string,
): Promise<FullSheetSyncJob> {
  const sourceLeadJob: FullSheetSyncJob = {
    resource: "source_lead",
    operation,
    leadModel,
    leadId: lead._id.toString(),
  };
  if (!lead.booked) {
    return sourceLeadJob;
  }

  const bookingId = lead.booked.toString();
  const booking = await BookedLead.findById(bookingId);
  if (!booking) {
    logger.warn({
      msg: "source_lead.update.booking_missing",
      operation,
      leadModel,
      leadId: lead._id.toString(),
      bookingId,
    });
    return sourceLeadJob;
  }

  if (booking.lead_model !== leadModel || booking.lead_ref.toString() !== lead._id.toString()) {
    logger.warn({
      msg: "source_lead.update.booking_mismatch",
      operation,
      leadModel,
      leadId: lead._id.toString(),
      bookingId,
      bookingLeadModel: booking.lead_model,
      bookingLeadId: booking.lead_ref.toString(),
    });
    return sourceLeadJob;
  }

  let changed = false;
  const customer = await upsertCustomerFromLead(lead);
  if (customer && !sameObjectId(booking.customer, customer._id)) {
    booking.customer = customer._id;
    changed = true;
  }
  if (lead.local && booking.local !== lead.local) {
    booking.local = lead.local;
    changed = true;
  }
  if (changed) {
    await booking.save();
  }

  return {
    resource: "booking_chain",
    operation,
    bookingId: booking._id.toString(),
  };
}

async function mirrorBookingToLead(
  lead: SourceLeadDocument,
  bookingId: mongoose.Types.ObjectId,
  over2000: boolean,
  over4000: boolean,
  local: LocalType | undefined,
  sourceCompany?: SourceCompany,
) {
  lead.booked = bookingId;
  lead.over_2000 = over2000;
  lead.over_4000 = over4000;
  if (sourceCompany) {
    lead.source_company = sourceCompany;
  }
  if (local) {
    lead.local = local;
  }
  lead.cpl = getCplForSource(lead.source_company as SourceCompany, local);
  await lead.save();
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

async function clearCancellationFromLead(
  leadModel: LeadModelName,
  leadId?: string,
  syncAfterClear = true,
) {
  if (!leadId) {
    return;
  }
  const lead = await getLinkedLead(leadModel, leadId);
  lead.cancelled = undefined;
  await lead.save();
  if (syncAfterClear) {
    await syncSourceLead(lead, leadModel);
  }
}
