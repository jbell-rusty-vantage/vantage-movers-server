import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { classifyExternalReview, externalSheetReviewSchema, EXTERNAL_REVIEW_POLICY_VERSION, type ExternalSheetReview } from "../leads/externalSheetReview";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import { persistEntityChangeMutations } from "./entityChange";
import type { CanonicalCommandContext } from "./types";
import { enqueueSheetSyncJob } from "../sheetSync/sheetSyncOutbox.service";
import { finalizeSheetSync } from "../sheetSync/sheetSyncCoordinator";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import { ExternalDataConnection } from "../../models/ExternalDataConnection";
import { activeTokenFilter, type LeaseToken } from "../durableWork";
import { assertFinalReconciliationWriteInTransaction } from "../ingestion/finalReconciliationFence";

export type CapturedReviewCell = {
  source_workbook_id: string; source_sheet_id: number; source_tab: string;
  stable_source_row_id: string; source_content_hash: string; raw_value: string;
};
export type ReconcileReviewInput = {
  lead_model: "FormLead" | "CallLead"; lead_id: string; expected_revision: number;
  cell: CapturedReviewCell; correction?: boolean; previous_review_hash?: string;
  context: CanonicalCommandContext;
  execution: { lease: LeaseToken };
};
export function reviewPayloadChecksum(input: Omit<ReconcileReviewInput, "context" | "execution">): string {
  // Fixed construction is a stable command contract, independent of JSON key order.
  return createHash("sha256").update(JSON.stringify([
    EXTERNAL_REVIEW_POLICY_VERSION, input.lead_model, input.lead_id, input.expected_revision,
    input.cell.source_workbook_id, input.cell.source_sheet_id, input.cell.source_tab,
    input.cell.stable_source_row_id, input.cell.source_content_hash, input.cell.raw_value,
    input.correction === true, input.previous_review_hash ?? null,
  ])).digest("hex");
}
function sameReview(left: unknown, right: ExternalSheetReview): boolean {
  const parsed = externalSheetReviewSchema.safeParse(left);
  if (!parsed.success) return false;
  const { applied_at: _at, ingestion_run_id: _run, source_row_receipt_id: _receipt, ...before } = parsed.data;
  const { applied_at: _nextAt, ingestion_run_id: _nextRun, source_row_receipt_id: _nextReceipt, ...after } = right;
  return JSON.stringify(before) === JSON.stringify(after);
}

/** Restricted final-import command. Public update schemas never accept review facts. */
export async function reconcileExternalSheetReview(input: ReconcileReviewInput) {
  const { context, cell } = input;
  if (context.provenance.origin !== "external_sheet_ingestion" || context.provenance.source_connection_key !== "best_relocation" ||
      context.payload_checksum !== reviewPayloadChecksum(input)) throw new Error("invalid_review_command_context");
  const classification = classifyExternalReview(cell.raw_value, input.lead_model);
  // Validate source identity even when an explicit correction clears a blank cell.
  externalSheetReviewSchema.parse({ ...cell,
    kind: input.lead_model === "FormLead" ? "bad_form" : "bad_call",
    reason_code: input.lead_model === "FormLead" ? "external_bad_form" : "external_bad_call",
    raw_value: cell.raw_value || "blank correction", normalized_value: cell.raw_value.trim() || "blank correction",
    policy_version: EXTERNAL_REVIEW_POLICY_VERSION, ingestion_run_id: context.provenance.run_id,
    source_row_receipt_id: context.provenance.source_receipt_id, applied_at: new Date(),
  });
  const proposed = classification ? externalSheetReviewSchema.parse({ ...cell, ...classification,
    policy_version: EXTERNAL_REVIEW_POLICY_VERSION, ingestion_run_id: context.provenance.run_id,
    source_row_receipt_id: context.provenance.source_receipt_id, applied_at: new Date(),
  }) : null;
  type SheetIntent = { resource: "source_lead"; operation: "call_lead.update" | "form_lead.update"; leadModel: "CallLead" | "FormLead"; leadId: string };
  return executeCanonicalCommandWithPostCommit<SheetIntent | undefined>({
    command_name: "reconcileExternalSheetReviewV1", context,
    operation: async ({ session, now, command_execution_id }) => {
      if (input.execution.lease.scope !== "ingestion:best_relocation:apply") throw new Error("invalid_review_lease_scope");
      const held = await SheetSyncLease.updateOne(activeTokenFilter(input.execution.lease, new Date()),
        { $set: { leased_until: input.execution.lease.leased_until } }, { session });
      if (held.matchedCount !== 1) throw new Error("review_lease_lost");
      const connection = await ExternalDataConnection.findOneAndUpdate({ key: "best_relocation", retired_at: null },
        { $set: { updatedAt: now } }, { session, returnDocument: "after" });
      if (!connection) throw new Error("review_connection_retired_or_missing");
      // Older final-review commands may still hold approved envelopes. Shutdown
      // now holds those too until a new Owner release binds to the run checksum.
      if (connection.retirement_ingestion_deferred === true) await assertFinalReconciliationWriteInTransaction(context, session);
      const Model = (input.lead_model === "FormLead" ? getFormLeadModel() : getCallLeadModel()) as unknown as mongoose.Model<Record<string, unknown>>;
      const row = await Model.findById(input.lead_id).session(session).lean();
      if (!row || row.source_company !== "best_relocation_leads") throw new Error("review_target_source_mismatch");
      const old = row.external_sheet_review as ExternalSheetReview | undefined;
      if (proposed && sameReview(old, proposed)) return { entity_refs: [{ model: input.lead_model, id: input.lead_id }], pending: undefined };
      if (!proposed && (!input.correction || !old)) return { entity_refs: [{ model: input.lead_model, id: input.lead_id }], pending: undefined };
      if (Number(row.domain_revision ?? 0) !== input.expected_revision) throw new Error("review_revision_conflict");
      if (old && (old.stable_source_row_id !== cell.stable_source_row_id || old.source_workbook_id !== cell.source_workbook_id || old.source_sheet_id !== cell.source_sheet_id)) throw new Error("review_source_namespace_conflict");
      if (input.correction && old?.source_content_hash !== input.previous_review_hash) throw new Error("review_previous_hash_conflict");
      const next = proposed ? { ...proposed, applied_at: now } : undefined;
      if (row.domain_revision == null) await Model.updateOne({ _id: row._id, domain_revision: { $exists: false } }, { $set: { domain_revision: 0 } }, { session });
      const revisionFilter = row.domain_revision == null ? { $or: [{ domain_revision: { $exists: false } }, { domain_revision: 0 }] } : { domain_revision: input.expected_revision };
      const changed = await Model.updateOne({ _id: row._id, ...revisionFilter }, {
        ...(next ? { $set: { external_sheet_review: next } } : { $unset: { external_sheet_review: 1 } }),
      }, { session, runValidators: true });
      if (changed.matchedCount !== 1) throw new Error("review_revision_conflict");
      await persistEntityChangeMutations({ session, now, command_name: "reconcileExternalSheetReviewV1", command_execution_id, context,
        mutations: [{ entity: { model: input.lead_model, id: input.lead_id }, change_id: new mongoose.Types.ObjectId(), revision_before: input.expected_revision,
          fields: [{ path: "external_sheet_review", before: old, after: next }] }] });
      const sheet: SheetIntent = { resource: "source_lead", operation: input.lead_model === "CallLead" ? "call_lead.update" : "form_lead.update", leadModel: input.lead_model, leadId: input.lead_id };
      await enqueueSheetSyncJob(sheet, { session, createdBy: "api" });
      return { entity_refs: [{ model: input.lead_model, id: input.lead_id }], pending: sheet };
    }, finalize: async sheet => { if (sheet) await finalizeSheetSync(sheet); },
  });
}
