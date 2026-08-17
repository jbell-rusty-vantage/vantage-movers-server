import {
  createCallLeadSchema,
  createFormLeadSchema,
  updateCallLeadSchema,
  updateFormLeadSchema,
} from "../../validation/v1.validation";
import {
  createCallLeadInTransaction,
  finalizeCallLeadCreateAfterCommit,
  updateCallLeadInTransaction,
} from "../leads/callLead.service";
import {
  createFormLeadInTransaction,
  finalizeFormLeadCreateAfterCommit,
  updateFormLeadInTransaction,
} from "../leads/formLead.service";
import { getLinkedLead } from "../leads";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import { finalizeSheetSync } from "../sheetSync";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import type {
  CanonicalCommandContext,
  CompatibilityCanonicalCommandResult,
} from "./types";

export async function createFormLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const parsed = createFormLeadSchema.parse(
    withDerivedIngestionSource(input.data, input.context),
  );
  const data = {
    ...parsed,
    ingestion_source:
      input.context.provenance.origin === "external_sheet_ingestion"
        ? ("best_relocation_sheet" as const)
        : undefined,
  };
  assertExternalCreateScope(input.context, String(data.source_company));
  return executeCanonicalCommandWithPostCommit({
    command_name: "createFormLead",
    context: input.context,
    operation: async ({ session, now }) => {
      const pending = await createFormLeadInTransaction(data, { session, now });
      return {
        entity_refs: [
          { model: "FormLead", id: pending.lead._id.toString() },
        ],
        pending,
      };
    },
    finalize: finalizeFormLeadCreateAfterCommit,
  });
}

export async function createCallLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const data = createCallLeadSchema.parse(input.data);
  assertExternalCreateScope(input.context, String(data.source_company));
  return executeCanonicalCommandWithPostCommit({
    command_name: "createCallLead",
    context: input.context,
    operation: async ({ session, now }) => {
      const pending = await createCallLeadInTransaction(data, { session, now });
      return {
        entity_refs: [
          { model: "CallLead", id: pending.lead._id.toString() },
        ],
        pending,
      };
    },
    finalize: finalizeCallLeadCreateAfterCommit,
  });
}

export async function updateSourceOwnedLead(input: {
  lead_model: "FormLead" | "CallLead";
  lead_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const update =
    input.lead_model === "FormLead"
      ? updateFormLeadSchema.parse(input.patch)
      : updateCallLeadSchema.parse(input.patch);
  return executeCanonicalCommandWithPostCommit({
    command_name: "updateSourceOwnedLead",
    context: input.context,
    operation: async ({ session, now }) => {
      if (input.context.provenance.origin === "external_sheet_ingestion") {
        const lead = await getLinkedLead(input.lead_model, input.lead_id, session);
        requireBestRelocationImportSource(
          "best_relocation_sheet",
          String(lead.source_company),
        );
      }
      if (input.lead_model === "FormLead") {
        await updateFormLeadInTransaction(
          input.lead_id,
          updateFormLeadSchema.parse(update),
          { session, now },
        );
      } else {
        await updateCallLeadInTransaction(
          input.lead_id,
          updateCallLeadSchema.parse(update),
          { session, now },
        );
      }
      return {
        entity_refs: [{ model: input.lead_model, id: input.lead_id }],
        pending: {
          resource: "source_lead" as const,
          operation:
            input.lead_model === "FormLead"
              ? "form_lead.update"
              : "call_lead.update",
          leadModel: input.lead_model,
          leadId: input.lead_id,
        },
      };
    },
    finalize: finalizeSheetSync,
  });
}

function withDerivedIngestionSource(
  data: unknown,
  context: CanonicalCommandContext,
): unknown {
  if (!isRecord(data)) return data;
  return {
    ...data,
    ingestion_source:
      context.provenance.origin === "external_sheet_ingestion"
        ? "best_relocation_sheet"
        : undefined,
  };
}

function assertExternalCreateScope(
  context: CanonicalCommandContext,
  sourceCompany: string,
): void {
  if (context.provenance.origin === "external_sheet_ingestion") {
    requireBestRelocationImportSource(
      "best_relocation_sheet",
      sourceCompany,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
