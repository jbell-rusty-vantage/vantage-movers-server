import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import type { ClientSession, Types } from "mongoose";
import { getFormLeadModel } from "../../models/FormLead";
import { getCallLeadModel } from "../../models/CallLead";
import {
  getGranotObservationModel,
  type GranotObservationDocument,
} from "../../models/GranotObservation";
import {
  getSynchronizationDecisionModel,
  type SynchronizationDecisionDocument,
} from "../../models/SynchronizationDecision";
import { toObjectId } from "../../utils/objectId";
import type { ProcessorResult } from "./drainer";

export function acceptsLead(result?: ProcessorResult) {
  return (
    !!result &&
    (result.target?.model === "FormLead" ||
      result.target?.model === "CallLead") &&
    ["created", "linked", "applied", "already_current"].includes(result.outcome)
  );
}

export function acceptedEvidence(
  receiptId: Types.ObjectId,
  observation: Pick<
    GranotObservationDocument,
    "identity" | "priority" | "normalization_result"
  >,
  decision: Pick<
    SynchronizationDecisionDocument,
    "_id" | "outcome" | "source_scope"
  >,
) {
  return {
    version: 2,
    decision_id: decision._id,
    receipt_id: receiptId,
    outcome: decision.outcome,
    source_scope: decision.source_scope,
    normalized_job_no: observation.identity?.normalized_job_no,
    normalization_result: observation.normalization_result,
    priority: observation.priority,
  };
}

/** Called inside the transaction that fences and completes the receipt. Replacing a temporal
 * winner replaces its whole nested document, so a later winner never inherits an older proof. */
export async function certifyAcceptedLead(
  receiptId: Types.ObjectId,
  result: ProcessorResult,
  session: ClientSession,
) {
  if (!acceptsLead(result) || !result.target) return;
  const decision = await getSynchronizationDecisionModel()
    .findOne({ observation_id: toObjectId(result.observation_id) })
    .sort({ attempt: -1 })
    .select("observation_id target source_scope outcome execution_mode")
    .session(session)
    .lean();
  if (
    !decision ||
    String(decision._id) !== result.decision_id ||
    decision.execution_mode !== "live" ||
    !decision.source_scope ||
    decision.outcome !== result.outcome ||
    String(decision.observation_id) !== result.observation_id ||
    decision.target?.model !== result.target.model ||
    decision.target.id !== result.target.id
  )
    return;
  const observation = await getGranotObservationModel()
    .findOne({ _id: decision.observation_id, receipt_id: receiptId })
    .select(
      "captured_at identity.normalized_job_no normalization_result priority.valid priority.canonical",
    )
    .session(session)
    .lean();
  if (!observation) return;
  const filter = {
    _id: toObjectId(result.target.id),
    "last_accepted_granot_observation.observation_id": observation._id,
    "last_accepted_granot_observation.captured_at": observation.captured_at,
  };
  const proof = acceptedEvidence(receiptId, observation, decision);
  const update = {
    $set: { "last_accepted_granot_observation.evidence": proof },
  };
  const options = { session, timestamps: false };
  const changed =
    result.target.model === "FormLead"
      ? await getFormLeadModel().updateOne(filter, update, options)
      : await getCallLeadModel().updateOne(filter, update, options);
  if (changed.matchedCount) {
    const fenced =
      await getGranotObservationReceiptModel().collection.updateOne(
        {
          _id: receiptId,
          "processing.state": "completed",
          "processing.latest_decision_id": decision._id,
        },
        {
          $set: {
            "processing.certified_lead": {
              model: result.target.model,
              id: filter._id,
              decision_id: decision._id,
            },
          },
        },
        { session },
      );
    if (!fenced.matchedCount)
      throw new Error("Granot acceptance changed during certification");
  }
}
