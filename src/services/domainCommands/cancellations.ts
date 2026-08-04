import { createCancelledLeadSchema } from "../../validation/v1.validation";
import { createCancelledLead } from "../cancellations/cancelledLead.service";
import { executeIdempotentCanonicalCommand } from "./idempotency";
import type {
  CanonicalCommandContext,
  CanonicalCommandResult,
} from "./types";

export async function createCancellation(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  const data = createCancelledLeadSchema.parse(input.data);
  return executeIdempotentCanonicalCommand({
    command_name: "createCancellation",
    context: input.context,
    operation: () =>
      createCancelledLead({
        ...data,
        ingestion_source:
          input.context.provenance.origin ===
          "external_sheet_ingestion"
            ? ("best_relocation_sheet" as const)
            : undefined,
      }, {
        ...(input.context.provenance.origin ===
          "external_sheet_ingestion"
          ? {
              requiredSourceConnectionKey:
                input.context.provenance.source_connection_key ??
                undefined,
            }
          : {}),
      }),
    project: (transactionResult) => {
      const cancellation = nestedRecord(
        transactionResult,
        "cancellation",
      );
      const booking = nestedRecord(transactionResult, "booking");
      return {
        entity_refs: [
          {
            model: "CancelledLead",
            id: documentId(cancellation),
          },
          {
            model: "BookedLead",
            id: documentId(booking),
          },
        ],
      };
    },
  });
}

function nestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    !(key in value) ||
    typeof (value as Record<string, unknown>)[key] !== "object" ||
    (value as Record<string, unknown>)[key] === null
  ) {
    throw new Error(
      "Canonical cancellation command produced no entity reference.",
    );
  }
  return (value as Record<string, unknown>)[key] as Record<string, unknown>;
}

function documentId(value: Record<string, unknown>): string {
  if (!("_id" in value)) {
    throw new Error(
      "Canonical cancellation command produced no entity reference.",
    );
  }
  return String(value._id);
}
