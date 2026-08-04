import type { LeaseStore } from "../durableWork";
import {
  applyBestRelocationPlan,
  type IngestionAdapter,
  type IngestionApplyResult,
} from "../ingestion";
import {
  BEST_RELOCATION_ADAPTER_KEY,
  BEST_RELOCATION_SCHEMA_VERSION,
  buildBestRelocationApplicationPlan,
  type BestRelocationApplicationPlan,
} from "./applicationPlan";
import { inspectBestRelocationSources } from "./provider";
import { readBestRelocationWorkbooks } from "./sheets";
import type { ParsedWorkbookData } from "./types";

export function createBestRelocationIngestionAdapter(input: {
  leaseStore: LeaseStore;
}): IngestionAdapter<ParsedWorkbookData, BestRelocationApplicationPlan> {
  return {
    key: BEST_RELOCATION_ADAPTER_KEY,
    schemaVersion: BEST_RELOCATION_SCHEMA_VERSION,
    async inspect(request) {
      if (request.repair_identity) {
        if (!request.lease) {
          throw new Error("Identity repair requires the adapter write lease");
        }
        const held = await input.leaseStore.assertHeld({
          token: request.lease,
          now: new Date(),
        });
        if (!held) throw new Error("Identity repair lease is not held");
      }
      return inspectBestRelocationSources({
        repairIdentity: request.repair_identity,
      });
    },
    async *read(request) {
      yield await readBestRelocationWorkbooks({
        cutoff: request.cutoff,
        sourceReadThrough: request.source_read_through,
      });
    },
    async plan(request) {
      if (request.observations.length !== 1) {
        throw new Error("Best Relocation adapter expects one workbook snapshot");
      }
      return buildBestRelocationApplicationPlan({
        data: request.observations[0],
        trigger: request.trigger,
        cutoff: request.cutoff,
        sourceReadThrough: request.source_read_through,
      }).plan;
    },
    async apply(request): Promise<IngestionApplyResult> {
      const result = await applyBestRelocationPlan({
        ...request,
        checksum: request.plan_checksum,
        leaseStore: input.leaseStore,
      });
      return {
        applied: result.applied,
        already_applied: result.already_applied,
        conflicts: result.conflicts,
        failures: result.failures,
      };
    },
  };
}
