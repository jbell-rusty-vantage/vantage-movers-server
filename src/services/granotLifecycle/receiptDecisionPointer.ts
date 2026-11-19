import { archivedReceipts, webhookReceiptFormat } from "../granotHistory/completedWebhooks";
import type { ClientSession, Types } from "mongoose";
import { withTransaction } from "../../db";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getFormLeadModel } from "../../models/FormLead";
import { getCallLeadModel } from "../../models/CallLead";

/** Reconciliation can replace a completed receipt's decision long after its first acceptance. */
export async function pointReceiptToDecision(id: Types.ObjectId, next: Types.ObjectId, session?: ClientSession) {
  const receipts = getGranotObservationReceiptModel().collection;
  const update = { $set: { "processing.latest_decision_id": next } };
  const quick = await receipts.updateOne({ _id:id, $or: [
    { "processing.certified_lead": { $exists:false } }, { "processing.certified_lead.decision_id":next },
  ] },update,{session});
  if (quick.matchedCount) return;
  const replace = async (txn: ClientSession) => {
    const opts = {session:txn,projection:{"processing.certified_lead":1}};
    const hot = await receipts.findOne({_id:id}, opts);
    const cold = archivedReceipts(getGranotObservationReceiptModel().db.db!);
    const receipt = hot ?? await cold.findOne({_id:id,format:webhookReceiptFormat}, opts);
    const source = hot ? receipts : cold;
    if (!receipt) return;
    const owner = receipt.processing?.certified_lead;
    if (owner && String(owner.decision_id) !== String(next)) {
      const model = owner.model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
      await model.collection.updateOne({ _id:owner.id, "last_accepted_granot_observation.evidence.decision_id":owner.decision_id },
        { $unset: { "last_accepted_granot_observation.evidence":1 } },{session:txn});
      await source.updateOne({_id:id},{...update,$unset:{"processing.certified_lead":1}},{session:txn});
    } else await source.updateOne({_id:id},update,{session:txn});
  };
  return session ? replace(session) : withTransaction(replace);
}
