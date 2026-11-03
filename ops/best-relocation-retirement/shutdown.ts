import mongoose from "mongoose";
import type { DurableActor } from "../../src/services/durableWork";
import { retireBestRelocationConnectionAndSources } from "../../src/services/ingestion/retireBestRelocation";

export type BestRelocationShutdownInput = {
  company_id: string; source_ids: readonly string[];
  /** Operator shutdown evidence ID, deliberately not a final ingestion run. */
  shutdown_id: string; actor: DurableActor;
};
type ShutdownDependencies = { retire: typeof retireBestRelocationConnectionAndSources };

/** Root CLI performs deployment/database preflight. This module can only shut
 * down policies and scheduling; it cannot read/apply source rows or claim final
 * reconciliation. A later final manual run still requires separate approval. */
export async function shutdownBestRelocationWithoutIngestion(input: BestRelocationShutdownInput,
  dependencies: ShutdownDependencies = { retire: retireBestRelocationConnectionAndSources },
): Promise<{ shutdown_id: string; cancelled_runs: number; source_ids: string[];
  reconciliation_status: "pending_owner_review"; source_apply_performed: false; source_company_deactivated: false }> {
  if (!input.shutdown_id.trim() || input.shutdown_id.length > 256 || !mongoose.isValidObjectId(input.company_id) ||
      !input.source_ids.length || input.source_ids.length > 1000 || new Set(input.source_ids).size !== input.source_ids.length ||
      input.source_ids.some(id => !mongoose.isValidObjectId(id))) throw new Error("Shutdown requires bounded reviewed company/source inventory and shutdown evidence.");
  if (input.actor.actor_type !== "owner" || input.actor.actor_role !== "owner" || input.actor.origin !== "vantage_admin" ||
      !input.actor.actor_id.trim() || !input.actor.request_id.trim()) throw new Error("Shutdown requires an authenticated Owner actor.");
  const result = await dependencies.retire({ company_id: input.company_id, source_ids: input.source_ids,
    final_run_id: input.shutdown_id, actor: input.actor, reconciliation_status: "deferred" });
  return { shutdown_id: input.shutdown_id, ...result, reconciliation_status: "pending_owner_review",
    source_apply_performed: false, source_company_deactivated: false };
}
