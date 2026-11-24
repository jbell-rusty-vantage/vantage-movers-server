/**
 * Read-only review of Owner decision 8 (proven-winner release). Writes nothing to MongoDB or GCS:
 *   node --env-file=.env --import tsx ops/granot-proven-winner-review.ts
 * Scans every Observation page as the retention pass would and reports what it releases with the
 * `proven-winner-release-v1` switch off and on, the bytes that leave MongoDB, the receipt objects
 * whose `observation_hot` block lifts, and how many current winners carry the v2 proof.
 */
import dns from "node:dns";
import { BSON, MongoClient, type Db, type ObjectId } from "mongodb";
import { reviewLeadEvidence } from "../src/services/granotHistory/retireLeadEvidence";
import { PROVEN_WINNER_CONTROL } from "../src/services/granotHistory/provenWinners";

async function proofCoverage(db: Db) {
  const out: Record<string, Record<string, number>> = {};
  for (const [model, name] of [["FormLead", "form_leads"], ["CallLead", "call_leads"]] as const) {
    const rows = await db.collection(name).aggregate([
      { $match: { "last_accepted_granot_observation.observation_id": { $exists: true } } },
      { $lookup: { from: "granot_observations", localField: "last_accepted_granot_observation.observation_id", foreignField: "_id", as: "hot", pipeline: [{ $project: { _id: 1 } }] } },
      { $group: {
        _id: { hot: { $gt: [{ $size: "$hot" }, 0] }, proven: { $eq: ["$last_accepted_granot_observation.evidence.version", 2] } },
        n: { $sum: 1 },
      } },
    ], { maxTimeMS: 60_000 }).toArray();
    out[model] = Object.fromEntries(rows.map((r) => [(r._id.hot ? "hot" : "retired") + "_" + (r._id.proven ? "proven" : "unproven"), r.n]));
  }
  return out;
}

async function main() {
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map((x) => x.trim()));
  const client = new MongoClient(process.env.MONGO_URI!, { maxPoolSize: 2, appName: "granot-proven-winner-review", readPreference: "secondaryPreferred" });
  try {
    const db = client.db("vantagemovers"), started = new Date();
    const totals = { observations: 0, eligible: 0, today: 0, proven: 0, released_observations_bytes: 0, released_decisions: 0,
      released_decisions_bytes: 0, receipt_objects_unblocked: 0, hot_receipts: 0 };
    let after: ObjectId | undefined;
    for (;;) {
      const page = await db.collection("granot_observations").find(after ? { _id: { $gt: after } } : {}).sort({ _id: 1 }).limit(192).toArray();
      if (!page.length) break;
      after = page.at(-1)!._id;
      const { eligible, today, proven } = await reviewLeadEvidence(db, page);
      const before = new Set(today.map((r) => String(r.chain.observation._id)));
      totals.observations += page.length;
      totals.eligible += eligible.length;
      totals.today += today.length;
      totals.proven += proven.length;
      for (const row of proven) {
        if (before.has(String(row.chain.observation._id))) continue;
        totals.released_observations_bytes += BSON.calculateObjectSize(row.chain.observation);
        totals.released_decisions += row.chain.decisions.length;
        totals.released_decisions_bytes += row.chain.decisions.reduce((n, d) => n + BSON.calculateObjectSize(d), 0);
        // A retired receipt's own object is blocked by `observation_hot` until its Observation leaves.
        if (row.cold && row.header.hash) totals.receipt_objects_unblocked++;
        if (!row.cold) totals.hot_receipts++;
      }
    }
    console.log(JSON.stringify({
      at: started, read_only: true,
      switch: await db.collection("granot_retention_control").findOne({ _id: PROVEN_WINNER_CONTROL as never }),
      ...totals,
      newly_releasable: totals.proven - totals.today,
      proof_coverage: await proofCoverage(db),
    }, null, 2));
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e.name, e.code ?? e.message);
  process.exitCode = 1;
});
