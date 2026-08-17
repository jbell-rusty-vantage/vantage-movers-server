import mongoose from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import {
  createBookedLeadSchema,
  createCallLeadSchema,
  createCancelledLeadSchema,
  createFormLeadSchema,
  createLeadlessBookingSchema,
  createReferralBookingSchema,
  updateBookedLeadSchema,
  updateCallLeadSchema,
  updateCancelledLeadSchema,
  updateFormLeadSchema,
} from "../../validation/v1.validation";
import {
  createBookedLeadInTransaction,
  finalizeBookedLeadCreateAfterCommit,
  populateBookedLead,
  updateBookedLeadInTransaction,
  deleteBookedLeadInTransaction,
} from "../bookings/bookedLead.service";
import { createBookedLeadFromSourceInTransaction } from "../bookings/bookedLeadFromSource.service";
import { createLeadlessBookingInTransaction } from "../bookings/leadlessBooking.service";
import { createReferralBookingInTransaction } from "../bookings/referralBooking.service";
import { createCancelledLeadInTransaction } from "../cancellations/cancelledLead.service";
import {
  deleteCancelledLeadInTransaction,
  updateCancelledLeadInTransaction,
} from "../cancellations/cancelledLead.service";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import { getLinkedLead } from "../leads";
import {
  createCallLeadInTransaction,
  finalizeCallLeadCreateAfterCommit,
  updateCallLeadInTransaction,
  deleteCallLeadInTransaction,
} from "../leads/callLead.service";
import {
  createFormLeadInTransaction,
  finalizeFormLeadCreateAfterCommit,
  updateFormLeadInTransaction,
  deleteFormLeadInTransaction,
} from "../leads/formLead.service";
import {
  deriveCallLeadIngestionOrigin,
  deriveFormLeadIngestionOrigin,
} from "../leads/leadIngestionProvenance";
import { finalizeSheetSync, finalizeSheetSyncDelete } from "../sheetSync";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  CANCELLED_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  type AggregateMutationPlan,
} from "./entityChange";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import type {
  CanonicalCommandContext,
  CanonicalCommandOperationInput,
  CompatibilityCanonicalCommandResult,
} from "./types";

function preallocatedChangeIds(count: number): mongoose.Types.ObjectId[] {
  return Array.from({ length: count }, () => new mongoose.Types.ObjectId());
}

function assignChangeIds(
  mutations: Array<Omit<AggregateMutationPlan, "change_id">>,
  changeIds: mongoose.Types.ObjectId[],
): AggregateMutationPlan[] {
  return mutations.map((mutation, index) => ({
    ...mutation,
    change_id: changeIds[index] ?? new mongoose.Types.ObjectId(),
  }));
}

async function persistPlannedMutations(
  command_name: string,
  context: CanonicalCommandContext,
  tx: CanonicalCommandOperationInput,
  mutations: Array<Omit<AggregateMutationPlan, "change_id">>,
  changeIds: mongoose.Types.ObjectId[],
): Promise<void> {
  await persistEntityChangeMutations({
    session: tx.session,
    now: tx.now,
    command_name,
    command_execution_id: tx.command_execution_id,
    context,
    mutations: assignChangeIds(mutations, changeIds),
  });
}

function createFields(
  document: { toObject(): Record<string, unknown> } | Record<string, unknown>,
  paths: readonly string[],
): Array<{ path: string; before?: unknown; after?: unknown }> {
  const after =
    typeof (document as { toObject?: () => Record<string, unknown> }).toObject ===
    "function"
      ? (document as { toObject: () => Record<string, unknown> }).toObject()
      : (document as Record<string, unknown>);
  return collectDocumentFieldChanges(null, after, paths);
}

export async function runExistingCreateFormLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: Awaited<ReturnType<typeof finalizeFormLeadCreateAfterCommit>>;
}> {
  const parsed = createFormLeadSchema.parse(
    input.context.provenance.origin === "external_sheet_ingestion" &&
      input.data &&
      typeof input.data === "object"
      ? {
          ...(input.data as Record<string, unknown>),
          ingestion_source: "best_relocation_sheet",
        }
      : input.data,
  );
  const data = {
    ...parsed,
    ingestion_source:
      input.context.provenance.origin === "external_sheet_ingestion"
        ? ("best_relocation_sheet" as const)
        : undefined,
  };
  if (input.context.provenance.origin === "external_sheet_ingestion") {
    requireBestRelocationImportSource(
      "best_relocation_sheet",
      String(data.source_company),
    );
  }
  const changeIds = preallocatedChangeIds(1);
  let finalized: Awaited<ReturnType<typeof finalizeFormLeadCreateAfterCommit>>;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "createFormLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await createFormLeadInTransaction(data, {
        ...tx,
        ingestion_origin: deriveFormLeadIngestionOrigin({
          commandOrigin: input.context.provenance.origin,
          actorType: input.context.actor.actor_type,
        }),
      });
      await persistPlannedMutations(
        "createFormLead",
        input.context,
        tx,
        [
          {
            entity: { model: "FormLead", id: pending.lead._id.toString() },
            revision_before: 0,
            fields: createFields(pending.lead, FORM_LEAD_CHANGE_PATHS),
          },
        ],
        changeIds,
      );
      return {
        entity_refs: [{ model: "FormLead", id: pending.lead._id.toString() }],
        pending,
      };
    },
    finalize: async (pending) => {
      finalized = await finalizeFormLeadCreateAfterCommit(pending);
    },
  });
  return { command, data: finalized! };
}

export async function runExistingCreateCallLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: Awaited<ReturnType<typeof finalizeCallLeadCreateAfterCommit>>;
}> {
  const data = createCallLeadSchema.parse(input.data);
  if (input.context.provenance.origin === "external_sheet_ingestion") {
    requireBestRelocationImportSource(
      "best_relocation_sheet",
      String(data.source_company),
    );
  }
  const changeIds = preallocatedChangeIds(1);
  let finalized: Awaited<ReturnType<typeof finalizeCallLeadCreateAfterCommit>>;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "createCallLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await createCallLeadInTransaction(data, {
        ...tx,
        ingestion_origin: deriveCallLeadIngestionOrigin({
          commandOrigin: input.context.provenance.origin,
        }),
      });
      await persistPlannedMutations(
        "createCallLead",
        input.context,
        tx,
        [
          {
            entity: { model: "CallLead", id: pending.lead._id.toString() },
            revision_before: 0,
            fields: createFields(pending.lead, CALL_LEAD_CHANGE_PATHS),
          },
        ],
        changeIds,
      );
      return {
        entity_refs: [{ model: "CallLead", id: pending.lead._id.toString() }],
        pending,
      };
    },
    finalize: async (pending) => {
      finalized = await finalizeCallLeadCreateAfterCommit(pending);
    },
  });
  return { command, data: finalized! };
}

export async function runExistingUpdateSourceOwnedLead(input: {
  lead_model: "FormLead" | "CallLead";
  lead_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
  expected?: Record<string, unknown>;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
  const update =
    input.lead_model === "FormLead"
      ? updateFormLeadSchema.parse(input.patch)
      : updateCallLeadSchema.parse(input.patch);
  const changeIds = preallocatedChangeIds(1);
  let updated: unknown;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "updateSourceOwnedLead",
    context: input.context,
    operation: async (tx) => {
      if (input.context.provenance.origin === "external_sheet_ingestion") {
        const lead = await getLinkedLead(input.lead_model, input.lead_id, tx.session);
        requireBestRelocationImportSource(
          "best_relocation_sheet",
          String(lead.source_company),
        );
      }
      const before = await loadLeadSnapshot(input.lead_model, input.lead_id, tx.session);
      if (input.lead_model === "FormLead") {
        updated = await updateFormLeadInTransaction(
          input.lead_id,
          updateFormLeadSchema.parse(update),
          tx,
          input.expected ? { expected: input.expected } : {},
        );
      } else {
        updated = await updateCallLeadInTransaction(
          input.lead_id,
          updateCallLeadSchema.parse(update),
          tx,
        );
      }
      const after = (updated as { toObject: () => Record<string, unknown> }).toObject();
      const fields = collectDocumentFieldChanges(
        before,
        after,
        input.lead_model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS,
      );
      if (fields.length > 0) {
        await persistPlannedMutations(
          "updateSourceOwnedLead",
          input.context,
          tx,
          [
            {
              entity: { model: input.lead_model, id: input.lead_id },
              revision_before: Number(before?.domain_revision ?? 0),
              fields,
            },
          ],
          changeIds,
        );
      }
      return {
        entity_refs: [{ model: input.lead_model, id: input.lead_id }],
        pending:
          fields.length > 0
            ? {
                resource: "source_lead" as const,
                operation:
                  input.lead_model === "FormLead"
                    ? "form_lead.update"
                    : "call_lead.update",
                leadModel: input.lead_model,
                leadId: input.lead_id,
              }
            : undefined,
      };
    },
    finalize: finalizeSheetSync,
  });
  return { command, data: updated };
}

export async function runExistingCreateBookingFromLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
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
  const changeIds = preallocatedChangeIds(2);
  let finalized: unknown;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "createBookingFromLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await createBookedLeadInTransaction(serviceInput, tx);
      if (pending.outcome.kind !== "duplicate") {
        const booking = await BookedLead.findById(pending.outcome.bookingId).session(
          tx.session ?? null,
        );
        const lead = await getLinkedLead(data.lead_model, data.lead_ref, tx.session);
        const mutations: Array<Omit<AggregateMutationPlan, "change_id">> = [
          {
            entity: {
              model: "BookedLead",
              id: String(pending.outcome.bookingId),
            },
            revision_before: Number(
              (booking as { domain_revision?: number } | null)?.domain_revision ?? 0,
            ),
            fields: [
              { path: "job_no", after: data.job_no },
              { path: "lead_ref", after: data.lead_ref },
              { path: "lead_model", after: data.lead_model },
            ],
          },
          {
            entity: { model: data.lead_model, id: data.lead_ref },
            revision_before: Number(
              (lead as { domain_revision?: number }).domain_revision ?? 0,
            ),
            fields: [{ path: "booked", after: String(pending.outcome.bookingId) }],
          },
        ];
        await persistPlannedMutations(
          "createBookingFromLead",
          input.context,
          tx,
          mutations,
          changeIds,
        );
      }
      return {
        entity_refs: [
          { model: "BookedLead", id: String(pending.outcome.bookingId) },
          { model: data.lead_model, id: data.lead_ref },
        ],
        warnings: pending.warnings,
        pending,
      };
    },
    finalize: async (pending) => {
      finalized = await finalizeBookedLeadCreateAfterCommit(
        serviceInput,
        pending.merchant,
        pending.warnings,
        pending.outcome,
      );
    },
  });
  return { command, data: finalized };
}

export async function runExistingCreateLeadlessBooking(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
  const data = createLeadlessBookingSchema.parse(input.data);
  const changeIds = preallocatedChangeIds(1);
  let bookingId: string | undefined;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "createLeadlessBooking",
    context: input.context,
    operation: async (tx) => {
      const pending = await createLeadlessBookingInTransaction(
        {
          ...data,
          ingestion_source:
            input.context.provenance.origin === "external_sheet_ingestion"
              ? ("best_relocation_sheet" as const)
              : undefined,
        },
        tx,
      );
      bookingId = pending.booking._id.toString();
      await persistPlannedMutations(
        "createLeadlessBooking",
        input.context,
        tx,
        [
          {
            entity: { model: "BookedLead", id: bookingId },
            revision_before: 0,
            fields: createFields(pending.booking, BOOKED_LEAD_CHANGE_PATHS),
          },
        ],
        changeIds,
      );
      return {
        entity_refs: [{ model: "BookedLead", id: bookingId }],
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
    },
  });
  return {
    command,
    data: bookingId
      ? await (async () => {
          const booking = await populateBookedLead(
            new mongoose.Types.ObjectId(bookingId),
          );
          return {
            booking,
            message: "Leadless booking created.",
            warnings: command.warnings,
            total_binder_amount: booking.total_binder_amount,
          };
        })()
      : null,
  };
}

export async function runExistingCreateReferralBooking(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
  const data = createReferralBookingSchema.parse(input.data);
  const changeIds = preallocatedChangeIds(1);
  let finalized: unknown;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "createExistingReferralBooking",
    context: input.context,
    operation: async (tx) => {
      const pending = await createReferralBookingInTransaction(data, tx);
      await persistPlannedMutations(
        "createExistingReferralBooking",
        input.context,
        tx,
        [
          {
            entity: { model: "BookedLead", id: pending.booking._id.toString() },
            revision_before: 0,
            fields: createFields(pending.booking, BOOKED_LEAD_CHANGE_PATHS),
          },
        ],
        changeIds,
      );
      return {
        entity_refs: [
          { model: "BookedLead", id: pending.booking._id.toString() },
        ],
        warnings: pending.warnings,
        pending,
      };
    },
    finalize: async (pending) => {
      finalized = await pending.finalize();
    },
  });
  return { command, data: finalized };
}

export async function runExistingCreateCancellation(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
  const data = createCancelledLeadSchema.parse(input.data);
  const changeIds = preallocatedChangeIds(3);
  let cancellation: unknown;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "createCancellation",
    context: input.context,
    operation: async (tx) => {
      const pending = await createCancelledLeadInTransaction(
        {
          ...data,
          ingestion_source:
            input.context.provenance.origin === "external_sheet_ingestion"
              ? ("best_relocation_sheet" as const)
              : undefined,
        },
        {
          ...(input.context.provenance.origin === "external_sheet_ingestion"
            ? {
                requiredSourceConnectionKey:
                  input.context.provenance.source_connection_key ?? undefined,
              }
            : {}),
        },
        tx,
      );
      cancellation = pending.cancellation;
      const mutations: Array<Omit<AggregateMutationPlan, "change_id">> = [
        {
          entity: {
            model: "CancelledLead",
            id: pending.cancellation._id.toString(),
          },
          revision_before: 0,
          fields: createFields(pending.cancellation, CANCELLED_LEAD_CHANGE_PATHS),
        },
        {
          entity: { model: "BookedLead", id: pending.booking._id.toString() },
          revision_before: Number(pending.booking.domain_revision ?? 0),
          fields: [
            { path: "cancelled", after: pending.cancellation._id.toString() },
          ],
        },
      ];
      if (pending.booking.lead_model && pending.booking.lead_ref) {
        const lead = await getLinkedLead(
          pending.booking.lead_model as "FormLead" | "CallLead",
          pending.booking.lead_ref.toString(),
          tx.session,
        );
        mutations.push({
          entity: {
            model: pending.booking.lead_model as "FormLead" | "CallLead",
            id: pending.booking.lead_ref.toString(),
          },
          revision_before: Number(
            (lead as { domain_revision?: number }).domain_revision ?? 0,
          ),
          fields: [
            { path: "cancelled", after: pending.cancellation._id.toString() },
          ],
        });
      }
      await persistPlannedMutations(
        "createCancellation",
        input.context,
        tx,
        mutations,
        changeIds,
      );
      return {
        entity_refs: [
          { model: "CancelledLead", id: pending.cancellation._id.toString() },
          { model: "BookedLead", id: pending.booking._id.toString() },
        ],
        pending,
      };
    },
    finalize: async (pending) => {
      await finalizeSheetSync(pending.job);
    },
  });
  return { command, data: cancellation };
}

export async function runExistingUpdateBookedLead(input: {
  booking_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
  const patch = updateBookedLeadSchema.parse(input.patch);
  const changeIds = preallocatedChangeIds(2);
  let finalized: unknown;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "updateBookedLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await updateBookedLeadInTransaction(
        input.booking_id,
        patch,
        tx,
      );
      finalized = pending.result;
      if (!pending.noop) {
        await persistPlannedMutations(
          "updateBookedLead",
          input.context,
          tx,
          pending.mutations,
          changeIds,
        );
      }
      return {
        entity_refs: [{ model: "BookedLead", id: input.booking_id }],
        warnings: pending.warnings,
        pending: pending.noop ? undefined : pending.job,
      };
    },
    finalize: finalizeSheetSync,
  });
  return { command, data: finalized };
}

export async function runExistingUpdateCancelledLead(input: {
  cancellation_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
  const patch = updateCancelledLeadSchema.parse(input.patch);
  const changeIds = preallocatedChangeIds(1);
  let updated: unknown;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "updateCancelledLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await updateCancelledLeadInTransaction(
        input.cancellation_id,
        patch,
        tx,
      );
      updated = pending.cancellation;
      if (!pending.noop) {
        await persistPlannedMutations(
          "updateCancelledLead",
          input.context,
          tx,
          pending.mutations,
          changeIds,
        );
      }
      return {
        entity_refs: [{ model: "CancelledLead", id: input.cancellation_id }],
        pending: pending.noop ? undefined : pending.job,
      };
    },
    finalize: finalizeSheetSync,
  });
  return { command, data: updated };
}

export async function runExistingCreateBookedLeadFromSource(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<{
  command: CompatibilityCanonicalCommandResult;
  data: unknown;
}> {
  const changeIds = preallocatedChangeIds(3);
  let finalized: unknown;
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "createBookingFromLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await createBookedLeadFromSourceInTransaction(
        input.data,
        tx,
      );
      finalized = pending.result;
      if (pending.mutations.length > 0) {
        await persistPlannedMutations(
          "createBookingFromLead",
          input.context,
          tx,
          pending.mutations,
          changeIds,
        );
      }
      return {
        entity_refs: pending.entity_refs,
        warnings: pending.warnings,
        pending,
      };
    },
    finalize: async (pending) => {
      finalized = await pending.finalize();
    },
  });
  return { command, data: finalized };
}

export async function runExistingDeleteFormLead(input: {
  lead_id: string;
  cascade: boolean;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const changeIds = preallocatedChangeIds(4);
  return executeCanonicalCommandWithPostCommit({
    command_name: "deleteFormLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await deleteFormLeadInTransaction(
        input.lead_id,
        input.cascade,
        tx,
      );
      await persistPlannedMutations(
        "deleteFormLead",
        input.context,
        tx,
        pending.mutations,
        changeIds,
      );
      return {
        entity_refs: pending.entity_refs,
        pending,
      };
    },
    finalize: finalizeDelete,
  });
}

export async function runExistingDeleteCallLead(input: {
  lead_id: string;
  cascade: boolean;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const changeIds = preallocatedChangeIds(4);
  return executeCanonicalCommandWithPostCommit({
    command_name: "deleteCallLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await deleteCallLeadInTransaction(
        input.lead_id,
        input.cascade,
        tx,
      );
      await persistPlannedMutations(
        "deleteCallLead",
        input.context,
        tx,
        pending.mutations,
        changeIds,
      );
      return {
        entity_refs: pending.entity_refs,
        pending,
      };
    },
    finalize: finalizeDelete,
  });
}

export async function runExistingDeleteBookedLead(input: {
  booking_id: string;
  cascade: boolean;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const changeIds = preallocatedChangeIds(4);
  return executeCanonicalCommandWithPostCommit({
    command_name: "deleteBookedLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await deleteBookedLeadInTransaction(
        input.booking_id,
        input.cascade,
        tx,
      );
      await persistPlannedMutations(
        "deleteBookedLead",
        input.context,
        tx,
        pending.mutations,
        changeIds,
      );
      return {
        entity_refs: pending.entity_refs,
        pending,
      };
    },
    finalize: finalizeDelete,
  });
}

export async function runExistingDeleteCancelledLead(input: {
  cancellation_id: string;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const changeIds = preallocatedChangeIds(3);
  return executeCanonicalCommandWithPostCommit({
    command_name: "deleteCancelledLead",
    context: input.context,
    operation: async (tx) => {
      const pending = await deleteCancelledLeadInTransaction(
        input.cancellation_id,
        tx,
      );
      await persistPlannedMutations(
        "deleteCancelledLead",
        input.context,
        tx,
        pending.mutations,
        changeIds,
      );
      return {
        entity_refs: pending.entity_refs,
        pending,
      };
    },
    finalize: finalizeDelete,
  });
}

async function finalizeDelete(pending: {
  finalize: () => Promise<void>;
}): Promise<void> {
  await pending.finalize();
}

async function loadLeadSnapshot(
  model: "FormLead" | "CallLead",
  id: string,
  session?: mongoose.ClientSession,
): Promise<Record<string, unknown> | null> {
  const lead = await getLinkedLead(model, id, session);
  return (lead as { toObject: () => Record<string, unknown> }).toObject();
}
