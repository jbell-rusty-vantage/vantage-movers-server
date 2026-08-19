import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import type { GranotDiscrepancyDocument } from "../../models/granotDiscrepancyModel";
import { getGranotBookingDiscrepancyModel } from "../../models/GranotBookingDiscrepancy";
import { getGranotReleaseDiscrepancyModel } from "../../models/GranotReleaseDiscrepancy";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel, type GranotRecordLinkDocument } from "../../models/GranotRecordLink";
import { toObjectId } from "../../utils/objectId";
import type { GranotLifecycleCorrectRecordLinkCommandInput, GranotLifecycleDiscrepancyNoActionCommandInput, GranotLifecycleReEvaluateDiscrepancyCommandInput } from "../../validation/v1/granotLifecycle.validation";
import { createGranotLifecycleProcessorActor } from "../durableWork/actors";
import { canonicalJson } from "../durableWork/checksum";
import type { DurableActor } from "../durableWork/types";
import { collectDocumentFieldChanges, persistEntityChangeMutations, RECORD_LINK_CHANGE_PATHS } from "../domainCommands/entityChange";
import { executeIdempotentCanonicalCommand } from "../domainCommands/idempotency";
import { assertOwnerCommandIdempotencyKey, type CanonicalCommandContext } from "../domainCommands/types";
import { createDiscrepancyFingerprint, createMongoDiscrepancyStore } from "./discrepancies";
import { reconcileBookingCaseAfterDiscrepancy } from "./bookingReconciliation";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import { reconcileReleaseCaseAfterDiscrepancy } from "./releaseReconciliation";
import type { LeadModel, ObservationChannel } from "./types";

export const RE_EVALUATE_DISCREPANCY_COMMAND_NAME = "reEvaluateGranotDiscrepancy";
export const CORRECT_RECORD_LINK_COMMAND_NAME = "correctGranotRecordLink";
export const DISCREPANCY_NO_ACTION_COMMAND_NAME = "resolveGranotDiscrepancyNoAction";

type Envelope = { discrepancy_id: string; idempotency_key: string; owner: DurableActor; request_id?: string };
export type ReEvaluateDiscrepancyInput = Envelope & GranotLifecycleReEvaluateDiscrepancyCommandInput;
export type CorrectRecordLinkInput = Envelope & GranotLifecycleCorrectRecordLinkCommandInput;
export type DiscrepancyNoActionInput = Envelope & GranotLifecycleDiscrepancyNoActionCommandInput;
export type DiscrepancyOwnerCommandResult = {
  discrepancy_id: string; discrepancy_kind: "booking" | "release"; state: "open" | "resolved";
  revision: number; evidence_revision: number;
  outcome: "still_conflicting" | "re_evaluated" | "record_link_corrected" | "no_action";
  command_execution_id: string; replacement_record_link_id?: string;
  opened_case_ref?: { model: "GranotBookingReconciliationCase" | "GranotReleaseReconciliationCase"; id: string };
  replayed: boolean;
};

export async function resolveGranotDiscrepancyNoAction(input: DiscrepancyNoActionInput) {
  const causal = await prepare(input, DISCREPANCY_NO_ACTION_COMMAND_NAME, body(input));
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: DISCREPANCY_NO_ACTION_COMMAND_NAME, context: causal.context,
    operation: async ({ session, now, command_execution_id }) => {
      const row = await loadOpen(causal.kind, input.discrepancy_id, input.expected_revision, session, input.request_id);
      await resolve(row, input.expected_revision, "no_action", input.owner, command_execution_id, now, session, input.reason_code, input.reason_text);
      return { entity_refs: [{ model: modelName(causal.kind), id: input.discrepancy_id }, { model: "CommandExecution", id: String(command_execution_id) }], warnings: ["no_action"] };
    },
  });
  return reload(input.discrepancy_id, causal.kind, outcome.result.entity_refs, outcome.result.warnings, outcome.replayed);
}

export async function reEvaluateGranotDiscrepancy(input: ReEvaluateDiscrepancyInput) {
  const causal = await prepare(input, RE_EVALUATE_DISCREPANCY_COMMAND_NAME, body(input));
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: RE_EVALUATE_DISCREPANCY_COMMAND_NAME, context: causal.context,
    operation: async ({ session, now, command_execution_id }) => {
      const row = await loadOpen(causal.kind, input.discrepancy_id, input.expected_revision, session, input.request_id);
      const newest = row.evidence.at(-1)!;
      const current = await createMongoDiscrepancyStore().loadCurrentContext(causal.kind, String(newest.observation_id), session);
      if (current.classified_reason_code === row.reason_code) {
        return { entity_refs: [{ model: modelName(causal.kind), id: input.discrepancy_id }, { model: "CommandExecution", id: String(command_execution_id) }], warnings: ["still_conflicting"] };
      }
      let nextRef: { model: string; id: string } | undefined;
      let caseRef: DiscrepancyOwnerCommandResult["opened_case_ref"];
      if (current.classified_reason_code) {
        const store = createMongoDiscrepancyStore();
        const fingerprint = createDiscrepancyFingerprint({
          discrepancy_kind: causal.kind, normalized_job_no: current.normalized_job_no,
          reason_code: current.classified_reason_code, record_link_id: current.record_link_id,
          lead_ref: current.lead_ref, booking_id: current.booking_id, cancellation_id: current.cancellation_id,
        });
        let next = await store.findOpen(causal.kind, fingerprint, session);
        if (!next) {
          next = await store.insert(causal.kind, {
            _id: new mongoose.Types.ObjectId(), normalized_job_no: current.normalized_job_no,
            discrepancy_kind: causal.kind, reason_code: current.classified_reason_code,
            reason_fingerprint: fingerprint, state: "open",
            ...(current.record_link_id ? { record_link_id: toObjectId(current.record_link_id) } : {}),
            ...(current.lead_ref ? { lead_ref: { model: current.lead_ref.model, id: toObjectId(current.lead_ref.id) } } : {}),
            ...(current.booking_id ? { booking_id: toObjectId(current.booking_id) } : {}),
            ...(current.cancellation_id ? { cancellation_id: toObjectId(current.cancellation_id) } : {}),
            evidence: [{ observation_id: newest.observation_id, decision_id: newest.decision_id, captured_at: current.captured_at, action: current.action }],
            evidence_revision: 1, revision: 1, opened_at: now, last_evidence_at: current.captured_at,
          }, session);
        } else if (!next.evidence.some((item) => String(item.observation_id) === String(newest.observation_id))) {
          next = await store.refresh(causal.kind, {
            discrepancy_id: next._id,
            evidence: { observation_id: newest.observation_id, decision_id: newest.decision_id, captured_at: current.captured_at, action: current.action },
          }, session);
        }
        nextRef = { model: modelName(causal.kind), id: String(next._id) };
      } else {
        caseRef = await reconcileNormalCase(causal.kind, {
          observation_id: String(newest.observation_id), decision_id: String(newest.decision_id), opened_at: now, session,
        });
      }
      await resolve(row, input.expected_revision, "re_evaluated", input.owner, command_execution_id, now, session);
      return { entity_refs: [{ model: modelName(causal.kind), id: input.discrepancy_id }, ...(nextRef ? [nextRef] : []), ...(caseRef ? [caseRef] : []), { model: "CommandExecution", id: String(command_execution_id) }], warnings: ["re_evaluated"] };
    },
  });
  return reload(input.discrepancy_id, causal.kind, outcome.result.entity_refs, outcome.result.warnings, outcome.replayed);
}

export async function correctGranotRecordLink(
  input: CorrectRecordLinkInput,
  options: { test_fail_after?: "old_link" | "replacement" | "changes" } = {},
) {
  const causal = await prepare(input, CORRECT_RECORD_LINK_COMMAND_NAME, body(input));
  const replacementId = new mongoose.Types.ObjectId();
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: CORRECT_RECORD_LINK_COMMAND_NAME, context: causal.context,
    operation: async ({ session, now, command_execution_id }) => {
      const row = await loadOpen(causal.kind, input.discrepancy_id, input.expected_revision, session, input.request_id);
      if (!row.record_link_id || !isLinkConflict(row.reason_code)) throw lifecycle("This discrepancy cannot correct a Record Link", "IDENTITY_CONFLICT", 409, input.request_id);
      const Link = getGranotRecordLinkModel();
      const old = await Link.findOne({ _id: row.record_link_id, provider: "granot", state: "active", normalized_job_no: row.normalized_job_no, disputed: true, domain_revision: input.expected_link_revision }).session(session).lean().exec();
      if (!old) throw lifecycle("Record Link revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
      const lead = await loadEligibleLead(input.selected_lead.lead_model, input.selected_lead.lead_id, row.normalized_job_no, session, input.request_id);
      const replacement: GranotRecordLinkDocument = {
        _id: replacementId, provider: "granot", normalized_job_no: old.normalized_job_no, job_no_snapshot: old.job_no_snapshot,
        state: "active", lead_ref: { model: input.selected_lead.lead_model, id: toObjectId(input.selected_lead.lead_id) },
        ...(old.booking_ref ? { booking_ref: old.booking_ref } : {}),
        source_scope: { lead_source_company: toObjectId(String(lead.lead_source_company)), source_granularity_id: toObjectId(String(lead.source_granularity_id)) },
        disputed: false, established_by_decision_id: causal.decision_id, established_at: now,
        last_observation_id: causal.observation_id, last_observed_at: now, domain_revision: 0,
      };
      const oldAfter = { ...old, state: "superseded", superseded_by: replacementId };
      const updated = await Link.updateOne({ _id: old._id, state: "active", domain_revision: input.expected_link_revision }, { $set: { state: "superseded", superseded_by: replacementId } }, { session });
      if (updated.matchedCount !== 1) throw lifecycle("Record Link revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
      if (options.test_fail_after === "old_link") throw new Error("Synthetic correction rollback after old link");
      await Link.create([replacement], { session });
      if (options.test_fail_after === "replacement") throw new Error("Synthetic correction rollback after replacement");
      await persistEntityChangeMutations({ session, now, command_name: CORRECT_RECORD_LINK_COMMAND_NAME, command_execution_id, context: causal.context, mutations: [
        { change_id: new mongoose.Types.ObjectId(), entity: { model: "GranotRecordLink", id: String(old._id) }, revision_before: old.domain_revision, fields: collectDocumentFieldChanges(old as unknown as Record<string, unknown>, oldAfter as unknown as Record<string, unknown>, RECORD_LINK_CHANGE_PATHS) },
        { change_id: new mongoose.Types.ObjectId(), entity: { model: "GranotRecordLink", id: String(replacementId) }, revision_before: 0, fields: collectDocumentFieldChanges(null, replacement as unknown as Record<string, unknown>, RECORD_LINK_CHANGE_PATHS) },
      ] });
      if (options.test_fail_after === "changes") throw new Error("Synthetic correction rollback after Changes");
      const caseRef = await reconcileNormalCase(causal.kind, {
        observation_id: String(causal.observation_id), decision_id: String(causal.decision_id), opened_at: now, session,
      });
      await resolve(row, input.expected_revision, "record_link_corrected", input.owner, command_execution_id, now, session, undefined, input.reason_text);
      return { entity_refs: [{ model: modelName(causal.kind), id: input.discrepancy_id }, { model: "GranotRecordLink", id: String(replacementId) }, ...(caseRef ? [caseRef] : []), { model: "CommandExecution", id: String(command_execution_id) }], warnings: ["record_link_corrected"] };
    },
  });
  return reload(input.discrepancy_id, causal.kind, outcome.result.entity_refs, outcome.result.warnings, outcome.replayed);
}

async function prepare(input: Envelope, commandName: string, validatedBody: Record<string, unknown>) {
  assertOwnerCommandIdempotencyKey(input.idempotency_key);
  if (input.owner.actor_type !== "owner" || input.owner.actor_role !== "owner") throw lifecycle("Owner role is required", "OWNER_REQUIRED", 403, input.request_id);
  const found = await findAny(input.discrepancy_id);
  if (!found) throw lifecycle("Granot discrepancy not found", "DISCREPANCY_NOT_FOUND", 404, input.request_id);
  const newest = found.row.evidence.at(-1);
  const observation = newest ? await getGranotObservationModel().findById(newest.observation_id).lean().exec() : null;
  const receipt = observation ? await getGranotObservationReceiptModel().findById(observation.receipt_id).lean().exec() : null;
  if (!newest || !observation || !receipt) throw lifecycle("Discrepancy causal evidence is unavailable", "IDENTITY_CONFLICT", 409, input.request_id);
  const receiptId = String(receipt._id);
  const context: CanonicalCommandContext = {
    command_id: new mongoose.Types.ObjectId().toHexString(), idempotency_key: input.idempotency_key,
    payload_checksum: createHash("sha256").update(canonicalJson({ command_name: commandName, discrepancy_id: input.discrepancy_id, validated_body: validatedBody })).digest("hex"),
    actor: createGranotLifecycleProcessorActor(receiptId), initiator: input.owner,
    provenance: { origin: "granot_lifecycle", run_id: null, source_receipt_id: receiptId, source_connection_key: null,
      observation_id: String(newest.observation_id), decision_id: String(newest.decision_id), case_id: null,
      discrepancy_id: input.discrepancy_id, observation_channel: receipt.observation_channel as ObservationChannel },
  };
  return { context, kind: found.kind, observation_id: newest.observation_id, decision_id: newest.decision_id };
}

async function findAny(id: string) {
  const booking = await getGranotBookingDiscrepancyModel().findById(toObjectId(id)).lean().exec();
  if (booking) return { kind: "booking" as const, row: booking as GranotDiscrepancyDocument };
  const release = await getGranotReleaseDiscrepancyModel().findById(toObjectId(id)).lean().exec();
  return release ? { kind: "release" as const, row: release as GranotDiscrepancyDocument } : null;
}

async function loadOpen(kind: "booking" | "release", id: string, revision: number, session: ClientSession, requestId?: string) {
  const row = await model(kind).findOne({ _id: toObjectId(id), state: "open", revision }).session(session).lean().exec();
  if (!row) throw lifecycle("Granot discrepancy revision changed", "CASE_REVISION_CONFLICT", 409, requestId);
  return row as GranotDiscrepancyDocument;
}

async function resolve(row: GranotDiscrepancyDocument, revision: number, outcome: "re_evaluated" | "record_link_corrected" | "no_action", actor: DurableActor, command_execution_id: mongoose.Types.ObjectId, now: Date, session: ClientSession, reason_code?: string, reason_text?: string) {
  const result = await model(row.discrepancy_kind).updateOne({ _id: row._id, state: "open", revision }, { $set: { state: "resolved", resolution: { outcome, command_execution_id, actor, ...(reason_code ? { reason_code } : {}), ...(reason_text ? { reason_text } : {}), resolved_at: now } }, $inc: { revision: 1 } }, { session });
  if (result.matchedCount !== 1) throw lifecycle("Granot discrepancy revision changed", "CASE_REVISION_CONFLICT", 409);
}

async function loadEligibleLead(leadModel: LeadModel, leadId: string, job: string, session: ClientSession, requestId?: string) {
  const query = leadModel === "FormLead" ? getFormLeadModel().findById(leadId) : getCallLeadModel().findById(leadId);
  const lead = await query.session(session).lean().exec() as Record<string, unknown> | null;
  if (!lead || lead.normalized_job_no !== job || !lead.lead_source_company || !lead.source_granularity_id || (leadModel === "FormLead" && (lead.duplicate === true || lead.bad_lead === true))) throw lifecycle("Selected Lead is no longer eligible", "IDENTITY_CONFLICT", 409, requestId);
  return lead;
}

async function reload(id: string, kind: "booking" | "release", refs: readonly { model: string; id: string }[], warnings: readonly string[], replayed: boolean): Promise<DiscrepancyOwnerCommandResult> {
  const row = await model(kind).findById(id).lean().exec() as GranotDiscrepancyDocument | null;
  if (!row) throw new Error("Committed discrepancy result could not be reloaded.");
  const outcome = (warnings[0] ?? row.resolution?.outcome ?? "still_conflicting") as DiscrepancyOwnerCommandResult["outcome"];
  const replacement = refs.find((ref) => ref.model === "GranotRecordLink");
  const command = refs.find((ref) => ref.model === "CommandExecution");
  const openedCase = refs.find((ref) => ref.model === "GranotBookingReconciliationCase" || ref.model === "GranotReleaseReconciliationCase") as DiscrepancyOwnerCommandResult["opened_case_ref"] | undefined;
  return { discrepancy_id: id, discrepancy_kind: kind, state: row.state, revision: row.revision, evidence_revision: row.evidence_revision, outcome,
    command_execution_id: String(row.resolution?.command_execution_id ?? command?.id ?? ""), ...(replacement ? { replacement_record_link_id: replacement.id } : {}),
    ...(openedCase ? { opened_case_ref: openedCase } : {}), replayed };
}

async function reconcileNormalCase(
  kind: "booking" | "release",
  input: { observation_id: string; decision_id: string; opened_at: Date; session: ClientSession },
) {
  return kind === "booking"
    ? reconcileBookingCaseAfterDiscrepancy(input)
    : reconcileReleaseCaseAfterDiscrepancy(input);
}

function body(input: Record<string, unknown>) { const { discrepancy_id: _id, idempotency_key: _key, owner: _owner, request_id: _request, ...validated } = input; return validated; }
function isLinkConflict(reason: string) { return reason.includes("record_link_conflict") || reason.includes("job_number_conflict") || reason.includes("source_scope_conflict") || reason === "booked_booking_lead_conflict"; }
function model(kind: "booking" | "release") { return kind === "booking" ? getGranotBookingDiscrepancyModel() : getGranotReleaseDiscrepancyModel(); }
function modelName(kind: "booking" | "release") { return kind === "booking" ? "GranotBookingDiscrepancy" : "GranotReleaseDiscrepancy"; }
function lifecycle(message: string, key: keyof typeof GRANOT_LIFECYCLE_ERROR_CODES, status: number, requestId?: string) { return new GranotLifecycleError(message, GRANOT_LIFECYCLE_ERROR_CODES[key], status, requestId); }
