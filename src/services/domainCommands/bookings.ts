import mongoose from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import { ConflictError, NotFoundError } from "../errors";
import { getLinkedLead } from "../leads";
import {
  resolveBookingLeadReconciliationInTransaction,
} from "../employeeBookings/bookingLeadReconciliation.service";
import { finalizeSheetSync } from "../sheetSync";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
} from "./entityChange";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
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
