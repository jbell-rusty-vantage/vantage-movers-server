/** Additive, bounded archival of routine automation history. No source documents are mutated. */
import { MongoClient, type Db, type Document, type ObjectId } from "mongodb";
import dns from "node:dns";
import { encodeChains, type ArchivedChain } from "../src/services/granotHistory/archiveCodec";
import { publishArchiveChunk } from "../src/services/granotHistory/publishArchiveChunk";
import { archiveCatalog } from "../src/services/granotHistory/archiveReads";

async function candidateChains(db: Db, job: string, cutoff: Date) {
  const observations = await db.collection("granot_observations")
    .find({ "identity.normalized_job_no": job, captured_at: { $lt: cutoff } }).sort({ captured_at: -1 }).limit(128).maxTimeMS(3000).toArray();
  const ids = observations.map(row => row._id);
  if (!ids.length) return [];
  const decisions = await db.collection("synchronization_decisions").find({ observation_id: { $in: ids } }).maxTimeMS(3000).toArray();
  const receipts = await db.collection("granot_webhook_receipts").find({ _id: { $in: observations.map(o => o.receipt_id) } }).maxTimeMS(3000).toArray();
  const receiptsById = new Map(receipts.map(r => [String(r._id), r]));
  const attempts = new Map<string, Document[]>();
  for (const d of decisions) {
    const id = String(d.observation_id);
    const group = attempts.get(id) ?? [];
    group.push(d);
    attempts.set(id, group);
  }
  const chains: ArchivedChain[] = [];
  for (const o of observations) {
    const receipt = receiptsById.get(String(o.receipt_id)), ds = attempts.get(String(o._id)) ?? [], d = ds[0];
    if (!receipt || receipt.observation_channel !== "granot_http_automation" || !/^[0-9a-f]{24}:.+/i.test(receipt.channel_operation_id ?? "")
      || receipt.processing?.state !== "completed" || !(receipt.processing.completed_at instanceof Date) || receipt.processing.completed_at >= cutoff
      || ds.length !== 1 || d.execution_mode !== "live" || d.outcome !== "already_current" || d.effects?.length
      || !(d.decided_at instanceof Date) || d.decided_at >= cutoff || String(d._id) !== String(receipt.processing.latest_decision_id)) continue;
    chains.push({ observation: o, receipt, decisions: ds });
  }
  return chains.sort((a,b) => String(a.observation._id).localeCompare(String(b.observation._id)));
}

async function main() {
  const [mode, limitText = "4", asOfText] = process.argv.slice(2), limit = Number(limitText);
  const asOf = asOfText ? new Date(asOfText) : new Date();
  if ((mode === "--publish" && !asOfText) || !Number.isFinite(+asOf) || +asOf > Date.now()) throw new Error("Publishing requires the review timestamp");
  if (!["--review","--publish"].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("Expected --review|--publish and job limit 1..32");
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map(x=>x.trim()));
  const client = new MongoClient(process.env.MONGO_URI!, { maxPoolSize: 1, appName: "granot-history-archive" });
  try {
    const db = client.db("vantagemovers"), cutoff = new Date(+asOf - 7 * 86400000);
    const seeds = await db.collection("synchronization_decisions").find({ outcome: "already_current", decided_at: { $lt: cutoff } },
      { projection: { observation_id: 1 } }).sort({ decided_at: -1 }).hint("synchronization_decision_outcome_decided").limit(128).maxTimeMS(3000).toArray();
    const observations = await db.collection("granot_observations").find({ _id: { $in: seeds.map(s => s.observation_id as ObjectId) } },
      { projection: { "identity.normalized_job_no": 1 } }).maxTimeMS(3000).toArray();
    const jobByObservation = new Map(observations.map(o => [String(o._id), o.identity?.normalized_job_no]));
    const jobs = [...new Set(seeds.map(s => jobByObservation.get(String(s.observation_id))).filter((j): j is string => typeof j === "string" && !!j))].slice(0,limit);
    if (mode === "--publish") await archiveCatalog(db).createIndex({ job_key: 1, newest: -1 }, { name: "granot_archive_job_newest" });
    let count=0, bytes=0, chunks=0;
    for (const job of jobs) {
      const chains = await candidateChains(db, job, cutoff);
      if (chains.length < 2) continue;
      bytes += encodeChains(job, chains).length;
      if (mode === "--publish") await publishArchiveChunk(db,job,chains);
      count += chains.length;
      chunks++;
    }
    console.log(JSON.stringify({mode,asOf,jobsExamined:jobs.length,chunks,chains:count,compressedBytes:bytes,clearedForDeletion:0}));
  } finally { await client.close(); }
}
main().catch(e=>{console.error(e.name,e.code ?? "archive_failed");process.exitCode=1;});
