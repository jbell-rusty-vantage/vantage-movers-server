import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { IngestionRun } from "../../models/IngestionRun";
import { getCallLeadModel } from "../../models/CallLead";
import { SourceRowReceipt } from "../../models/SourceRowReceipt";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { canonicalJson } from "../durableWork";
import { ConflictError } from "../errors";
import { assertFinalReconciliationWriteInTransaction } from "../ingestion/finalReconciliationFence";
import { BEST_RELOCATION_CUTOFF } from "../bestRelocationSheetIngest/sheets";
import type { BestRelocationPlanAction } from "../bestRelocationSheetIngest/applicationPlan";
import { BEST_RELOCATION_ADMISSION_CALL_FEED_ID, BEST_RELOCATION_ADMISSION_COMPANY_ID, EXTERNAL_CALL_ADMISSION_POLICY_VERSION, externalCallAdmissionSchema, type ExternalCallAdmission } from "../leads/callLeadAdmission";
import { classifyExternalReview, externalSheetReviewSchema, EXTERNAL_REVIEW_POLICY_VERSION, BEST_RELOCATION_TRACKER_ID } from "../leads/externalSheetReview";
import { beginFinalBestRelocationCallLeadIngestion, completeCallLeadIngestion } from "../leads/callLead.service";
import { hasFormFillForCallLead } from "../leads/duplicateLead.service";
import { leadInstant } from "../salesOutreach/subjects/leadInstant";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import { buildPhoneRegex } from "../leads/leadPhoneMatching";
import { enqueueSheetSyncJob } from "../sheetSync/sheetSyncOutbox.service";
import { finalizeSheetSync } from "../sheetSync/sheetSyncCoordinator";
import { wakeLeadLinksAfterLeadCommand } from "../numberActivity/leadLinkJobs";
import { CALL_LEAD_CHANGE_PATHS, collectDocumentFieldChanges, persistEntityChangeMutations } from "./entityChange";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import type { CanonicalCommandContext } from "./types";

const objectId = z.string().regex(/^[a-f0-9]{24}$/);
export const finalBestRelocationCallPayloadSchema = z.object({
  phone_number: z.string().min(1).max(64), timestamp: z.string().datetime({ offset: true }),
  source_company: z.literal("best_relocation_leads"),
  lead_source_company: z.literal(BEST_RELOCATION_ADMISSION_COMPANY_ID),
  source_granularity_id: z.literal(BEST_RELOCATION_ADMISSION_CALL_FEED_ID),
  duplicate: z.boolean(), reviewed_for_insert: z.boolean().default(false),
  expected_disposition: z.enum(["calls", "duplicate_calls", "bad_call_leads"]),
  target_lead_id: objectId.optional(), expected_revision: z.number().int().nonnegative().optional(),
  matching_receipt_id: objectId.optional(),
  source_stable_row_id: z.string().min(1).max(256).regex(/\S/).optional(), primary_lead_id: objectId.optional(),
}).strict();
export type FinalBestRelocationCallInput = { action: BestRelocationPlanAction; context: CanonicalCommandContext };
export function bestRelocationFinalCallPayloadChecksum(action: BestRelocationPlanAction): string {
  return createHash("sha256").update(canonicalJson({ policy: EXTERNAL_CALL_ADMISSION_POLICY_VERSION, action })).digest("hex");
}

/** Pure validation is also used by focused tests. The action must be literally
 * present in the immutable server-side plan, not merely carry plausible fields. */
export function assertApprovedFinalCallAction(input: FinalBestRelocationCallInput, run: {
  plan_snapshot?: any; plan_checksum?: string | null; source_read_through?: Date | null;
  initiator?: any; approval?: any;
}) {
  const { action, context } = input;
  if (context.provenance.origin !== "external_sheet_ingestion" || context.provenance.source_connection_key !== "best_relocation" ||
      context.initiator.actor_type !== "owner" || context.payload_checksum !== bestRelocationFinalCallPayloadChecksum(action) ||
      !mongoose.isValidObjectId(context.provenance.run_id) || !mongoose.isValidObjectId(context.provenance.source_receipt_id)) throw new ConflictError("Invalid final Call command context");
  const actions = run.plan_snapshot?.canonical_plan?.actions;
  const matches = Array.isArray(actions) ? actions.filter((entry: BestRelocationPlanAction) => entry.action_key === action.action_key) : [];
  if (run.approval?.final_reconciliation !== true || !run.plan_checksum || run.plan_snapshot?.checksum !== run.plan_checksum || run.initiator?.actor_id !== context.initiator.actor_id ||
      matches.length !== 1 || canonicalJson(matches[0]) !== canonicalJson(action)) throw new ConflictError("Final Call is absent from the approved frozen plan");
  if (action.command !== "admit_final_best_relocation_call" || !["calls", "call_aliases"].includes(action.dataset_key) ||
      !["create", "adoption"].includes(action.classification) || !/^[a-f0-9]{64}$/.test(action.content_hash) ||
      !action.stable_source_row_id.trim() || action.stable_source_row_id.length > 256 || "rows" in action.provenance ||
      action.provenance.workbook_id !== BEST_RELOCATION_TRACKER_ID || action.provenance.tab !== "Calls") throw new ConflictError("Final Call source identity is invalid");
  const payload = finalBestRelocationCallPayloadSchema.parse(action.command_payload);
  if (action.dataset_key === "call_aliases") {
    const primaries = actions.filter((entry: BestRelocationPlanAction) => entry.dataset_key === "calls" &&
      entry.stable_source_row_id === payload.source_stable_row_id && entry.content_hash === action.content_hash &&
      entry.command === "admit_final_best_relocation_call" && entry.command_payload?.target_lead_id === payload.primary_lead_id);
    if (!payload.target_lead_id || !payload.primary_lead_id || !payload.source_stable_row_id || payload.target_lead_id === payload.primary_lead_id ||
        action.stable_source_row_id !== `${payload.source_stable_row_id}:alias:${payload.target_lead_id}` ||
        payload.expected_disposition !== "duplicate_calls" || primaries.length !== 1 ||
        primaries[0].command_payload.phone_number !== payload.phone_number || primaries[0].command_payload.timestamp !== payload.timestamp)
      throw new ConflictError("Final Call alias lacks an approved exact primary action");
  } else if (payload.source_stable_row_id || payload.primary_lead_id) throw new ConflictError("Primary Calls cannot override source identity");
  const arrival = new Date(payload.timestamp), through = run.source_read_through;
  if (!normalizePhoneNumberForMatch(payload.phone_number) || !through || !Number.isFinite(+through) ||
      +arrival < +BEST_RELOCATION_CUTOFF || +arrival >= +through) throw new ConflictError("Final Call is outside the supported source window");
  if (!!payload.target_lead_id !== (payload.expected_revision !== undefined)) throw new ConflictError("Final Call adoption revision is required");
  if (payload.matching_receipt_id && !payload.target_lead_id) throw new ConflictError("Final Call receipt requires an adoption target");
  if (!payload.target_lead_id && payload.expected_disposition === "calls" &&
      (!payload.reviewed_for_insert || !run.plan_checksum || run.approval?.normal_call_insert_approval !== run.plan_checksum)) throw new ConflictError("New normal Calls require explicit Owner checksum approval");
  return payload;
}

type Candidate = Record<string, any>;
/** A conflict receipt can mention a candidate without owning its identity. */
export function finalCallAdoptionReceiptTarget(receipt: {
  outcome?: string; source_state?: string; resulting_canonical_ids?: readonly string[];
} | null): string {
  if (!receipt || !["applied", "already_applied", "adopted"].includes(receipt.outcome ?? "") ||
      receipt.source_state === "source_missing" || receipt.resulting_canonical_ids?.length !== 1 ||
      !mongoose.isValidObjectId(receipt.resulting_canonical_ids[0])) throw new ConflictError("Final Call adoption receipt is invalid");
  return receipt.resulting_canonical_ids[0]!;
}
/** Exact legacy receipt ownership or one unique normalized phone/real-arrival
 * match can adopt. A supplied target ID alone never proves identity. */
export function selectFinalCallAdoption(payload: z.infer<typeof finalBestRelocationCallPayloadSchema>, candidates: Candidate[], receiptTargetId?: string): Candidate | null {
  if (candidates.length > 100) throw new ConflictError("Final Call identity candidate bound exceeded");
  const scoped = candidates.filter(row => row.source_company === "best_relocation_leads" &&
    String(row.lead_source_company) === payload.lead_source_company && String(row.source_granularity_id) === payload.source_granularity_id);
  const exact = receiptTargetId ? scoped.filter(row => String(row._id) === receiptTargetId) : scoped.filter(row =>
    normalizePhoneNumberForMatch(row.phone_number) === normalizePhoneNumberForMatch(payload.phone_number) &&
    leadInstant(row)?.getTime() === Date.parse(payload.timestamp));
  if (payload.target_lead_id) {
    const originals = exact.filter(row => row.duplicate !== true);
    const selected = payload.primary_lead_id
      ? exact.find(row => String(row._id) === payload.target_lead_id && row.duplicate === true)
      : exact.length === 1 ? exact[0] : originals.length === 1 ? originals[0] : undefined;
    if (!selected || String(selected._id) !== payload.target_lead_id || (payload.primary_lead_id &&
      (originals.length !== 1 || String(originals[0]!._id) !== payload.primary_lead_id))) throw new ConflictError("Final Call adoption identity is missing or ambiguous");
    if (Number(selected.domain_revision ?? 0) !== payload.expected_revision) throw new ConflictError("Final Call adoption revision changed");
    return selected;
  }
  if (exact.length) throw new ConflictError("A canonical Call already matches the planned create; replan for adoption");
  return null;
}

/** Operator-only final reconciliation command. There is no HTTP/worker path. */
export async function admitBestRelocationFinalCall(input: FinalBestRelocationCallInput) {
  if (input.context.payload_checksum !== bestRelocationFinalCallPayloadChecksum(input.action)) throw new ConflictError("Final Call payload checksum differs");
  type Pending = { created?: Awaited<ReturnType<typeof beginFinalBestRelocationCallLeadIngestion>>; sheet?: { resource: "source_lead"; operation: "call_lead.update"; leadModel: "CallLead"; leadId: string } };
  const changeId = new mongoose.Types.ObjectId();
  return executeCanonicalCommandWithPostCommit<Pending>({
    command_name: "admitBestRelocationFinalCallV1", context: input.context,
    operation: async tx => {
      await assertFinalReconciliationWriteInTransaction(input.context, tx.session);
      const run = await IngestionRun.findById(input.context.provenance.run_id).session(tx.session).lean();
      if (!run) throw new ConflictError("Final Call run is missing");
      const payload = assertApprovedFinalCallAction(input, run);
      const company = await getLeadSourceCompanyModel().exists({ _id: payload.lead_source_company, company_slug: "best_relocation_leads" }).session(tx.session);
      const feed = await getLeadSourceGranularityModel().exists({ _id: payload.source_granularity_id, source_company: payload.lead_source_company, channel: "call" }).session(tx.session);
      if (!company || !feed) throw new ConflictError("Final Call canonical source scope changed");
      let receiptTarget: string | undefined;
      if (payload.matching_receipt_id) {
        const receipt = await SourceRowReceipt.findOne({ _id: payload.matching_receipt_id, connection_id: run.connection_id, dataset_key: "calls",
          stable_source_row_id: input.action.stable_source_row_id, resulting_canonical_model: "CallLead",
          outcome: { $in: ["applied", "already_applied", "adopted"] }, source_state: { $ne: "source_missing" } }).session(tx.session).lean();
        receiptTarget = finalCallAdoptionReceiptTarget(receipt);
      }
      const Model = getCallLeadModel();
      // Company+phone inventory deliberately includes different stored timestamp
      // conventions; real arrival is verified by leadInstant in memory.
      const candidates = await Model.find({ source_company: "best_relocation_leads", lead_source_company: payload.lead_source_company,
        source_granularity_id: payload.source_granularity_id, ...(receiptTarget ? { _id: receiptTarget } : { phone_number: buildPhoneRegex(normalizePhoneNumberForMatch(payload.phone_number)!) }) })
        .limit(101).session(tx.session).lean();
      const target = selectFinalCallAdoption(payload, candidates, receiptTarget);
      const admission = externalCallAdmissionSchema.parse({ policy_version: EXTERNAL_CALL_ADMISSION_POLICY_VERSION,
        source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 1191420872, source_tab: "Calls",
        stable_source_row_id: payload.source_stable_row_id ?? input.action.stable_source_row_id, source_content_hash: input.action.content_hash,
        source_company_id: payload.lead_source_company, source_granularity_id: payload.source_granularity_id,
        source_arrival_at: new Date(payload.timestamp), ingestion_run_id: input.context.provenance.run_id,
        source_row_receipt_id: input.context.provenance.source_receipt_id, applied_at: tx.now });
      let id: string, before: Candidate | null = null, after: Candidate, pending: Pending;
      if (target) {
        id = String(target._id); before = target;
        const old = target.external_call_admission as ExternalCallAdmission | undefined;
        if (old) {
          const { applied_at: _at, ingestion_run_id: _run, source_row_receipt_id: _receipt, ...identity } = externalCallAdmissionSchema.parse(old);
          const { applied_at: _nextAt, ingestion_run_id: _nextRun, source_row_receipt_id: _nextReceipt, ...nextIdentity } = admission;
          if (canonicalJson(identity) !== canonicalJson(nextIdentity)) throw new ConflictError("Final Call admission is immutable and differs");
          return { entity_refs: [{ model: "CallLead", id }], pending: {} };
        }
        const form_fill = target.form_fill === true || await hasFormFillForCallLead({ sourceCompany: "best_relocation_leads", leadSourceCompany: payload.lead_source_company }, target.phone_number, tx.session);
        after = { ...target, external_call_admission: admission, form_fill };
        const revision = payload.expected_revision!;
        const revisionFilter = target.domain_revision == null ? { $or: [{ domain_revision: { $exists: false } }, { domain_revision: 0 }] } : { domain_revision: revision };
        // Sole one-time immutable setter: raw collection CAS is intentional;
        // ordinary Mongoose/public updates must keep stripping this path.
        const changed = await Model.collection.updateOne({ _id: target._id, ...revisionFilter, external_call_admission: { $exists: false } },
          { $set: { external_call_admission: admission, form_fill, ...(target.domain_revision == null ? { domain_revision: 0 } : {}) } }, { session: tx.session });
        if (changed.matchedCount !== 1) throw new ConflictError("Final Call admission raced");
        const sheet = { resource: "source_lead", operation: "call_lead.update", leadModel: "CallLead", leadId: id } as const;
        await enqueueSheetSyncJob(sheet, { session: tx.session, createdBy: "api" }); pending = { sheet };
      } else {
        const raw = "rows" in input.action.provenance ? "" : input.action.provenance.raw["Form Fill Checker"] ?? "";
        const classification = classifyExternalReview(raw, "CallLead");
        const review = classification ? externalSheetReviewSchema.parse({ ...admission, ...classification,
          policy_version: EXTERNAL_REVIEW_POLICY_VERSION }) : undefined;
        const created = await beginFinalBestRelocationCallLeadIngestion({ phone_number: payload.phone_number,
          timestamp: new Date(payload.timestamp), duplicate: payload.duplicate, admission, review,
          expected_disposition: payload.expected_disposition }, tx);
        id = String(created.lead._id); after = created.lead.toObject(); pending = { created };
      }
      await persistEntityChangeMutations({ ...tx, command_name: "admitBestRelocationFinalCallV1", context: input.context,
        mutations: [{ entity: { model: "CallLead", id }, change_id: changeId, revision_before: target ? payload.expected_revision! : 0,
          fields: collectDocumentFieldChanges(before, after, [...CALL_LEAD_CHANGE_PATHS, "external_call_admission", "external_sheet_review", "outreach_automation_suppressed"]) }] });
      return { entity_refs: [{ model: "CallLead", id }], pending };
    },
    finalize: async pending => {
      if (pending.created) {
        try { await completeCallLeadIngestion(pending.created); }
        finally { await wakeLeadLinksAfterLeadCommand({ target: { model: "CallLead", id: String(pending.created.lead._id) }, change_ids: [String(changeId)] }); }
      } else if (pending.sheet) await finalizeSheetSync(pending.sheet);
    },
  });
}
