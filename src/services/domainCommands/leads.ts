import {
  createCallLeadSchema,
  createFormLeadSchema,
  updateCallLeadSchema,
  updateFormLeadSchema,
} from "../../validation/v1.validation";
import {
  createCallLead as createCallLeadService,
  updateCallLead,
} from "../leads/callLead.service";
import {
  createFormLead as createFormLeadService,
  updateFormLead,
} from "../leads/formLead.service";
import { getLinkedLead } from "../leads";
import { requireBestRelocationImportSource } from "../bookings/bestRelocationImportGuard";
import { executeIdempotentCanonicalCommand } from "./idempotency";
import type {
  CanonicalCommandContext,
  CanonicalCommandResult,
} from "./types";

export async function createFormLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  const parsed = createFormLeadSchema.parse(
    withDerivedIngestionSource(input.data, input.context),
  );
  const data = {
    ...parsed,
    ingestion_source:
      input.context.provenance.origin ===
      "external_sheet_ingestion"
        ? ("best_relocation_sheet" as const)
        : undefined,
  };
  assertExternalCreateScope(
    input.context,
    String(data.source_company),
  );
  return executeIdempotentCanonicalCommand({
    command_name: "createFormLead",
    context: input.context,
    operation: () => createFormLeadService(data),
    project: (transactionResult) => ({
      entity_refs: [
        { model: "FormLead", id: entityId(transactionResult, "lead") },
      ],
    }),
  });
}

export async function createCallLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  const data = createCallLeadSchema.parse(input.data);
  assertExternalCreateScope(
    input.context,
    String(data.source_company),
  );
  return executeIdempotentCanonicalCommand({
    command_name: "createCallLead",
    context: input.context,
    operation: () => createCallLeadService(data),
    project: (transactionResult) => ({
      entity_refs: [
        { model: "CallLead", id: entityId(transactionResult) },
      ],
    }),
  });
}

export async function updateSourceOwnedLead(input: {
  lead_model: "FormLead" | "CallLead";
  lead_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  const update =
    input.lead_model === "FormLead"
      ? updateFormLeadSchema.parse(input.patch)
      : updateCallLeadSchema.parse(input.patch);
  return executeIdempotentCanonicalCommand({
    command_name: "updateSourceOwnedLead",
    context: input.context,
    operation: async (): Promise<unknown> => {
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
      }
      if (input.lead_model === "FormLead") {
        return updateFormLead(
          input.lead_id,
          updateFormLeadSchema.parse(update),
        );
      }
      return updateCallLead(
        input.lead_id,
        updateCallLeadSchema.parse(update),
      );
    },
    project: () => ({
      entity_refs: [
        { model: input.lead_model, id: input.lead_id },
      ],
    }),
  });
}

function entityId(value: unknown, nestedKey?: string): string {
  const candidate =
    nestedKey && isRecord(value) ? value[nestedKey] : value;
  if (!isRecord(candidate) || !("_id" in candidate)) {
    throw new Error("Canonical lead command produced no entity reference.");
  }
  return String(candidate._id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  if (
    context.provenance.origin === "external_sheet_ingestion"
  ) {
    requireBestRelocationImportSource(
      "best_relocation_sheet",
      sourceCompany,
    );
  }
}
