import mongoose, { type ClientSession } from "mongoose";
import { ExternalDataConnection } from "../../models/ExternalDataConnection";
import { IngestionRun } from "../../models/IngestionRun";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import type { CanonicalCommandContext } from "../domainCommands/types";

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
    .select("connection_id lease_owner lease_epoch").session(session).lean().exec();
  if (!run?.lease_owner || !run.lease_epoch) throw new Error("final_reconciliation_run_not_applying");
  const connection = await ExternalDataConnection.exists({ _id: run.connection_id,
    key: "best_relocation", retired_at: null }).session(session);
  if (!connection) throw new Error("final_reconciliation_connection_retired");
  const now = new Date();
  const held = await SheetSyncLease.updateOne({ scope: "ingestion:best_relocation:apply",
    lease_owner: run.lease_owner, lease_epoch: run.lease_epoch, leased_until: { $gt: now } },
    { $set: { updatedAt: now } }, { session }).exec();
  if (held.matchedCount !== 1) throw new Error("final_reconciliation_lease_lost");
}
