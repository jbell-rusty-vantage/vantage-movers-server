import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { connectMongo, withTransaction } from "../src/db";
import { inspectPoolCandidates } from "../src/services/salesOutreach/pool/admission";
import { getSalesOutreachPoolWorkModel } from "../src/models/salesOutreach";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { readGranotDecision, readGranotObservation } from "../src/services/granotHistory/retiredRecords";
import { jobNumbersEquivalent } from "../src/services/bookings/bookingIdentity";

type Ref = { model: "FormLead" | "CallLead"; id: string };

/**
 * A winner retired by the proven-winner release (Owner decision 8) is no longer hot, so the history
 * read cannot see it. Compare its v2 proof with the Observation and Decision read back from GCS by
 * original ID, outside any transaction. `expired` means past its 90-day end of life: nothing to compare.
 * `unproven` means a repoint later removed the proof; Pool refuses that Lead (fail-closed), so it is not a mismatch.
 */
async function verifyRetiredWinners(refs: Ref[]) {
  const db = mongoose.connection.db!;
  const counts = { retired: 0, verified: 0, mismatches: 0, expired: 0, unproven: 0 };
  const hot = new Set<string>();
  const winners = new Map<string, { observation_id: unknown; captured_at: Date; evidence?: unknown }>();
  for (const [model, Model] of [["FormLead", getFormLeadModel()], ["CallLead", getCallLeadModel()]] as const) {
    const ids = refs.filter((r) => r.model === model).map((r) => new mongoose.Types.ObjectId(r.id));
    if (!ids.length) continue;
    const rows = await Model.collection.find({ _id: { $in: ids } }, { projection: { last_accepted_granot_observation: 1 } }).toArray();
    for (const row of rows) if (row.last_accepted_granot_observation) winners.set(`${model}:${String(row._id)}`, row.last_accepted_granot_observation);
  }
  const observationIds = [...winners.values()].map((w) => w.observation_id);
  for (const row of await db.collection("granot_observations").find({ _id: { $in: observationIds as never[] } }, { projection: { _id: 1 } }).toArray()) hot.add(String(row._id));
  const remaining: Ref[] = [];
  for (const ref of refs) {
    const winner = winners.get(`${ref.model}:${ref.id}`);
    if (!winner || hot.has(String(winner.observation_id))) {
      remaining.push(ref);
      continue;
    }
    counts.retired++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Mixed proof
    const proof = winner.evidence as Record<string, any> | undefined;
    if (proof?.version !== 2) {
      counts.unproven++;
      continue;
    }
    const observation = await readGranotObservation(db, winner.observation_id as never);
    const decision = proof.decision_id ? await readGranotDecision(db, proof.decision_id) : null;
    if (!observation && !decision) {
      counts.expired++;
      continue;
    }
    const same = observation && decision &&
      +observation.captured_at === +winner.captured_at &&
      String(decision.observation_id) === String(observation._id) &&
      decision.execution_mode === "live" && decision.outcome === proof.outcome &&
      decision.target?.model === ref.model && String(decision.target?.id) === ref.id &&
      String(decision.source_scope?.granot_crm_source_id) === String(proof.source_scope?.granot_crm_source_id) &&
      String(decision.source_scope?.source_granularity_id) === String(proof.source_scope?.source_granularity_id) &&
      String(decision.source_scope?.lead_source_company) === String(proof.source_scope?.lead_source_company) &&
      observation.normalization_result === proof.normalization_result &&
      observation.priority?.valid === proof.priority?.valid && observation.priority?.canonical === proof.priority?.canonical &&
      jobNumbersEquivalent(observation.identity?.normalized_job_no, proof.normalized_job_no);
    if (same) counts.verified++;
    else counts.mismatches++;
  }
  return { counts, remaining };
}

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  const work = await getSalesOutreachPoolWorkModel()
    .find({ active: true })
    .select("lead_model lead_id")
    .sort({ _id: 1 })
    .lean();
  let checked = 0,
    eligible = 0,
    mismatches = 0;
  const retired = { retired: 0, verified: 0, mismatches: 0, expired: 0, unproven: 0 };
  for (let i = 0; i < work.length; i += 64) {
    const batch = work
      .slice(i, i + 64)
      .map((w) => ({ model: w.lead_model, id: String(w.lead_id) }) as Ref);
    const archived = await verifyRetiredWinners(batch);
    for (const k of Object.keys(retired) as (keyof typeof retired)[]) retired[k] += archived.counts[k];
    const refs = archived.remaining;
    const result = refs.length ? await withTransaction(async (session) => {
      const current = await inspectPoolCandidates(refs, session, "current"),
        historical = await inspectPoolCandidates(refs, session, "history");
      return {
        eligible: current.filter((c) => c.eligible).length,
        mismatches: current.filter(
          (c, j) => !isDeepStrictEqual(c, historical[j]),
        ).length,
      };
    }) : { eligible: 0, mismatches: 0 };
    checked += batch.length;
    eligible += result.eligible;
    mismatches += result.mismatches;
  }
  console.log(
    JSON.stringify({ at: new Date(), checked, eligible, mismatches, retired_winners: retired }),
  );
  if (mismatches || retired.mismatches) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e.name, e.code ?? "comparison_failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
