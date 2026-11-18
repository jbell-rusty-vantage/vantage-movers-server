import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { preserveCaseEvidence, readCaseDecision, readCaseObservation, readCaseStatement } from "../src/services/granotLifecycle/caseEvidence";
import { getGranotBookingReconciliationCaseModel } from "../src/models/GranotBookingReconciliationCase";
import { getGranotReleaseReconciliationCaseModel } from "../src/models/GranotReleaseReconciliationCase";
import { getGranotBookingDiscrepancyModel } from "../src/models/GranotBookingDiscrepancy";
import { getGranotReleaseDiscrepancyModel } from "../src/models/GranotReleaseDiscrepancy";

const sources = {
  booking: getGranotBookingReconciliationCaseModel, release: getGranotReleaseReconciliationCaseModel,
  booking_discrepancy: getGranotBookingDiscrepancyModel, release_discrepancy: getGranotReleaseDiscrepancyModel,
};
async function main() {
  const [mode, kind, after = "", limitText = "20"] = process.argv.slice(2);
  const limit = Number(limitText);
  if (!["--review", "--apply"].includes(mode) || (kind !== "all" && !Object.hasOwn(sources, kind))
    || (after && !/^[0-9a-f]{24}$/i.test(after)) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Expected --review|--apply, case kind, optional exclusive ObjectId cursor and limit");
  }
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  for (const key of (kind === "all" ? Object.keys(sources) : [kind])) {
    let cursor = after;
    do {
      const result = await scanPage(mode, key as keyof typeof sources, cursor, limit);
      console.log(JSON.stringify(result));
      cursor = result.next ?? "";
    } while (kind === "all" && cursor);
  }
}
async function scanPage(mode: string, kind: keyof typeof sources, after: string, limit: number) {
  const collection = sources[kind]().collection;
  const rows = await collection.find(after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {},
    { projection: { evidence: 1 } }).sort({ _id: 1 }).limit(limit).maxTimeMS(3000).toArray();
  const counts: Record<string, number> = {};
  const evidence = rows.flatMap(row => row.evidence ?? []);
  const db = mongoose.connection.db!;
  const pinnedObservations = await db.collection("granot_case_observations").find(
    { _id: { $in: evidence.map(item => item.observation_id) } }, { projection: { receipt_id: 1 } }).toArray();
  const pinnedReceipts = new Set((await db.collection("granot_case_statements").find(
    { _id: { $in: pinnedObservations.map(row => row.receipt_id) } }, { projection: { _id: 1 } }).toArray()).map(row => String(row._id)));
  const completeObservations = new Set(pinnedObservations.filter(row => pinnedReceipts.has(String(row.receipt_id))).map(row => String(row._id)));
  const decisions = new Map((await db.collection("granot_case_decisions").find(
    { _id: { $in: evidence.map(item => item.decision_id) } }, { projection: { observation_id: 1 } }).toArray())
    .map(row => [String(row._id), String(row.observation_id)]));
  for (const row of rows) {
    for (const item of row.evidence ?? []) {
      if (completeObservations.has(String(item.observation_id)) && decisions.get(String(item.decision_id)) === String(item.observation_id)) {
        counts.already_pinned = (counts.already_pinned ?? 0) + 1;
        continue;
      }
      const state = await withTransaction(async session => {
        const obs = await readCaseObservation(item.observation_id, session);
        if (!obs) return "missing_observation";
        const receipt = await readCaseStatement(obs.receipt_id, session);
        if (!receipt) return "missing_receipt";
        const decision = await readCaseDecision(item.decision_id, session);
        if (!decision || !decision.observation_id.equals(obs._id)) return "missing_or_mismatched_decision";
        if (mode === "--review") return "source_chain_present";
        await preserveCaseEvidence(obs._id, item.decision_id, session);
        return "pinned";
      });
      counts[state] = (counts[state] ?? 0) + 1;
    }
  }
  return { mode, kind, scanned: rows.length, counts, next: rows.length === limit ? String(rows.at(-1)!._id) : null };
}
main().catch(err => { console.error(err.name, err.code ?? "case_backfill_failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
