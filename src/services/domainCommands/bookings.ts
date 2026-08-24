import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { Merchant } from "../../models/Merchant";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import { ConflictError, NotFoundError } from "../errors";
import { getLinkedLead } from "../leads";
import {
  resolveBookingLeadReconciliationInTransaction,
} from "../employeeBookings/bookingLeadReconciliation.service";
import { finalizeSheetSync } from "../sheetSync";
import { persistSheetSyncIntent } from "../sheetSync";
import { officialBookingAgentIds, officialBookingAllocations } from "../agents";
import { toObjectId } from "../../utils/objectId";
import type { GranotLifecycleOfficialBookingDetails } from "../../validation/v1/granotLifecycle.validation";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
} from "./entityChange";
import { executeCanonicalCommandWithPostCommit, executeIdempotentCanonicalCommand } from "./idempotency";
import {
  runExistingCreateBookingFromLead,
  runExistingCreateLeadlessBooking,
  runExistingCreateReferralBooking,
  runExistingDeleteBookedLead,
  runExistingUpdateBookedLead,
} from "./existingWrites";
import type {
  CanonicalCommandContext,
  CompatibilityCanonicalCommandResult,
  CanonicalCommandResult,
} from "./types";

export async function createBookingFromLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingCreateBookingFromLead(input)).command;
}

export async function createLeadlessBooking(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingCreateLeadlessBooking(input)).command;
}

export async function createExistingReferralBooking(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingCreateReferralBooking(input)).command;
}

export async function updateBookedLead(input: {
  booking_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingUpdateBookedLead(input)).command;
}

/** Exact lifecycle aggregate command. Reconciliation composes the same transaction
 * primitive with its case CAS so case resolution and aggregate evidence remain atomic. */
export async function updateBooking(input: {
  booking_id: string;
  expected_domain_revision: number;
  official_booking_details: GranotLifecycleOfficialBookingDetails;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  const changeId = new mongoose.Types.ObjectId();
  let mutated = false;
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: "updateBooking",
    context: input.context,
    operation: async ({ session, now, command_execution_id }) => {
      const before = await BookedLead.findOne({
        _id: toObjectId(input.booking_id),
        domain_revision: input.expected_domain_revision,
        $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
      }).session(session).lean().exec();
      if (!before) throw new Error("DOMAIN_REVISION_CONFLICT");
      const agentIds = officialBookingAgentIds(input.official_booking_details).map((id) => toObjectId(id));
      const [agents, merchant] = await Promise.all([
        Agent.find({ _id: { $in: agentIds }, active: true }).session(session).lean().exec(),
        Merchant.findOne({ _id: toObjectId(input.official_booking_details.merchant_id), active: true })
          .session(session).lean().exec(),
      ]);
      if (agents.length !== agentIds.length || !merchant) throw new Error("GRANOT_VALIDATION_FAILED");
      const names = new Map(agents.map((row) => [String(row._id), row.name]));
      const details = input.official_booking_details;
      const desired = {
        book_date: new Date(`${details.book_date}T00:00:00.000Z`),
        agent_allocations: officialBookingAllocations(details).map((row) => ({
          agent: toObjectId(row.agent_id),
          agent_name_snapshot: names.get(row.agent_id)!,
          binder_amount: Math.round(row.binder_amount * 100) / 100,
        })),
        total_binder_amount: Math.round(details.total_binder_amount * 100) / 100,
        deposit_amount: Math.round(details.deposit_amount * 100) / 100,
        merchant: merchant.name,
        over_2000: details.deposit_amount > 2000,
        over_4000: details.deposit_amount > 4000,
      };
      const write = await BookedLead.collection.updateOne(
        {
          _id: before._id,
          domain_revision: input.expected_domain_revision,
          normalized_job_no: before.normalized_job_no,
          $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
        },
        { $set: desired },
        { session },
      );
      if (write.matchedCount !== 1) throw new Error("DOMAIN_REVISION_CONFLICT");
      const after = await BookedLead.findById(before._id).session(session).lean().exec();
      if (!after) throw new Error("Updated Booking could not be reloaded.");
      const fields = collectDocumentFieldChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        BOOKED_LEAD_CHANGE_PATHS,
      );
      if (fields.length > 0) {
        mutated = true;
        await persistEntityChangeMutations({
          session,
          now,
          command_name: "updateBooking",
          command_execution_id,
          context: input.context,
          mutations: [{
            change_id: changeId,
            entity: { model: "BookedLead", id: input.booking_id },
            revision_before: before.domain_revision,
            fields,
          }],
        });
        await persistSheetSyncIntent({
          resource: "booking_chain",
          operation: "booked_lead.update",
          bookingId: input.booking_id,
        }, session);
      }
      return { entity_refs: [{ model: "BookedLead", id: input.booking_id }], warnings: [] };
    },
  });
  if (!outcome.replayed && mutated) {
    await finalizeSheetSync({
      resource: "booking_chain",
      operation: "booked_lead.update",
      bookingId: input.booking_id,
    });
  }
  return outcome.result;
}

export async function deleteBookedLead(input: {
  booking_id: string;
  cascade: boolean;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return runExistingDeleteBookedLead(input);
}

export async function attachBookingToLead(input: {
  booking_id: string;
  lead_model: "FormLead" | "CallLead";
  lead_id: string;
  expected_revision: number;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const changeIds = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];
  return executeCanonicalCommandWithPostCommit({
    command_name: "attachBookingToLead",
    context: input.context,
    operation: async ({ session, now, command_execution_id }) => {
      if (input.context.provenance.origin === "external_sheet_ingestion") {
        const lead = await getLinkedLead(input.lead_model, input.lead_id, session);
        requireBestRelocationImportSource(
          "best_relocation_sheet",
          String(lead.source_company),
        );
        const ownedBooking = await DomainCommandExecution.findOne({
          origin: "external_sheet_ingestion",
          command_name: "createLeadlessBooking",
          "provenance.source_connection_key":
            input.context.provenance.source_connection_key,
          entity_refs: {
            $elemMatch: {
              model: "BookedLead",
              id: input.booking_id,
            },
          },
        })
          .session(session)
          .select("_id")
          .lean()
          .exec();
        if (!ownedBooking) {
          throw new ConflictError(
            "Booking does not belong to this ingestion source",
          );
        }
      }
      const reconciliationCase = await BookingLeadReconciliationCase.findOne({
        booking: input.booking_id,
      })
        .session(session)
        .select("_id")
        .lean()
        .exec();
      if (!reconciliationCase) {
        throw new NotFoundError("Booking lead reconciliation case not found");
      }
      const bookingBefore = await BookedLead.findById(input.booking_id)
        .session(session ?? null)
        .lean();
      const leadBefore = (
        await getLinkedLead(input.lead_model, input.lead_id, session)
      ).toObject() as Record<string, unknown>;
      const jobs = await resolveBookingLeadReconciliationInTransaction(
        String(reconciliationCase._id),
        {
          action: "attach_existing",
          revision: input.expected_revision,
          lead_model: input.lead_model,
          lead_id: input.lead_id,
        },
        actorContext(input.context),
        { session, now },
      );
      const bookingAfter = await BookedLead.findById(input.booking_id)
        .session(session ?? null)
        .lean();
      const leadAfter = (
        await getLinkedLead(input.lead_model, input.lead_id, session)
      ).toObject() as Record<string, unknown>;
      const mutations = [
        {
          change_id: changeIds[0]!,
          entity: { model: "BookedLead" as const, id: input.booking_id },
          revision_before: Number(
            (bookingBefore as { domain_revision?: number } | null)?.domain_revision ?? 0,
          ),
          fields: collectDocumentFieldChanges(
            (bookingBefore as Record<string, unknown> | null) ?? null,
            (bookingAfter as Record<string, unknown> | null) ?? null,
            BOOKED_LEAD_CHANGE_PATHS,
          ),
        },
        {
          change_id: changeIds[1]!,
          entity: { model: input.lead_model, id: input.lead_id },
          revision_before: Number(
            (leadBefore as { domain_revision?: number }).domain_revision ?? 0,
          ),
          fields: collectDocumentFieldChanges(
            leadBefore,
            leadAfter,
            input.lead_model === "FormLead"
              ? FORM_LEAD_CHANGE_PATHS
              : CALL_LEAD_CHANGE_PATHS,
          ),
        },
      ].filter((mutation) => mutation.fields.length > 0);
      await persistEntityChangeMutations({
        session,
        now,
        command_name: "attachBookingToLead",
        command_execution_id,
        context: input.context,
        mutations,
      });
      return {
        entity_refs: [
          { model: "BookedLead", id: input.booking_id },
          { model: input.lead_model, id: input.lead_id },
        ],
        pending: jobs,
      };
    },
    finalize: async (jobs) => {
      for (const job of jobs) {
        await finalizeSheetSync(job);
      }
    },
  });
}

function actorContext(context: CanonicalCommandContext): {
  actor: string;
  ownerId?: string;
  ownerEmail?: string;
} {
  return {
    actor: `${context.actor.actor_type}:${context.actor.actor_id}`,
    ...(context.initiator.actor_type !== "system"
      ? {
          ownerId: context.initiator.actor_id,
          ownerEmail: context.initiator.actor_label,
        }
      : {}),
  };
}
