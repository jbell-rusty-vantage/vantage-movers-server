import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { preserveCaseEvidence } from "../src/services/granotLifecycle/caseEvidence";
import { getGranotBookingReconciliationCaseModel } from "../src/models/GranotBookingReconciliationCase";
import { getGranotReleaseReconciliationCaseModel } from "../src/models/GranotReleaseReconciliationCase";
import { getGranotBookingDiscrepancyModel } from "../src/models/GranotBookingDiscrepancy";
import { getGranotReleaseDiscrepancyModel } from "../src/models/GranotReleaseDiscrepancy";
import { getGranotObservationModel } from "../src/models/GranotObservation";
import { getGranotObservationReceiptModel } from "../src/models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../src/models/SynchronizationDecision";

const sources = {
  booking: getGranotBookingReconciliationCaseModel, release: getGranotReleaseReconciliationCaseModel,
  booking_discrepancy: getGranotBookingDiscrepancyModel, release_discrepancy: getGranotReleaseDiscrepancyModel,
};
async function main() {
  const [mode, kind, after = "", limitText = "20"] = process.argv.slice(2);
  const limit = Number(limitText);
  if (!["--review", "--apply"].includes(mode) || !Object.hasOwn(sources, kind)
    || (after && !/^[0-9a-f]{24}$/i.test(after)) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Expected --review|--apply, case kind, optional exclusive ObjectId cursor and limit");
  }
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  const collection = sources[kind as keyof typeof sources]().collection;
  const rows = await collection.find(after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {},
    { projection: { evidence: 1 } }).sort({ _id: 1 }).limit(limit).maxTimeMS(3000).toArray();
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const item of row.evidence ?? []) {
      const state = await withTransaction(async session => {
        const obs = await getGranotObservationModel().findById(item.observation_id).select("receipt_id").session(session).lean();
        if (!obs) return "missing_observation";
        const receipt = await getGranotObservationReceiptModel().exists({ _id: obs.receipt_id }).session(session);
        if (!receipt) return "missing_receipt";
        const decision = await getSynchronizationDecisionModel().exists({ _id: item.decision_id, observation_id: obs._id }).session(session);
        if (!decision) return "missing_or_mismatched_decision";
        if (mode === "--review") return "source_chain_present";
        await preserveCaseEvidence(obs._id, item.decision_id, session);
        return "pinned";
      });
      counts[state] = (counts[state] ?? 0) + 1;
    }
  }
  console.log(JSON.stringify({ mode, kind, scanned: rows.length, counts, next: rows.length === limit ? String(rows.at(-1)!._id) : null }));
}
main().catch(err => { console.error(err.name, err.code ?? "case_backfill_failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
