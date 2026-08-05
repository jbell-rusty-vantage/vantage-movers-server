import {
  previewCallLeadEnrichment,
} from "../enrichment";
import {
  previewBookedCallLeadReconciliation,
} from "../reconciliation";
import {
  buildGranotOperationPayloads,
  collectGranotReport,
  type GranotCollectionRequest,
  type GranotCollectionResult,
  type GranotCollectorDependencies,
  type GranotOperationPayloads,
} from "./index";

export type GranotAutomationMode = "collect" | "preview";

export type GranotAutomationResult = {
  mode: GranotAutomationMode;
  collection: {
    requestedDateWindow: GranotCollectionResult["requestedDateWindow"];
    discoveredSourceLabels: string[];
    notObservedSourceLabels: string[];
    sources: Array<{
      sourceLabel: string;
      contentHash: string;
      bookedJobs: number;
      followUpEstimates: number;
      rowsWithJobNo: number;
    }>;
  };
  payloads?: GranotOperationPayloads;
  operationSummary?: {
    enrichment: Record<string, number>;
    bookedReconciliation: Record<string, number>;
  };
  operations?: {
    enrichment: Awaited<ReturnType<typeof previewCallLeadEnrichment>>;
    bookedReconciliation: Awaited<
      ReturnType<typeof previewBookedCallLeadReconciliation>
    >;
  };
};

export async function runGranotAutomation(
  input: GranotCollectionRequest & {
    mode?: GranotAutomationMode;
    includeRows?: boolean;
  },
  dependencies: GranotCollectorDependencies = {},
): Promise<GranotAutomationResult> {
  const mode = input.mode ?? "collect";
  const collection = await collectGranotReport(input, dependencies);
  const payloads = buildGranotOperationPayloads(collection.sources);
  const operations =
    mode === "preview"
      ? {
          enrichment: await runInBatches(
            payloads.enrichmentRows,
            previewCallLeadEnrichment,
          ),
          bookedReconciliation: await runInBatches(
            payloads.bookedReconciliationRows,
            previewBookedCallLeadReconciliation,
          ),
        }
      : undefined;

  return {
    mode,
    collection: summarizeCollection(collection),
    ...(input.includeRows ? { payloads } : {}),
    ...(operations
      ? {
          operationSummary: {
            enrichment: summarizeStatuses(operations.enrichment),
            bookedReconciliation: summarizeStatuses(
              operations.bookedReconciliation,
            ),
          },
          ...(input.includeRows ? { operations } : {}),
        }
      : {}),
  };
}

function summarizeCollection(
  collection: GranotCollectionResult,
): GranotAutomationResult["collection"] {
  return {
    requestedDateWindow: collection.requestedDateWindow,
    discoveredSourceLabels: collection.discoveredSourceLabels,
    notObservedSourceLabels: collection.notObservedSourceLabels,
    sources: collection.sources.map((source) => {
      const rows = [
        ...source.sections.bookedJobs,
        ...source.sections.followUpEstimates,
      ];
      return {
        sourceLabel: source.sourceLabel,
        contentHash: source.contentHash,
        bookedJobs: source.sections.bookedJobs.length,
        followUpEstimates: source.sections.followUpEstimates.length,
        rowsWithJobNo: rows.filter((row) => Boolean(row.values.job_no)).length,
      };
    }),
  };
}

async function runInBatches<Row, Result>(
  rows: Row[],
  operation: (input: { rows: Row[] }) => Promise<Result[]>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    results.push(
      ...(await operation({
        rows: rows.slice(offset, offset + 100),
      })),
    );
  }
  return results;
}

function summarizeStatuses(
  rows: Array<{ status: string }>,
): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
}
