import type mongoose from "mongoose";
import type { ClientSession } from "mongoose";
import {
  getCallLeadSourceCompanyLabel,
  getFormLeadSourceCompanyLabel,
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
  receiverAttributionFromPrimaryAllocation,
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
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
} from "../domainCommands/entityChange";
import { V1ServiceError } from "../v1ServiceError";
import { recordOperationalEvent } from "../observability";
import {
  clearBookingFromLead,
  mirrorBookingToLead,
} from "./bookingMirror.service";
import { getFormLeadSourceCompanyForBooking } from "./bookingSourceResolver";
import { buildBookedLeadWarnings } from "./bookingWarnings";
import {
  BEST_RELOCATION_INGESTION_SOURCE,
  requireBestRelocationImportSource,
} from "./bestRelocationImportGuard";

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
  allow_inactive_agents?: boolean;
  set_primary_agent_as_receiver?: boolean;
  receiver_agent_source_value?: string;
  ingestion_source?: typeof BEST_RELOCATION_INGESTION_SOURCE;
};

function assignPrimaryAgentAsReceiver(
  lead: object & { receiver_agent?: unknown },
  allocations: Awaited<ReturnType<typeof resolveAgentAllocations>>,
  input: CreateBookedLeadServiceInput,
): void {
  if (!input.set_primary_agent_as_receiver) return;
  const attribution = receiverAttributionFromPrimaryAllocation(
    allocations,
    input.receiver_agent_source_value ?? "Booked Deals:unknown-job",
    new Date(),
    lead.receiver_agent,
  );
  if (attribution) Object.assign(lead, attribution);
}

export async function createBookedLead(input: CreateBookedLeadServiceInput) {
  const over_2000 = input.deposit_amount > 2000;
  const over_4000 = input.deposit_amount > 4000;
  // Agent allocations upsert reference `agents`; resolve them before the
  // transaction so reference-data writes stay out of the booking txn.
  const agent_allocations = await resolveAgentAllocations(input.agent_allocations, {
    includeInactive: input.allow_inactive_agents,
  });
  const merchant = await resolveActiveMerchantName(input.merchant);
  const total_binder_amount = resolveTotalBinderAmount(
    agent_allocations,
    input.total_binder_amount,
  );
  const warnings = buildBookedLeadWarnings(agent_allocations);
  const customerNameOverride = input.customer_name?.trim();
  const {
    customer_phone: _customerPhone,
    allow_inactive_agents: _allowInactiveAgents,
    set_primary_agent_as_receiver: _setPrimaryAgentAsReceiver,
    receiver_agent_source_value: _receiverAgentSourceValue,
    ingestion_source: _ingestionSource,
    ...bookingInput
  } = input;
  const canonicalBookingInput = { ...bookingInput, merchant };

  const outcome = await runSheetSyncWrite((session) =>
    persistBookedLeadCreateInTransaction(input, {
      agent_allocations,
      merchant,
      total_binder_amount,
      warnings,
      customerNameOverride,
      canonicalBookingInput,
      over_2000,
      over_4000,
    }, { session, now: new Date() }),
  );

  return finalizeBookedLeadCreateAfterCommit(input, merchant, warnings, outcome);
}

export async function createBookedLeadInTransaction(
  input: CreateBookedLeadServiceInput,
  tx: { session?: ClientSession; now: Date },
) {
  const over_2000 = input.deposit_amount > 2000;
  const over_4000 = input.deposit_amount > 4000;
  const agent_allocations = await resolveAgentAllocations(input.agent_allocations, {
    includeInactive: input.allow_inactive_agents,
  });
  const merchant = await resolveActiveMerchantName(input.merchant);
  const total_binder_amount = resolveTotalBinderAmount(
    agent_allocations,
    input.total_binder_amount,
  );
  const warnings = buildBookedLeadWarnings(agent_allocations);
  const customerNameOverride = input.customer_name?.trim();
  const {
    customer_phone: _customerPhone,
    allow_inactive_agents: _allowInactiveAgents,
    set_primary_agent_as_receiver: _setPrimaryAgentAsReceiver,
    receiver_agent_source_value: _receiverAgentSourceValue,
    ingestion_source: _ingestionSource,
    ...bookingInput
  } = input;
  const canonicalBookingInput = { ...bookingInput, merchant };
  const outcome = await persistBookedLeadCreateInTransaction(
    input,
    {
      agent_allocations,
      merchant,
      total_binder_amount,
      warnings,
      customerNameOverride,
      canonicalBookingInput,
      over_2000,
      over_4000,
    },
    tx,
  );
  return { outcome, merchant, warnings };
}

export async function persistBookedLeadCreateInTransaction(
  input: CreateBookedLeadServiceInput,
  prepared: {
    agent_allocations: Awaited<ReturnType<typeof resolveAgentAllocations>>;
    merchant: string;
    total_binder_amount: number;
    warnings: string[];
    customerNameOverride: string | undefined;
    canonicalBookingInput: Record<string, unknown>;
    over_2000: boolean;
    over_4000: boolean;
  },
  tx: { session?: ClientSession; now: Date },
) {
  const session = tx.session;
  const {
    agent_allocations,
    merchant,
    total_binder_amount,
    warnings,
    customerNameOverride,
    canonicalBookingInput,
    over_2000,
    over_4000,
  } = prepared;
    const lead = await getLinkedLead(input.lead_model, input.lead_ref, session);
    const sourceCompanyForLead = getFormLeadSourceCompanyForBooking(lead, input);
    if (input.ingestion_source) {
      requireBestRelocationImportSource(
        input.ingestion_source,
        String(lead.source_company),
      );
    }
    const canonicalSource = resolveBookedLeadSource(
      sourceCompanyForLead,
      lead,
      input.lead_model,
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
          warnings,
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
      assignPrimaryAgentAsReceiver(lead, agent_allocations, input);
      await mirrorBookingToLead(
        lead,
        input.lead_model,
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
        warnings,
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
    assignPrimaryAgentAsReceiver(lead, agent_allocations, input);
    await mirrorBookingToLead(
      lead,
      input.lead_model,
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
      warnings,
      job,
    };
}

export async function finalizeBookedLeadCreateAfterCommit(
  input: CreateBookedLeadServiceInput,
  merchant: string,
  warnings: string[],
  outcome: Awaited<ReturnType<typeof persistBookedLeadCreateInTransaction>>,
) {
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
  lead: SourceDisplayLead,
  leadModel: LeadModelName,
  inputSource: string,
): SourceCompany | string {
  const inputSourceText = inputSource.trim();
  if (sourceCompanyForLead) {
    return inputSourceText || labelForSourceCompany(leadModel, sourceCompanyForLead);
  }

  const snapshotSource = sourceDisplayLabelFromLead(lead);
  if (snapshotSource) {
    return snapshotSource;
  }

  const leadSource = resolveSourceCompany(String(lead.source_company ?? ""));
  if (leadSource && leadSource !== "not_provided") {
    return labelForSourceCompany(leadModel, leadSource);
  }

  const inputSourceCompany = resolveSourceCompany(inputSource);
  return inputSourceCompany ? labelForSourceCompany(leadModel, inputSourceCompany) : inputSource;
}

type SourceDisplayLead = {
  source_company?: unknown;
  crm_source_label_snapshot?: unknown;
  source_granularity_label_snapshot?: unknown;
  source_company_label_snapshot?: unknown;
};

function sourceDisplayLabelFromLead(lead: SourceDisplayLead): string | undefined {
  return (
    stringValue(lead.crm_source_label_snapshot) ??
    stringValue(lead.source_granularity_label_snapshot) ??
    stringValue(lead.source_company_label_snapshot)
  );
}

function labelForSourceCompany(
  leadModel: LeadModelName,
  sourceCompany: SourceCompany,
): string {
  return leadModel === "CallLead"
    ? getCallLeadSourceCompanyLabel(sourceCompany)
    : getFormLeadSourceCompanyLabel(sourceCompany);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

export async function updateBookedLeadInTransaction(
  id: string,
  input: UpdateBookedLeadInput,
  tx: { session?: ClientSession; now: Date },
) {
  const booking = await BookedLead.findById(id).session(tx.session ?? null);
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
  const before = booking.toObject() as Record<string, unknown>;
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
  const leadModel = booking.lead_model as LeadModelName;
  const lead = await getLinkedLead(leadModel, booking.lead_ref!.toString(), tx.session);
  const leadBefore = lead.toObject() as Record<string, unknown>;
  booking.local = input.local ?? booking.local ?? lead.local;
  const after = booking.toObject() as Record<string, unknown>;
  const bookingFields = collectDocumentFieldChanges(
    before,
    after,
    BOOKED_LEAD_CHANGE_PATHS,
  );
  if (bookingFields.length === 0) {
    return {
      noop: true as const,
      result: {
        booking: await populateBookedLead(booking._id),
        message: "Booked lead updated.",
        warnings,
        total_binder_amount: booking.total_binder_amount,
      },
      warnings,
      mutations: [],
      job: undefined,
    };
  }
  await booking.save({ session: tx.session });
  await mirrorBookingToLead(
    lead,
    leadModel,
    booking._id,
    booking.over_2000,
    booking.over_4000,
    booking.local as LocalType | undefined,
    undefined,
    tx.session,
  );
  const job: FullSheetSyncJob = {
    resource: "booking_chain",
    operation: "booked_lead.update",
    bookingId: booking._id.toString(),
  };
  await persistSheetSyncIntent(job, tx.session);
  const leadFields = collectDocumentFieldChanges(
    leadBefore,
    lead.toObject() as Record<string, unknown>,
    leadModel === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS,
  );
  const mutations = [
    {
      entity: { model: "BookedLead" as const, id: id },
      revision_before: Number(before.domain_revision ?? 0),
      fields: bookingFields,
    },
    ...(leadFields.length > 0
      ? [
          {
            entity: { model: leadModel, id: booking.lead_ref!.toString() },
            revision_before: Number(leadBefore.domain_revision ?? 0),
            fields: leadFields,
          },
        ]
      : []),
  ];
  return {
    noop: false as const,
    result: {
      booking: await populateBookedLead(booking._id),
      message: "Booked lead updated.",
      warnings,
      total_binder_amount: booking.total_binder_amount,
    },
    warnings,
    mutations,
    job,
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
    const leadModel = booking.lead_model as LeadModelName;
    const lead = await getLinkedLead(
      leadModel,
      booking.lead_ref!.toString(),
      session,
    );
    booking.local = input.local ?? booking.local ?? lead.local;
    await booking.save({ session });
    await mirrorBookingToLead(
      lead,
      leadModel,
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
export async function deleteBookedLeadInTransaction(
  id: string,
  cascade: boolean,
  tx: { session?: ClientSession; now: Date },
) {
  const booking = await BookedLead.findById(id).session(tx.session ?? null);
  if (!booking) {
    throw new V1ServiceError("Booked lead not found", 404);
  }
  const hasLinkedLead = Boolean(booking.lead_ref && booking.lead_model);
  if (!hasLinkedLead && !booking.is_referral_booking && !booking.is_leadless_booking) {
    throw new V1ServiceError("Booked lead is missing linked lead metadata", 409);
  }
  if (booking.cancelled && !cascade) {
    throw new V1ServiceError(
      "Booked lead has a cancellation; pass cascade=true to delete dependents",
      409,
    );
  }
  const leadModel = hasLinkedLead ? (booking.lead_model as LeadModelName) : undefined;
  const leadId = hasLinkedLead ? booking.lead_ref!.toString() : undefined;
  const mutations: Array<{
    entity: { model: "FormLead" | "CallLead" | "BookedLead" | "CancelledLead"; id: string };
    revision_before: number;
    fields: Array<{ path: string; before?: unknown; after?: unknown }>;
    deleted?: boolean;
  }> = [];
  const entity_refs: Array<{ model: string; id: string }> = [
    { model: "BookedLead", id },
  ];
  const cancellation =
    booking.cancelled && cascade
      ? await CancelledLead.findById(booking.cancelled).session(tx.session ?? null)
      : null;
  const capturedCancellation = cancellation?.toObject();
  const capturedBooking = booking.toObject();
  if (cancellation) {
    if (getSheetSyncMode() === "queued") {
      const cancellationTargets = buildTombstonePreviousTargets(cancellation.sheet_sync);
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
        {
          session: tx.session,
          targetHints: cancellationTargets.map((target) => target.target),
        },
      );
    }
    mutations.push({
      entity: { model: "CancelledLead", id: cancellation._id.toString() },
      revision_before: Number(cancellation.domain_revision ?? 0),
      fields: [{ path: "$deleted" }],
      deleted: true,
    });
    entity_refs.push({ model: "CancelledLead", id: cancellation._id.toString() });
    await cancellation.deleteOne({ session: tx.session });
  }
  if (leadModel && leadId) {
    const lead = await getLinkedLead(leadModel, leadId, tx.session);
    const leadBefore = Number(lead.domain_revision ?? 0);
    await clearBookingFromLead(leadModel, leadId, {
      session: tx.session,
      syncAfterClear: false,
    });
    mutations.push({
      entity: { model: leadModel, id: leadId },
      revision_before: leadBefore,
      fields: [{ path: "booked" }],
    });
    entity_refs.push({ model: leadModel, id: leadId });
    if (getSheetSyncMode() === "queued") {
      await enqueueSheetSyncJob(
        {
          resource: "source_lead",
          operation: "delete_booked_lead",
          leadModel,
          leadId,
        },
        { session: tx.session },
      );
    }
  }
  if (getSheetSyncMode() === "queued") {
    const bookingTargets = buildTombstonePreviousTargets(booking.sheet_sync);
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
      {
        session: tx.session,
        targetHints: bookingTargets.map((target) => target.target),
      },
    );
  }
  mutations.push({
    entity: { model: "BookedLead", id },
    revision_before: Number(booking.domain_revision ?? 0),
    fields: [{ path: "$deleted" }],
    deleted: true,
  });
  await booking.deleteOne({ session: tx.session });
  return {
    mutations,
    entity_refs,
    finalize: async () => {
      if (getSheetSyncMode() === "queued") {
        await finalizeSheetSyncDelete();
        return;
      }
      if (capturedCancellation) {
        await deleteCancelledLeadFromSheets(
          capturedCancellation as Parameters<typeof deleteCancelledLeadFromSheets>[0],
        );
      }
      if (leadModel && leadId) {
        await clearBookingFromLead(leadModel, leadId);
      }
      await deleteBookedLeadFromSheets(capturedBooking as typeof booking);
    },
  };
}

export async function populateBookedLead(id: mongoose.Types.ObjectId) {
  return BookedLead.findById(id).populate("customer").populate("agent_allocations.agent").orFail();
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}
