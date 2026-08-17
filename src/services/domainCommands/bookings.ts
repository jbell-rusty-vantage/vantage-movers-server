import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import {
  createBookedLeadSchema,
  createLeadlessBookingSchema,
} from "../../validation/v1.validation";
import {
  createBookedLeadInTransaction,
  finalizeBookedLeadCreateAfterCommit,
} from "../bookings/bookedLead.service";
import { createLeadlessBookingInTransaction } from "../bookings/leadlessBooking.service";
import { populateBookedLead } from "../bookings/bookedLead.service";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import { ConflictError, NotFoundError } from "../errors";
import { getLinkedLead } from "../leads";
import {
  resolveBookingLeadReconciliationInTransaction,
} from "../employeeBookings/bookingLeadReconciliation.service";
import { finalizeSheetSync } from "../sheetSync";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import type {
  CanonicalCommandContext,
  CompatibilityCanonicalCommandResult,
} from "./types";

export async function createBookingFromLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const data = createBookedLeadSchema.parse(input.data);
  const serviceInput = {
    ...data,
    ...(input.context.provenance.origin === "external_sheet_ingestion"
      ? {
          ingestion_source: "best_relocation_sheet" as const,
          allow_inactive_agents: true,
          set_primary_agent_as_receiver: true,
          receiver_agent_source_value: `Booked Deals:${data.job_no ?? "unknown-job"}`,
        }
      : {}),
  };
  return executeCanonicalCommandWithPostCommit({
    command_name: "createBookingFromLead",
    context: input.context,
    operation: async ({ session, now }) => {
      const pending = await createBookedLeadInTransaction(
        serviceInput,
        { session, now },
      );
      return {
        entity_refs: [
          {
            model: "BookedLead",
            id: String(pending.outcome.bookingId),
          },
          {
            model: data.lead_model,
            id: data.lead_ref,
          },
        ],
        warnings: pending.warnings,
        pending,
      };
    },
    finalize: async (pending) => {
      await finalizeBookedLeadCreateAfterCommit(
        serviceInput,
        pending.merchant,
        pending.warnings,
        pending.outcome,
      );
    },
  });
}

export async function createLeadlessBooking(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const data = createLeadlessBookingSchema.parse(input.data);
  return executeCanonicalCommandWithPostCommit({
    command_name: "createLeadlessBooking",
    context: input.context,
    operation: async ({ session, now }) => {
      const pending = await createLeadlessBookingInTransaction(
        {
          ...data,
          ingestion_source:
            input.context.provenance.origin === "external_sheet_ingestion"
              ? ("best_relocation_sheet" as const)
              : undefined,
        },
        { session, now },
      );
      return {
        entity_refs: [
          {
            model: "BookedLead",
            id: pending.booking._id.toString(),
          },
        ],
        warnings: pending.warnings,
        pending,
      };
    },
    finalize: async (pending) => {
      await finalizeSheetSync({
        resource: "booked_lead",
        operation: "leadless_booking.create",
        bookingId: pending.booking._id.toString(),
      });
      await populateBookedLead(pending.booking._id);
    },
  });
}

export async function attachBookingToLead(input: {
  booking_id: string;
  lead_model: "FormLead" | "CallLead";
  lead_id: string;
  expected_revision: number;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return executeCanonicalCommandWithPostCommit({
    command_name: "attachBookingToLead",
    context: input.context,
    operation: async ({ session, now }) => {
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
