import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { connectMongo } from "../../db";
import { getCallLeadModel } from "../../models/CallLead";
import { createRingCentralCallIngestActor } from "../durableWork/actors";
import { hasQualifiedRingCentralCall } from "../ringcentral/callLeadQualification";
import type { RingCentralQualifiedCall } from "../ringcentral/ringcentral-call-lead-ingest.service";
import { finalizeSheetSync, persistSheetSyncIntent, type FullSheetSyncJob } from "../sheetSync";
import { emitLeadChange } from "./leadChangeEmission";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import { DomainRevisionConflictError, type CanonicalCommandContext } from "./types";

type StoredCall = Record<string, unknown> & {
  _id: { toString(): string };
  domain_revision?: number | null;
  ringcentral?: Record<string, unknown> | null;
};
export type FinalCallLogResultObservation = Pick<RingCentralQualifiedCall,
  "telephonySessionId" | "callLogId" | "startTime" | "finalCallLogResult">;

/** A result is writable only for an already-qualified, exact provider call. */
export function planRingCentralFinalResultUpdate(
  lead: StoredCall,
  call: FinalCallLogResultObservation,
): Record<string, unknown> | null {
  const fact = call.finalCallLogResult;
  const saved = lead.ringcentral;
  if (!fact || !fact.result.trim() || !call.startTime ||
      !Number.isFinite(call.startTime.getTime()) ||
      !Number.isFinite(fact.observedAt.getTime()) ||
      fact.callLogId !== call.callLogId || !hasQualifiedRingCentralCall(saved)) return null;
  const sameSession = Boolean(call.telephonySessionId &&
    saved?.telephony_session_id === call.telephonySessionId);
  const sameLog = Boolean(call.callLogId && saved?.call_log_id === call.callLogId);
  if (!sameSession && !sameLog) return null;
  if (call.telephonySessionId && saved?.telephony_session_id && !sameSession) return null;
  const observed = saved?.final_result_observed_at;
  if (observed && new Date(observed as string).getTime() > fact.observedAt.getTime()) return null;
  const start = saved?.start_time;
  const unchanged = saved?.final_result === fact.result &&
    saved?.final_result_answered === fact.answered &&
    (saved?.final_result_call_log_id ?? null) === fact.callLogId &&
    observed != null && Number.isFinite(new Date(observed as string).getTime()) &&
    start != null && Number.isFinite(new Date(start as string).getTime()) &&
    (!fact.callLogId || saved?.call_log_id === fact.callLogId);
  // A poll of identical evidence must not advance the revision or refill the outbox.
  if (unchanged) return null;
  return {
    "ringcentral.final_result": fact.result,
    "ringcentral.final_result_observed_at": fact.observedAt,
    "ringcentral.final_result_answered": fact.answered,
    ...(fact.callLogId ? {
      "ringcentral.final_result_call_log_id": fact.callLogId,
      "ringcentral.call_log_id": fact.callLogId,
    } : {}),
    ...(!start || !Number.isFinite(new Date(start as string).getTime())
      ? { "ringcentral.start_time": call.startTime } : {}),
  };
}

async function loadCall(call: FinalCallLogResultObservation, leadId?: string | null, session?: ClientSession) {
  for (const identity of [
    ...(call.telephonySessionId ? [{ "ringcentral.telephony_session_id": call.telephonySessionId }] : []),
    ...(call.callLogId ? [{ "ringcentral.call_log_id": call.callLogId }] : []),
  ]) {
    const query = getCallLeadModel().find({
      ...identity,
      ...(leadId ? { _id: new mongoose.Types.ObjectId(leadId) } : {}),
    }).limit(2);
    if (session) query.session(session);
    const found = await query.lean().exec();
    if (found.length > 1) throw new Error("Ambiguous saved RingCentral call identity");
    if (found[0]) return found[0] as StoredCall;
  }
  return null;
}

/**
 * Final Call Log replay/correction is an idempotent canonical command. The
 * result, revision, EntityChange and queued Sheet Sync intent commit together.
 * No qualification, source, duplicate, caller or Granot facts are rewritten.
 */
export async function persistRingCentralFinalCallLogResult(
  call: FinalCallLogResultObservation,
  leadId?: string | null,
  retries = 0,
): Promise<string | null> {
  if (!call.finalCallLogResult) return null;
  await connectMongo();
  const before = await loadCall(call, leadId);
  if (!before) return null;
  const id = before._id.toString();
  const patch = planRingCentralFinalResultUpdate(before, call);
  if (!patch) return id;
  const revision = Number(before.domain_revision ?? 0);
  const identity = call.telephonySessionId ?? call.callLogId!;
  const checksum = createHash("sha256").update(JSON.stringify({ id, revision, patch })).digest("hex");
  const actor = createRingCentralCallIngestActor(identity);
  const context: CanonicalCommandContext = {
    command_id: new mongoose.Types.ObjectId().toHexString(),
    idempotency_key: `ringcentral:final-result:${id}:${revision}:${checksum}`,
    payload_checksum: checksum,
    actor,
    initiator: actor,
    provenance: {
      origin: "ringcentral", run_id: null,
      source_receipt_id: identity,
      // Both transports obtained this evidence from final Detailed Call Log.
      source_connection_key: `ringcentral:call_log_sync:${identity}`,
    },
  };
  try {
    await executeCanonicalCommandWithPostCommit({
      command_name: "recordRingCentralFinalCallLogResult",
      context,
      operation: async (tx) => {
        const current = await loadCall(call, id, tx.session);
        if (!current || Number(current.domain_revision ?? 0) !== revision) {
          throw new DomainRevisionConflictError();
        }
        const currentPatch = planRingCentralFinalResultUpdate(current, call);
        if (!currentPatch) return { entity_refs: [{ model: "CallLead", id }] };
        await getCallLeadModel().updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: currentPatch }, { session: tx.session });
        await emitLeadChange({
          model: "CallLead", id, before: current,
          session: tx.session, now: tx.now,
          command_name: "recordRingCentralFinalCallLogResult",
          command_execution_id: tx.command_execution_id, context,
          paths: Object.keys(currentPatch),
        });
        const job: FullSheetSyncJob = {
          resource: "source_lead", operation: "call_lead.update", leadModel: "CallLead", leadId: id,
        };
        await persistSheetSyncIntent(job, tx.session);
        return { entity_refs: [{ model: "CallLead", id }], pending: job };
      },
      finalize: finalizeSheetSync,
    });
  } catch (error) {
    if (error instanceof DomainRevisionConflictError && retries < 2) {
      return persistRingCentralFinalCallLogResult(call, id, retries + 1);
    }
    throw error;
  }
  return id;
}
