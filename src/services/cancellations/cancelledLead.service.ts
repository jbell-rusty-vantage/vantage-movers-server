import type mongoose from "mongoose";
import type { ClientSession } from "mongoose";
import { getSheetSyncMode, type LeadModelName } from "../../config/domain";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { CancelledLead } from "../../models/CancelledLead";
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
