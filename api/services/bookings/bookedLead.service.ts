import type mongoose from "mongoose";
import {
  getSheetSyncMode,
  resolveSourceCompany,
  type LeadModelName,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { toFloridaTimestamp } from "../../utils/easternTime";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import type {
  CreateBookedLeadInput,
  UpdateBookedLeadInput,
} from "../../validation/v1.validation";
import {
  deleteBookedLeadFromSheets,
  deleteCancelledLeadFromSheets,
} from "../googleSheets.service";
import {
  patchAgentAllocations,
  resolveAgentAllocations,
  resolveTotalBinderAmount,
} from "../agents";
import {
  upsertCustomerFromBookingContact,
  upsertCustomerFromLead,
} from "../customers/customerFromLead.service";
import { resolveActiveMerchantName } from "../catalog";
import { getLinkedLead } from "../leads";
import {
  buildTombstonePreviousTargets,
  enqueueSheetSyncJob,
  enqueueSheetSyncTombstone,
  finalizeSheetSync,
  finalizeSheetSyncDelete,
  persistSheetSyncIntent,
  runSheetSyncWrite,
  type FullSheetSyncJob,
} from "../sheetSync";
import { V1ServiceError } from "../v1ServiceError";
import { recordOperationalEvent } from "../observability";
import {
  clearBookingFromLead,
  mirrorBookingToLead,
} from "./bookingMirror.service";
import { getFormLeadSourceCompanyForBooking } from "./bookingSourceResolver";
import { buildBookedLeadWarnings } from "./bookingWarnings";

/**
 * Internal create-input variant used by `createBookedLeadFromSource`, which
 * may not yet have a `job_no`.
 *
 * Routes still post the full schema (which requires `job_no`); only the
 * source-driven flow narrows it because call leads can be booked before a
 * job number is recorded.
 */
type CreateBookedLeadServiceInput = Omit<CreateBookedLeadInput, "job_no"> & {
  job_no?: string;
  customer_name?: string;
  customer_phone?: string;
};

export async function createBookedLead(input: CreateBookedLeadServiceInput) {
  const over_2000 = input.deposit_amount > 2000;
  const over_4000 = input.deposit_amount > 4000;
  // Agent allocations upsert reference `agents`; resolve them before the
  // transaction so reference-data writes stay out of the booking txn.
  const agent_allocations = await resolveAgentAllocations(input.agent_allocations);
  const merchant = await resolveActiveMerchantName(input.merchant);
  const total_binder_amount = resolveTotalBinderAmount(
    agent_allocations,
    input.total_binder_amount,
  );
  const warnings = buildBookedLeadWarnings(agent_allocations);
  const customerNameOverride = input.customer_name?.trim();
  const { customer_phone: _customerPhone, ...bookingInput } = input;
  const canonicalBookingInput = { ...bookingInput, merchant };

  const outcome = await runSheetSyncWrite(async (session) => {
    const lead = await getLinkedLead(input.lead_model, input.lead_ref, session);
    const sourceCompanyForLead = getFormLeadSourceCompanyForBooking(lead, input);
    const canonicalSource = resolveBookedLeadSource(
      sourceCompanyForLead,
      lead.source_company,
      input.source,
    );
    const local = optionalValue(input.local ?? lead.local);
    if (!local && input.lead_model !== "CallLead") {
      throw new V1ServiceError(
        "Booking requires local or a linked lead with local classification",
      );
    }
    const customer = customerNameOverride
      ? await upsertCustomerFromBookingContact(
          {
            customer_name: customerNameOverride,
            customer_phone: input.customer_phone,
            lead,
          },
          session,
        )
      : await upsertCustomerFromLead(lead, session);
    const existingBooking = await BookedLead.findOne({
      lead_ref: input.lead_ref,
      lead_model: input.lead_model,
    }).session(session ?? null);

    if (existingBooking) {
      if (input.submission_id && existingBooking.submission_id === input.submission_id) {
        return {
          kind: "duplicate" as const,
          bookingId: existingBooking._id,
          totalBinderAmount: existingBooking.total_binder_amount,
          sourceCompany: sourceCompanyForLead ?? null,
          job: undefined as FullSheetSyncJob | undefined,
        };
      }

      const existingBookingInput = { ...canonicalBookingInput };
      if (existingBookingInput.timestamp === undefined) {
        delete existingBookingInput.timestamp;
      }

      Object.assign(existingBooking, {
        ...existingBookingInput,
        source: canonicalSource,
        agent_allocations,
        total_binder_amount,
        ...(customer ? { customer: customer._id } : {}),
        ...(customerNameOverride ? { customer_name: customerNameOverride } : {}),
        local,
        over_2000,
        over_4000,
      });
      await existingBooking.save({ session });
      await mirrorBookingToLead(
        lead,
        existingBooking._id,
        over_2000,
        over_4000,
        local,
        sourceCompanyForLead,
        session,
      );
      const job: FullSheetSyncJob = {
        resource: "booking_chain",
        operation: "booked_lead.upsert",
        bookingId: existingBooking._id.toString(),
      };
      await persistSheetSyncIntent(job, session);
      return {
        kind: "upsert" as const,
        bookingId: existingBooking._id,
        totalBinderAmount: total_binder_amount,
        sourceCompany: sourceCompanyForLead ?? null,
        job,
      };
    }

    const booking = new BookedLead({
      ...canonicalBookingInput,
      source: canonicalSource,
      agent_allocations,
      total_binder_amount,
      timestamp: toFloridaTimestamp(input.timestamp ?? new Date()),
      ...(customer ? { customer: customer._id } : {}),
      ...(customerNameOverride ? { customer_name: customerNameOverride } : {}),
      local,
      over_2000,
      over_4000,
    });
    await booking.save({ session });
    await mirrorBookingToLead(
      lead,
      booking._id,
      over_2000,
      over_4000,
      local,
      sourceCompanyForLead,
      session,
    );
    const job: FullSheetSyncJob = {
      resource: "booking_chain",
      operation: "booked_lead.create",
      bookingId: booking._id.toString(),
    };
    await persistSheetSyncIntent(job, session);
    return {
      kind: "create" as const,
      bookingId: booking._id,
      totalBinderAmount: total_binder_amount,
      sourceCompany: sourceCompanyForLead ?? null,
      job,
    };
  });

  if (outcome.kind === "duplicate") {
    const booking = await populateBookedLead(outcome.bookingId);
    await recordOperationalEvent({
      level: "warn",
      eventKey: "booking.duplicate_submission_ignored",
      category: "booking",
      workflow: "booking_create",
      summary: "Duplicate booking submission ignored.",
      ...bookingEventContext(booking, outcome.sourceCompany),
      details: {
        submission_id: input.submission_id ?? null,
        job_no: booking.job_no ?? null,
        lead_ref: input.lead_ref,
        lead_model: input.lead_model,
      },
      notificationCandidate: false,
    });
    return {
      booking,
      message: "Duplicate booked lead submission ignored; existing booking returned.",
      warnings,
      total_binder_amount: outcome.totalBinderAmount,
    };
  }

  if (outcome.job) {
    await finalizeSheetSync(outcome.job);
  }

  const booking = await populateBookedLead(outcome.bookingId);
  const isCreate = outcome.kind === "create";
  await recordOperationalEvent({
    level: "info",
    eventKey: isCreate ? "booking.created" : "booking.upserted",
    category: "booking",
    workflow: "booking_create",
    summary: isCreate ? "Booking created." : "Existing booking upserted.",
    ...bookingEventContext(booking, outcome.sourceCompany),
    details: {
      job_no: booking.job_no ?? null,
      lead_model: input.lead_model,
      lead_ref: input.lead_ref,
      deposit_amount: input.deposit_amount,
      total_binder_amount: outcome.totalBinderAmount,
      merchant,
      local: booking.local ?? null,
      warnings,
      ...(isCreate ? {} : { previous_booking_id: outcome.bookingId.toString() }),
    },
  });

  return {
    booking,
    message:
      outcome.kind === "upsert"
        ? "Booked lead already existed and was upserted."
        : "Booked lead created.",
    warnings,
    total_binder_amount: outcome.totalBinderAmount,
  };
}

function resolveBookedLeadSource(
  sourceCompanyForLead: SourceCompany | undefined,
  leadSourceCompany: unknown,
  inputSource: string,
): SourceCompany | string {
  if (sourceCompanyForLead) {
    return sourceCompanyForLead;
  }

  const leadSource = resolveSourceCompany(String(leadSourceCompany ?? ""));
  if (leadSource && leadSource !== "not_provided") {
    return leadSource;
  }

  return resolveSourceCompany(inputSource) ?? inputSource;
}

/**
 * Builds owner-facing event context (lead identity + entity) from a populated
 * booking. Customer identity is read from the populated `customer` relation or
 * the booking's `customer_name` override.
 */
function bookingEventContext(
  booking: Awaited<ReturnType<typeof populateBookedLead>>,
  sourceCompany: string | null,
) {
  const customer = (booking as unknown as {
    customer?: { name?: string; phone_number?: string; email?: string } | null;
    customer_name?: string | null;
  }).customer;
  const customerName =
    customer?.name ??
    (booking as unknown as { customer_name?: string | null }).customer_name ??
    null;
  return {
    leadIdentity: {
      name: customerName,
      phone: customer?.phone_number ?? null,
      email: customer?.email ?? null,
    },
    sourceCompany,
    entity: { type: "booked_lead", id: booking._id.toString() },
  };
}

export async function updateBookedLead(id: string, input: UpdateBookedLeadInput) {
  const booking = await BookedLead.findById(id);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  if (booking.is_referral_booking) {
    throw new V1ServiceError("Referral booking edits are not supported yet", 409);
  }
  if (booking.is_leadless_booking) {
    throw new V1ServiceError("Leadless booking edits are not supported yet", 409);
  }
  if (!booking.lead_ref || !booking.lead_model) {
    throw new V1ServiceError("Booked lead is missing linked lead metadata", 409);
  }

  const { agent_allocations, agent_allocation_mode, total_binder_amount, ...bookingInput } = input;
  const canonicalBookingInput = { ...bookingInput };
  if (input.merchant !== undefined) {
    canonicalBookingInput.merchant = await resolveActiveMerchantName(input.merchant);
  }
  Object.assign(booking, canonicalBookingInput);
  if (input.deposit_amount !== undefined) {
    booking.over_2000 = input.deposit_amount > 2000;
    booking.over_4000 = input.deposit_amount > 4000;
  }
  const warnings: string[] = [];
  if (agent_allocations) {
    // Agent allocation upserts touch `agents`; resolve before the txn.
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

  const job = await runSheetSyncWrite(async (session) => {
    const lead = await getLinkedLead(
      booking.lead_model as LeadModelName,
      booking.lead_ref!.toString(),
      session,
    );
    booking.local = input.local ?? booking.local ?? lead.local;
    await booking.save({ session });
    await mirrorBookingToLead(
      lead,
      booking._id,
      booking.over_2000,
      booking.over_4000,
      booking.local as LocalType | undefined,
      undefined,
      session,
    );
    const bookingJob: FullSheetSyncJob = {
      resource: "booking_chain",
      operation: "booked_lead.update",
      bookingId: booking._id.toString(),
    };
    await persistSheetSyncIntent(bookingJob, session);
    return bookingJob;
  });

  await finalizeSheetSync(job);
  return {
    booking: await populateBookedLead(booking._id),
    message: "Booked lead updated.",
    warnings,
    total_binder_amount: booking.total_binder_amount,
  };
}

export async function findAllBookedLeads() {
  return BookedLead.find()
    .populate("customer")
    .populate("agent_allocations.agent")
    .sort({ createdAt: -1 })
    .limit(200);
}

export async function deleteBookedLead(id: string, cascade: boolean) {
  const booking = await BookedLead.findById(id);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  const hasLinkedLead = Boolean(booking.lead_ref && booking.lead_model);
  if (!hasLinkedLead && !booking.is_referral_booking && !booking.is_leadless_booking) {
    throw new V1ServiceError("Booked lead is missing linked lead metadata", 409);
  }
  if (booking.cancelled && !cascade) {
    throw new V1ServiceError("Booked lead has a cancellation; pass cascade=true to delete dependents", 409);
  }
  const leadModel = hasLinkedLead ? (booking.lead_model as LeadModelName) : undefined;
  const leadId = hasLinkedLead ? booking.lead_ref!.toString() : undefined;

  if (getSheetSyncMode() === "queued") {
    const bookingTargets = buildTombstonePreviousTargets(booking.sheet_sync);
    // Capture the cascaded cancellation (if any) before deletion so its rows
    // can be tombstoned in the same transaction.
    const cancellation =
      booking.cancelled && cascade ? await CancelledLead.findById(booking.cancelled) : null;
    const cancellationTargets = cancellation
      ? buildTombstonePreviousTargets(cancellation.sheet_sync)
      : [];

    await runSheetSyncWrite(async (session) => {
      if (cancellation) {
        await enqueueSheetSyncTombstone(
          {
            resource: "delete_cancelled_lead",
            entityModel: "CancelledLead",
            entityId: cancellation._id.toString(),
            operation: "delete_booked_lead",
            tombstone: {
              mongo_id: cancellation._id.toString(),
              previous_targets: cancellationTargets,
              linked_booking_id: id,
            },
          },
          { session, targetHints: cancellationTargets.map((target) => target.target) },
        );
        await cancellation.deleteOne({ session });
      }

      if (leadModel && leadId) {
        // Clear booking columns off the surviving lead and refresh its row.
        await clearBookingFromLead(leadModel, leadId, { session, syncAfterClear: false });
        await enqueueSheetSyncJob(
          {
            resource: "source_lead",
            operation: "delete_booked_lead",
            leadModel,
            leadId,
          },
          { session },
        );
      }

      await enqueueSheetSyncTombstone(
        {
          resource: "delete_booked_lead",
          entityModel: "BookedLead",
          entityId: id,
          operation: "delete_booked_lead",
          tombstone: {
            mongo_id: id,
            previous_targets: bookingTargets,
            linked_lead_id: leadId,
            linked_lead_model: leadModel,
          },
        },
        { session, targetHints: bookingTargets.map((target) => target.target) },
      );
      await booking.deleteOne({ session });
    });
    await finalizeSheetSyncDelete();
    return;
  }

  if (booking.cancelled && cascade) {
    const cancellation = await CancelledLead.findById(booking.cancelled);
    if (cancellation) {
      await deleteCancelledLeadFromSheets(cancellation);
      await cancellation.deleteOne();
    }
  }
  if (leadModel && leadId) {
    await clearBookingFromLead(leadModel, leadId);
  }
  await deleteBookedLeadFromSheets(booking);
  await booking.deleteOne();
}

/**
 * Loads a booked lead with the populated relations expected by route
 * responses. Throws via `orFail` to propagate the standard mongoose error
 * when the document disappears between writes.
 */
export async function populateBookedLead(id: mongoose.Types.ObjectId) {
  return BookedLead.findById(id).populate("customer").populate("agent_allocations.agent").orFail();
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}
