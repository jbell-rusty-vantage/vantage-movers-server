import type mongoose from "mongoose";
import type { ClientSession } from "mongoose";
import { getSheetSyncMode, type LeadModelName } from "../../config/domain";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead, type CancelledLeadDocument } from "../../models/CancelledLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import type {
  CreateCancelledLeadInput,
  UpdateCancelledLeadInput,
} from "../../validation/v1.validation";
import { primaryAgentName } from "../agents";
import { deleteCancelledLeadFromSheets } from "../googleSheets.service";
import {
  buildTombstonePreviousTargets,
  enqueueSheetSyncJob,
  enqueueSheetSyncTombstone,
  finalizeSheetSync,
  finalizeSheetSyncDelete,
  persistSheetSyncIntent,
  runSheetSyncWrite,
  syncBookingAndSource,
  syncSourceLeadById,
  type FullSheetSyncJob,
} from "../sheetSync";
import {
  CANCELLED_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
} from "../domainCommands/entityChange";
import { V1ServiceError } from "../v1ServiceError";
import { recordOperationalEvent } from "../observability";
import { getLinkedLead } from "../leads";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import {
  clearCancellationFromLead,
  mirrorCancellationToLead,
} from "./cancellationMirror.service";
import { resolveBookedLeadForCancellation } from "./cancellationResolver";

/**
 * Creates a cancellation against a resolved booked lead.
 *
 * Behavior preserved from `v1.service.ts`:
 *   - Resolves the booking via `resolveBookedLeadForCancellation` (which
 *     enforces the lead/booking match invariants).
 *   - Snapshots customer/job/agent/book-date/source fields off the
 *     populated booking so the cancellation record stays usable after the
 *     booking is mutated or deleted.
 *   - Sets `booking.cancelled = cancellation._id` and saves.
 *   - Mirrors `cancelled` onto the linked source lead.
 *   - Schedules a `cancellation_chain` sheet sync with the original
 *     operation tag `cancelled_lead.create`.
 */
export async function createCancelledLead(
  input: CreateCancelledLeadInput,
  options: { requiredSourceConnectionKey?: string } = {},
) {
  const timestamp = input.timestamp ?? new Date();

  const { cancellation, job, booking } = await runSheetSyncWrite((session) =>
    persistCancelledLeadCreateInTransaction(input, options, {
      session,
      now: timestamp,
    }),
    { forceTransaction: true },
  );

  await finalizeSheetSync(job);

  await recordOperationalEvent({
    level: "info",
    eventKey: "cancellation.created",
    category: "cancellation",
    workflow: "cancellation_create",
    summary: "Cancellation created.",
    leadIdentity: { name: cancellation.customer_name ?? null },
    sourceCompany: (booking.source as string | undefined) ?? null,
    entity: { type: "cancelled_lead", id: cancellation._id.toString() },
    details: {
      booking_id: booking._id.toString(),
      job_no: cancellation.job_no ?? null,
      reason: cancellation.reason ?? null,
      refund_amount: cancellation.refund_amount ?? null,
      cancelled_by: cancellation.cancelled_by ?? null,
      agent: cancellation.agent ?? null,
      merchant: cancellation.merchant ?? null,
    },
  });

  return cancellation;
}

export async function createCancelledLeadInTransaction(
  input: CreateCancelledLeadInput,
  options: { requiredSourceConnectionKey?: string } = {},
  tx: { session?: ClientSession; now: Date },
) {
  return persistCancelledLeadCreateInTransaction(input, options, tx);
}

/**
 * Deep transaction primitive for a lifecycle-verified deterministic Booking.
 * The caller owns policy/case/link revalidation, the canonical command,
 * Entity Changes, case resolution, and the outbox. This primitive owns only
 * the exact Booking claim plus official Cancellation/optional Lead mirrors.
 */
export async function createCancellationForVerifiedBookingInTransaction(input: {
  booking_before: Record<string, unknown> & {
    _id: mongoose.Types.ObjectId;
    domain_revision: number;
    normalized_job_no?: string;
    lead_ref?: mongoose.Types.ObjectId | null;
    lead_model?: "FormLead" | "CallLead" | null;
  };
  expected_domain_revision: number;
  normalized_job_no: string;
  cancellation_id: mongoose.Types.ObjectId;
  official_details: {
    cancel_date: string;
    refund_amount: number;
    reason?: string;
    notes?: string;
    cancelled_by?: string;
  };
  test_fail_after?: "booking" | "cancellation" | "lead";
}, tx: { session: ClientSession; now: Date }): Promise<{
  cancellation: mongoose.HydratedDocument<CancelledLeadDocument>;
  booking_after: Record<string, unknown>;
  lead_before: Record<string, unknown> | null;
  lead_after: Record<string, unknown> | null;
}> {
  const booking = input.booking_before;
  const claim = await BookedLead.collection.updateOne(
    {
      _id: booking._id,
      domain_revision: input.expected_domain_revision,
      normalized_job_no: input.normalized_job_no,
      $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
    },
    { $set: { cancelled: input.cancellation_id } },
    { session: tx.session },
  );
  if (claim.matchedCount !== 1) throw new Error("DOMAIN_REVISION_CONFLICT");
  if (input.test_fail_after === "booking") {
    throw new Error("UNIT27_INJECTED_FAILURE_AFTER_BOOKING");
  }

  const customer = booking.customer as
    | { _id?: mongoose.Types.ObjectId; full_name?: string }
    | mongoose.Types.ObjectId
    | undefined;
  const customerId = customer && typeof customer === "object" && "_id" in customer
    ? customer._id
    : customer;
  const customerName = customer && typeof customer === "object" && "full_name" in customer
    ? customer.full_name
    : booking.customer_name;
  const cancellation = new CancelledLead({
    _id: input.cancellation_id,
    timestamp: tx.now,
    booked_lead: booking._id,
    ...(customerId ? { customer: customerId } : {}),
    ...(booking.lead_ref ? { lead_ref: booking.lead_ref } : {}),
    ...(booking.lead_model ? { lead_model: booking.lead_model } : {}),
    cancel_date: new Date(`${input.official_details.cancel_date}T00:00:00.000Z`),
    refund_amount: input.official_details.refund_amount,
    ...(input.official_details.reason !== undefined ? { reason: input.official_details.reason } : {}),
    ...(input.official_details.notes !== undefined ? { notes: input.official_details.notes } : {}),
    ...(input.official_details.cancelled_by !== undefined
      ? { cancelled_by: input.official_details.cancelled_by }
      : {}),
    agent: primaryAgentName(booking as unknown as Parameters<typeof primaryAgentName>[0]),
    book_date: booking.book_date,
    job_no: booking.job_no,
    ...(customerName ? { customer_name: customerName } : {}),
    merchant: booking.merchant,
    source: booking.source,
  });
  await cancellation.save({ session: tx.session });
  if (input.test_fail_after === "cancellation") {
    throw new Error("UNIT27_INJECTED_FAILURE_AFTER_CANCELLATION");
  }

  let leadBefore: Record<string, unknown> | null = null;
  let leadAfter: Record<string, unknown> | null = null;
  if (booking.lead_ref && booking.lead_model) {
    const leadQuery = booking.lead_model === "FormLead"
      ? getFormLeadModel().findById(booking.lead_ref)
      : getCallLeadModel().findById(booking.lead_ref);
    leadBefore = await leadQuery.session(tx.session).lean().exec() as Record<string, unknown> | null;
    if (!leadBefore || String(leadBefore.booked ?? "") !== String(booking._id)) {
      throw new Error("GRANOT_IDENTITY_CONFLICT");
    }
    const leadFilter = {
      _id: booking.lead_ref,
      domain_revision: Number(leadBefore.domain_revision ?? 0),
      booked: booking._id,
    };
    const leadWrite = await (booking.lead_model === "FormLead"
      ? getFormLeadModel().collection.updateOne(
        leadFilter,
        { $set: { cancelled: input.cancellation_id } },
        { session: tx.session },
      )
      : getCallLeadModel().collection.updateOne(
        leadFilter,
        { $set: { cancelled: input.cancellation_id } },
        { session: tx.session },
      ));
    if (leadWrite.matchedCount !== 1) throw new Error("DOMAIN_REVISION_CONFLICT");
    if (input.test_fail_after === "lead") {
      throw new Error("UNIT27_INJECTED_FAILURE_AFTER_LEAD");
    }
    const leadAfterQuery = booking.lead_model === "FormLead"
      ? getFormLeadModel().findById(booking.lead_ref)
      : getCallLeadModel().findById(booking.lead_ref);
    leadAfter = await leadAfterQuery.session(tx.session).lean().exec() as Record<string, unknown> | null;
    if (!leadAfter) throw new Error("Updated Cancellation Lead could not be reloaded.");
  }

  const bookingAfter = await BookedLead.findById(booking._id).session(tx.session).lean().exec();
  if (!bookingAfter) throw new Error("Updated Cancellation Booking could not be reloaded.");
  return {
    cancellation,
    booking_after: bookingAfter as unknown as Record<string, unknown>,
    lead_before: leadBefore,
    lead_after: leadAfter,
  };
}

export async function persistCancelledLeadCreateInTransaction(
  input: CreateCancelledLeadInput,
  options: { requiredSourceConnectionKey?: string } = {},
  tx: { session?: ClientSession; now: Date },
) {
  const timestamp = input.timestamp ?? tx.now;
  const session = tx.session;
    const booking = await resolveBookedLeadForCancellation(input, session, {
      allowLeadless: input.ingestion_source === "best_relocation_sheet",
    });
    if (options.requiredSourceConnectionKey) {
      if (booking.lead_model && booking.lead_ref) {
        const lead = await getLinkedLead(
          booking.lead_model,
          booking.lead_ref.toString(),
          session,
        );
        requireBestRelocationImportSource(
          "best_relocation_sheet",
          String(lead.source_company),
        );
      } else {
        const ingestionExecution =
          await DomainCommandExecution.findOne({
            origin: "external_sheet_ingestion",
            command_name: "createLeadlessBooking",
            "provenance.source_connection_key":
              options.requiredSourceConnectionKey,
            entity_refs: {
              $elemMatch: {
                model: "BookedLead",
                id: booking._id.toString(),
              },
            },
          })
            .session(session ?? null)
            .select("_id")
            .lean()
            .exec();
        if (!ingestionExecution) {
          throw new V1ServiceError(
            "Best Relocation import capability cannot cancel this booking",
            400,
          );
        }
      }
    }
    const leadlessBooking = booking.is_leadless_booking === true;
    if (!leadlessBooking && (!booking.lead_ref || !booking.lead_model)) {
      throw new V1ServiceError("Referral booking cancellation is not supported yet", 409);
    }
    const customer = booking.customer as
      | { _id?: mongoose.Types.ObjectId; full_name?: string }
      | undefined;
    const created = new CancelledLead({
      timestamp,
      booked_lead: booking._id,
      customer: customer?._id ?? booking.customer,
      ...(booking.lead_ref ? { lead_ref: booking.lead_ref } : {}),
      ...(booking.lead_model ? { lead_model: booking.lead_model } : {}),
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
    await created.save({ session });

    booking.cancelled = created._id;
    await booking.save({ session });
    if (booking.lead_model && booking.lead_ref) {
      await mirrorCancellationToLead(
        booking.lead_model!,
        booking.lead_ref!.toString(),
        created._id,
        session,
      );
    }
    const reconciliationCase = await BookingLeadReconciliationCase.findOne({
      booking: booking._id,
      status: "pending",
    }).session(session ?? null);
    if (reconciliationCase) {
      reconciliationCase.status = "dismissed";
      reconciliationCase.resolution_history.push({
        action: "booking_cancelled",
        actor: input.cancelled_by ?? "unknown",
        notes: input.notes,
        occurred_at: new Date(),
      } as any);
      reconciliationCase.revision += 1;
      await reconciliationCase.save({ session });
    }
    const cancellationJob: FullSheetSyncJob = {
      resource: "cancellation_chain",
      operation: "cancelled_lead.create",
      cancellationId: created._id.toString(),
    };
    await persistSheetSyncIntent(cancellationJob, session);
    return { cancellation: created, job: cancellationJob, booking };
}

/**
 * Patches a cancellation document and schedules a `cancellation_chain`
 * sheet sync tagged `cancelled_lead.update`. Throws 404 when the id is
 * unknown, matching the original behavior.
 */
export async function updateCancelledLeadInTransaction(
  id: string,
  input: UpdateCancelledLeadInput,
  tx: { session?: ClientSession; now: Date },
) {
  const cancellation = await CancelledLead.findById(id).session(tx.session ?? null);
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }
  const before = cancellation.toObject() as Record<string, unknown>;
  Object.assign(cancellation, input);
  const fields = collectDocumentFieldChanges(
    before,
    cancellation.toObject() as Record<string, unknown>,
    CANCELLED_LEAD_CHANGE_PATHS,
  );
  if (fields.length === 0) {
    return {
      noop: true as const,
      cancellation,
      mutations: [],
      job: undefined,
    };
  }
  await cancellation.save({ session: tx.session });
  const cancellationJob: FullSheetSyncJob = {
    resource: "cancellation_chain",
    operation: "cancelled_lead.update",
    cancellationId: cancellation._id.toString(),
  };
  await persistSheetSyncIntent(cancellationJob, tx.session);
  return {
    noop: false as const,
    cancellation,
    mutations: [
      {
        entity: { model: "CancelledLead" as const, id },
        revision_before: Number(before.domain_revision ?? 0),
        fields,
      },
    ],
    job: cancellationJob,
  };
}

export async function updateCancelledLead(id: string, input: UpdateCancelledLeadInput) {
  const { cancellation, job } = await runSheetSyncWrite(async (session) => {
    const updated = await CancelledLead.findByIdAndUpdate(id, input, {
      returnDocument: "after",
      session,
    });
    if (!updated) {
      throw new V1ServiceError("Cancelled lead not found", 404);
    }
    const cancellationJob: FullSheetSyncJob = {
      resource: "cancellation_chain",
      operation: "cancelled_lead.update",
      cancellationId: updated._id.toString(),
    };
    await persistSheetSyncIntent(cancellationJob, session);
    return { cancellation: updated, job: cancellationJob };
  });

  await finalizeSheetSync(job);
  return cancellation;
}

export async function findAllCancelledLeads() {
  return CancelledLead.find().sort({ createdAt: -1 }).limit(200);
}

/**
 * Deletes a cancellation and unwinds the state it owned.
 *
 * Behavior preserved from `v1.service.ts`:
 *   - 404 when the cancellation does not exist.
 *   - Deletes the cancellation row from Google Sheets first so the sheet
 *     state matches the impending Mongo write.
 *   - Unsets `cancelled` from the associated booking (when one is still
 *     present) using `$unset`, which mirrors the original implementation.
 *   - Clears `cancelled` from the linked source lead with the
 *     `syncAfterClear: false` flag so we batch the sync below.
 *   - Triggers a booking-chain sync when the booking still exists,
 *     otherwise a source-lead sync when only the lead reference is known.
 *   - Removes the cancellation document last so the upstream wipes settle
 *     even if the final delete fails.
 */
export async function deleteCancelledLead(id: string) {
  const cancellation = await CancelledLead.findById(id);
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }
  const leadModel = cancellation.lead_model as LeadModelName;
  const leadId = cancellation.lead_ref?.toString();

  if (getSheetSyncMode() === "queued") {
    const previousTargets = buildTombstonePreviousTargets(cancellation.sheet_sync);
    await runSheetSyncWrite(async (session) => {
      const booking = await BookedLead.findByIdAndUpdate(
        cancellation.booked_lead,
        { $unset: { cancelled: "" } },
        { returnDocument: "after", session },
      );
      if (leadModel && leadId) {
        await clearCancellationFromLead(leadModel, leadId, false, session);
      }

      await enqueueSheetSyncTombstone(
        {
          resource: "delete_cancelled_lead",
          entityModel: "CancelledLead",
          entityId: id,
          operation: "delete_cancelled_lead",
          tombstone: {
            mongo_id: id,
            previous_targets: previousTargets,
            linked_booking_id: cancellation.booked_lead?.toString(),
            linked_lead_id: leadId,
            linked_lead_model: leadModel,
          },
        },
        { session, targetHints: previousTargets.map((target) => target.target) },
      );

      // Refresh the surviving booking + source rows (or just the source row)
      // so they no longer reflect a cancellation.
      if (booking && booking.lead_ref && booking.lead_model) {
        await enqueueSheetSyncJob(
          {
            resource: "booking_chain",
            operation: "delete_cancelled_lead",
            bookingId: booking._id.toString(),
          },
          { session },
        );
      } else if (leadModel && leadId) {
        await enqueueSheetSyncJob(
          { resource: "source_lead", operation: "delete_cancelled_lead", leadModel, leadId },
          { session },
        );
      }

      await cancellation.deleteOne({ session });
    });
    await finalizeSheetSyncDelete();
    return;
  }

  await deleteCancelledLeadFromSheets(cancellation);
  const booking = await BookedLead.findByIdAndUpdate(
    cancellation.booked_lead,
    { $unset: { cancelled: "" } },
    { returnDocument: "after" },
  );
  if (leadModel && leadId) {
    await clearCancellationFromLead(leadModel, leadId, false);
  }
  if (booking && booking.lead_ref && booking.lead_model) {
    await syncBookingAndSource(
      booking._id,
      booking.lead_model as LeadModelName,
      booking.lead_ref.toString(),
    );
  } else if (leadModel && leadId) {
    await syncSourceLeadById(leadModel, leadId);
  }
  await cancellation.deleteOne();
}

export async function deleteCancelledLeadInTransaction(
  id: string,
  tx: { session?: ClientSession; now: Date },
) {
  const cancellation = await CancelledLead.findById(id).session(tx.session ?? null);
  if (!cancellation) {
    throw new V1ServiceError("Cancelled lead not found", 404);
  }
  const leadModel = cancellation.lead_model as LeadModelName;
  const leadId = cancellation.lead_ref?.toString();
  const mutations: Array<{
    entity: { model: "FormLead" | "CallLead" | "BookedLead" | "CancelledLead"; id: string };
    revision_before: number;
    fields: Array<{ path: string; before?: unknown; after?: unknown }>;
    deleted?: boolean;
  }> = [
    {
      entity: { model: "CancelledLead", id },
      revision_before: Number(cancellation.domain_revision ?? 0),
      fields: [{ path: "$deleted" }],
      deleted: true,
    },
  ];
  const entity_refs: Array<{ model: string; id: string }> = [
    { model: "CancelledLead", id },
  ];
  const captured = cancellation.toObject();
  const booking = await BookedLead.findByIdAndUpdate(
    cancellation.booked_lead,
    { $unset: { cancelled: "" } },
    { returnDocument: "after", session: tx.session },
  );
  if (booking) {
    mutations.push({
      entity: { model: "BookedLead", id: booking._id.toString() },
      revision_before: Number(booking.domain_revision ?? 0),
      fields: [{ path: "cancelled" }],
    });
    entity_refs.push({ model: "BookedLead", id: booking._id.toString() });
  }
  if (leadModel && leadId) {
    const lead = await getLinkedLead(leadModel, leadId, tx.session);
    mutations.push({
      entity: { model: leadModel, id: leadId },
      revision_before: Number(lead.domain_revision ?? 0),
      fields: [{ path: "cancelled" }],
    });
    entity_refs.push({ model: leadModel, id: leadId });
    await clearCancellationFromLead(leadModel, leadId, false, tx.session);
  }
  if (getSheetSyncMode() === "queued") {
    const previousTargets = buildTombstonePreviousTargets(cancellation.sheet_sync);
    await enqueueSheetSyncTombstone(
      {
        resource: "delete_cancelled_lead",
        entityModel: "CancelledLead",
        entityId: id,
        operation: "delete_cancelled_lead",
        tombstone: {
          mongo_id: id,
          previous_targets: previousTargets,
          linked_booking_id: cancellation.booked_lead?.toString(),
          linked_lead_id: leadId,
          linked_lead_model: leadModel,
        },
      },
      {
        session: tx.session,
        targetHints: previousTargets.map((target) => target.target),
      },
    );
    if (booking && booking.lead_ref && booking.lead_model) {
      await enqueueSheetSyncJob(
        {
          resource: "booking_chain",
          operation: "delete_cancelled_lead",
          bookingId: booking._id.toString(),
        },
        { session: tx.session },
      );
    } else if (leadModel && leadId) {
      await enqueueSheetSyncJob(
        {
          resource: "source_lead",
          operation: "delete_cancelled_lead",
          leadModel,
          leadId,
        },
        { session: tx.session },
      );
    }
  }
  await cancellation.deleteOne({ session: tx.session });
  return {
    mutations,
    entity_refs,
    finalize: async () => {
      if (getSheetSyncMode() === "queued") {
        await finalizeSheetSyncDelete();
        return;
      }
      await deleteCancelledLeadFromSheets(captured as typeof cancellation);
      if (booking && booking.lead_ref && booking.lead_model) {
        await syncBookingAndSource(
          booking._id,
          booking.lead_model as LeadModelName,
          booking.lead_ref.toString(),
        );
      } else if (leadModel && leadId) {
        await syncSourceLeadById(leadModel, leadId);
      }
    },
  };
}
