/** Backfill only current Lead winners. Each transaction rechecks the receipt and Lead. */
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getCallLeadModel } from "../src/models/CallLead";
import { getFormLeadModel } from "../src/models/FormLead";
import { getGranotObservationModel } from "../src/models/GranotObservation";
import { getGranotObservationReceiptModel } from "../src/models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../src/models/SynchronizationDecision";
import { certifyAcceptedLead } from "../src/services/granotLifecycle/acceptedLeadEvidence";

async function main() {
  const args = process.argv.slice(2);
  const [mode, kind, after = "", limitText = "100"] = args;
  const limit = Number(limitText);
  if (!["--review", "--apply"].includes(mode) || !["FormLead", "CallLead"].includes(kind)
    || args.length > 4 || (after && !/^[0-9a-f]{24}$/i.test(after)) || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Usage: --review|--apply FormLead|CallLead [afterObjectId] [limit 1..500]");
  }
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  if (mongoose.connection.name !== getMongoDatabaseName()) throw new Error("Unexpected database");
  const leads = kind === "FormLead" ? getFormLeadModel().collection : getCallLeadModel().collection;
  const filter = after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {};
  const rows = await leads.find(filter, { projection: { last_accepted_granot_observation: 1 } })
    .sort({ _id: 1 }).limit(limit).maxTimeMS(3000).toArray();
  const counts: Record<string, number> = {};
  for (const lead of rows) {
    const winner = lead.last_accepted_granot_observation;
    const state = !winner?.observation_id ? "no_winner" : await withTransaction(async session => {
      const observation = await getGranotObservationModel().findById(winner.observation_id)
        .select("receipt_id captured_at").session(session).lean();
      if (!observation || +observation.captured_at !== +winner.captured_at) return "observation_unavailable";
      const receipt = await getGranotObservationReceiptModel().findById(observation.receipt_id)
        .select("processing.state processing.latest_decision_id").session(session).lean();
      if (receipt?.processing.state !== "completed") return "incomplete_receipt";
      const decision = await getSynchronizationDecisionModel().findOne({ observation_id: observation._id })
        .sort({ attempt: -1 }).select("execution_mode source_scope outcome target").session(session).lean();
      if (!decision || !decision.source_scope || decision.execution_mode !== "live"
        || String(decision._id) !== String(receipt.processing.latest_decision_id)
        || decision.target?.model !== kind || decision.target.id !== String(lead._id)
        || !["created", "linked", "applied", "already_current"].includes(decision.outcome)) return "no_accepted_decision";
      if (winner.evidence?.version === 2 && String(winner.evidence?.decision_id) === String(decision._id)) return "already_certified";
      if (mode === "--review") return "certifiable_at_read";
      await certifyAcceptedLead(receipt._id, { target: decision.target, decision_id: String(decision._id),
        observation_id: String(observation._id), outcome: decision.outcome, effects: [] }, session);
      const confirmed = await leads.findOne({ _id: lead._id, "last_accepted_granot_observation.evidence.decision_id": decision._id }, { session, projection: { _id: 1 } });
      return confirmed ? "certified" : "winner_changed";
    });
    counts[state] = (counts[state] ?? 0) + 1;
  }
  console.log(JSON.stringify({ mode, kind, database: getMongoDatabaseName(), scanned: rows.length, counts,
    next: rows.length === limit ? String(rows.at(-1)!._id) : null }));
}
main().catch(error => { console.error(error.name, error.code ?? "backfill_failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
