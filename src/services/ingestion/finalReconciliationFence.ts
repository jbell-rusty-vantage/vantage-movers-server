import mongoose, { type ClientSession } from "mongoose";
import { ExternalDataConnection } from "../../models/ExternalDataConnection";
import { IngestionRun } from "../../models/IngestionRun";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import type { CanonicalCommandContext } from "../domainCommands/types";

/** Shutdown holds every final source mutation until a later, explicit Owner
 * release binds to that exact run's approved checksum. It never restarts workers. */
export function assertDeferredFinalIngestionRelease(connection: { retirement_ingestion_deferred?: boolean | null }, run: {
  plan_checksum?: string | null; approval?: unknown;
}): void {
  if (connection.retirement_ingestion_deferred !== true) return;
  const approval = run.approval && typeof run.approval === "object" ? run.approval as Record<string, unknown> : {};
  if (!run.plan_checksum || !/^[a-f0-9]{64}$/.test(run.plan_checksum) ||
      approval.owner_released_deferred_ingestion_checksum !== run.plan_checksum) throw new Error("final_reconciliation_deferred_pending_owner_review");
}

/** Every final-import aggregate write shares the live lease/retirement transaction fence. */
export async function assertFinalReconciliationWriteInTransaction(
  context: CanonicalCommandContext,
  session: ClientSession,
): Promise<void> {
  if (context.provenance.origin !== "external_sheet_ingestion") return;
  const runId = context.provenance.run_id;
  if (context.provenance.source_connection_key !== "best_relocation" || !runId ||
      !mongoose.isValidObjectId(runId) || context.initiator.actor_type !== "owner") {
    throw new Error("final_reconciliation_context_required");
  }
  const run = await IngestionRun.findOne({ _id: runId, adapter_key: "best_relocation",
    status: "applying", "approval.final_reconciliation": true })
    .select("connection_id lease_owner lease_epoch plan_checksum approval").session(session).lean().exec();
  if (!run?.lease_owner || !run.lease_epoch) throw new Error("final_reconciliation_run_not_applying");
  const connection = await ExternalDataConnection.findOne({ _id: run.connection_id,
    key: "best_relocation", retired_at: null }).select("retirement_ingestion_deferred").session(session).lean();
  if (!connection) throw new Error("final_reconciliation_connection_retired");
  assertDeferredFinalIngestionRelease(connection, run);
  const now = new Date();
  const held = await SheetSyncLease.updateOne({ scope: "ingestion:best_relocation:apply",
    lease_owner: run.lease_owner, lease_epoch: run.lease_epoch, leased_until: { $gt: now } },
    { $set: { updatedAt: now } }, { session }).exec();
  if (held.matchedCount !== 1) throw new Error("final_reconciliation_lease_lost");
}
