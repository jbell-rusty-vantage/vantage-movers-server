import type { ClientSession, Types } from "mongoose";
import { getGranotObservationModel, type GranotObservationDocument } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel, type GranotObservationReceiptDocument } from "../../models/GranotObservationReceipt";
import { getSynchronizationDecisionModel, type SynchronizationDecisionDocument } from "../../models/SynchronizationDecision";

type CaseReceipt = Pick<GranotObservationReceiptDocument, "_id" | "observation_channel" | "payload">;
const observations = () => getGranotObservationModel().db.collection<GranotObservationDocument>("granot_case_observations");
const statements = () => getGranotObservationModel().db.collection<CaseReceipt>("granot_case_statements");
const decisions = () => getGranotObservationModel().db.collection<SynchronizationDecisionDocument>("granot_case_decisions");

export async function preserveCaseDecision(decision: SynchronizationDecisionDocument, session: ClientSession) {
  await decisions().updateOne({ _id: decision._id }, { $setOnInsert: decision }, { upsert: true, session });
}

/** Pin only the originals selected as case evidence. The case transaction owns the copies. */
export async function preserveCaseEvidence(observationId: Types.ObjectId, decisionId: Types.ObjectId, session: ClientSession) {
  const observation = await readCaseObservation(observationId, session);
  if (!observation) throw new Error("Cannot preserve missing Granot case observation");
  const receipt = await readCaseStatement(observation.receipt_id, session);
  if (!receipt) throw new Error("Cannot preserve missing Granot case statement");
  await observations().updateOne({ _id: observation._id }, { $setOnInsert: observation }, { upsert: true, session });
  await statements().updateOne({ _id: receipt._id }, { $setOnInsert: receipt }, { upsert: true, session });
  // Some paths attach an existing decision. Newly created decisions are pinned at insertion.
  const existing = await getSynchronizationDecisionModel().findById(decisionId).session(session).lean();
  if (existing) await preserveCaseDecision(existing, session);
}

export async function readCaseObservation(id: Types.ObjectId, session?: ClientSession) {
  return await observations().findOne({ _id: id }, { session })
    ?? await getGranotObservationModel().findById(id).session(session ?? null).lean();
}

export async function readCaseStatement(id: Types.ObjectId, session?: ClientSession) {
  return await statements().findOne({ _id: id }, { session })
    ?? await getGranotObservationReceiptModel().findById(id).select("_id observation_channel payload").session(session ?? null).lean();
}

export async function readCaseDecision(id: Types.ObjectId, session: ClientSession) {
  return await decisions().findOne({ _id: id }, { session })
    ?? await getSynchronizationDecisionModel().findById(id).session(session).lean();
}
