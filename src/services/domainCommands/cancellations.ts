import { createCancelledLeadSchema } from "../../validation/v1.validation";
import { createCancelledLeadInTransaction } from "../cancellations/cancelledLead.service";
import { finalizeSheetSync } from "../sheetSync";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import type {
  CanonicalCommandContext,
  CompatibilityCanonicalCommandResult,
} from "./types";

export async function createCancellation(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  const data = createCancelledLeadSchema.parse(input.data);
  return executeCanonicalCommandWithPostCommit({
    command_name: "createCancellation",
    context: input.context,
    operation: async ({ session, now }) => {
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
        { session, now },
      );
      return {
        entity_refs: [
          {
            model: "CancelledLead",
            id: pending.cancellation._id.toString(),
          },
          {
            model: "BookedLead",
            id: pending.booking._id.toString(),
          },
        ],
        pending,
      };
    },
    finalize: async (pending) => {
      await finalizeSheetSync(pending.job);
    },
  });
}
