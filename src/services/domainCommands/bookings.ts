import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import {
  createBookedLeadSchema,
  createLeadlessBookingSchema,
} from "../../validation/v1.validation";
import { createBookedLead } from "../bookings/bookedLead.service";
import { createLeadlessBooking as createLeadlessBookingService } from "../bookings/leadlessBooking.service";
import { ConflictError, NotFoundError } from "../errors";
import { getLinkedLead } from "../leads";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import { resolveBookingLeadReconciliation } from "../employeeBookings/bookingLeadReconciliation.service";
import { executeIdempotentCanonicalCommand } from "./idempotency";
import type {
  CanonicalCommandContext,
  CanonicalCommandResult,
} from "./types";

export async function createBookingFromLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  const data = createBookedLeadSchema.parse(input.data);
  return executeIdempotentCanonicalCommand({
    command_name: "createBookingFromLead",
    context: input.context,
    operation: () =>
      createBookedLead({
        ...data,
        ...(input.context.provenance.origin ===
        "external_sheet_ingestion"
          ? {
              ingestion_source: "best_relocation_sheet" as const,
              allow_inactive_agents: true,
              set_primary_agent_as_receiver: true,
              receiver_agent_source_value: `Booked Deals:${data.job_no ?? "unknown-job"}`,
            }
          : {}),
      }),
    project: (transactionResult) => ({
      entity_refs: [
        {
          model: "BookedLead",
          id: nestedId(transactionResult, "bookingId"),
        },
        {
          model: data.lead_model,
          id: data.lead_ref,
        },
      ],
      warnings: stringArray(transactionResult, "warnings"),
    }),
  });
}

export async function createLeadlessBooking(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  const data = createLeadlessBookingSchema.parse(input.data);
  return executeIdempotentCanonicalCommand({
    command_name: "createLeadlessBooking",
    context: input.context,
    operation: () =>
      createLeadlessBookingService({
        ...data,
        ingestion_source:
          input.context.provenance.origin ===
          "external_sheet_ingestion"
            ? ("best_relocation_sheet" as const)
            : undefined,
      }),
    project: (transactionResult) => ({
      entity_refs: [
        {
          model: "BookedLead",
          id: nestedDocumentId(transactionResult, "booking"),
        },
      ],
      warnings: stringArray(transactionResult, "warnings"),
    }),
  });
}

export async function attachBookingToLead(input: {
  booking_id: string;
  lead_model: "FormLead" | "CallLead";
  lead_id: string;
  expected_revision: number;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  return executeIdempotentCanonicalCommand({
    command_name: "attachBookingToLead",
    context: input.context,
    operation: async () => {
      if (
        input.context.provenance.origin ===
        "external_sheet_ingestion"
      ) {
        const lead = await getLinkedLead(
          input.lead_model,
          input.lead_id,
        );
        requireBestRelocationImportSource(
          "best_relocation_sheet",
          String(lead.source_company),
        );
        const ownedBooking =
          await DomainCommandExecution.findOne({
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
            .select("_id")
            .lean()
            .exec();
        if (!ownedBooking) {
          throw new ConflictError(
            "Booking does not belong to this ingestion source",
          );
        }
      }
      const reconciliationCase =
        await BookingLeadReconciliationCase.findOne({
          booking: input.booking_id,
        })
          .select("_id")
          .lean()
          .exec();
      if (!reconciliationCase) {
        throw new NotFoundError(
          "Booking lead reconciliation case not found",
        );
      }
      return resolveBookingLeadReconciliation(
        String(reconciliationCase._id),
        {
          action: "attach_existing",
          revision: input.expected_revision,
          lead_model: input.lead_model,
          lead_id: input.lead_id,
        },
        actorContext(input.context),
      );
    },
    project: () => ({
      entity_refs: [
        { model: "BookedLead", id: input.booking_id },
        { model: input.lead_model, id: input.lead_id },
      ],
    }),
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

function nestedId(value: unknown, key: string): string {
  if (!isRecord(value) || !(key in value)) {
    throw new Error("Canonical booking command produced no entity reference.");
  }
  return String(value[key]);
}

function nestedDocumentId(value: unknown, key: string): string {
  if (!isRecord(value) || !isRecord(value[key]) || !("_id" in value[key])) {
    throw new Error("Canonical booking command produced no entity reference.");
  }
  return String(value[key]._id);
}

function stringArray(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return [];
  return value[key].filter(
    (entry): entry is string => typeof entry === "string",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
