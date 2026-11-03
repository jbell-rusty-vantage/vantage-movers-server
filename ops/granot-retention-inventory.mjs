/** Read-only first pass. Counts an upper bound, never deletion clearance. */
import { MongoClient } from "mongodb";
import dns from "node:dns";
const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI is required");
if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map(s => s.trim()).filter(Boolean));
const client = new MongoClient(uri, { maxPoolSize: 1, appName: "granot-retention-inventory", serverSelectionTimeoutMS: 8000 });
try {
  const decisions = client.db("vantagemovers").collection("synchronization_decisions");
  const before = new Date(Date.now() - 7 * 86400000);
  const filter = { outcome: "already_current", decided_at: { $lt: before } };
  const count = await decisions.countDocuments(filter, {
    hint: "synchronization_decision_outcome_decided", maxTimeMS: 3000,
  });
  console.log(JSON.stringify({
    captured_at: new Date(), decided_before: before, outcome: filter.outcome,
    decisions_in_scope_for_review: count, cleared_for_deletion: 0,
    outstanding_checks: ["terminal receipt", "accepted Lead evidence", "case and timeline evidence", "replay and recovery", "archive restoration"],
  }, null, 2));
} finally {
  await client.close();
}
