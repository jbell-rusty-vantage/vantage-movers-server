/**
 * Backlog for retire on use: completed Granot receipts still in MongoDB.
 *
 *   node --env-file=.env --import tsx ops/granot-retire-used-receipts.ts <new private JSON file>
 *       Dry run (default). Read-only MongoDB and no GCS request of any kind: a check that needs a
 *       verified archive read is reported as `pending_gcs_verification`.
 *   node --env-file=.env --import tsx ops/granot-retire-used-receipts.ts --apply [--limit N] <new private JSON file>
 *   (--database testvantagemovers_<x> targets a disposable test database instead of production.)
 *       Retires every used receipt through `retireReceipt` (the online pass's path), one receipt per
 *       transaction, publishing a closed-run replay where a legacy run can close. Idempotent and
 *       resumable: rerun with a new output file. Never run without Owner approval.
 *
 * Counts and bytes only: the report holds no customer data. Runbook:
 * docs/knowledge/granot-lifecycle/storage-retention-operations.md#backlog-command.
 */
import dns from "node:dns";
import { writeFile } from "node:fs/promises";
import { BSON, MongoClient, type Db, type Document, type ObjectId } from "mongodb";
import type { ArchivedChain } from "../src/services/granotHistory/archiveCodec";
import { readArchiveObject, storeArchiveObject } from "../src/services/granotHistory/archiveObjects";
import { referencedChains } from "../src/services/granotHistory/retentionReferences";
import { locatorBytes, retireReceipt, type RetireContext, type RetireResult } from "../src/services/granotHistory/retireOnUse";
import { supersededObservations } from "../src/services/granotHistory/supersededObservations";

class GcsNotRead extends Error {}
const CHANNELS = ["granot_webhook", "granot_http_automation", "browser_extension"];
type Tally = { examined: number; retirable: number; pending_gcs_verification: number; retired: number; changed: number; failures: number;
  bytes_leaving: number; locator_bytes: number; bytes_staying: number; holds: Record<string, number> };
const tally = (): Tally => ({ examined: 0, retirable: 0, pending_gcs_verification: 0, retired: 0, changed: 0, failures: 0, bytes_leaving: 0, locator_bytes: 0, bytes_staying: 0, holds: {} });

async function collectionBytes(db: Db, names: string[]) {
  const out: Record<string, Document> = {};
  for (const name of names) {
    const [stats] = await db.collection(name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
    const s = stats?.storageStats ?? {};
    out[name] = { count: s.count, logical_bytes: s.size, storage_bytes: s.storageSize, index_bytes: s.totalIndexSize };
  }
  return out;
}

/** Hot Observations and Decisions of the examined receipts, and whether the evidence pass can take them. */
async function evidenceFor(db: Db, receipts: ObjectId[]) {
  const result = { observations: 0, decisions: 0, bytes: 0, follow_evidence_pass: 0, held_referenced: 0, held_current_winner: 0, follow_bytes: 0,
    referenced_by: {} as Record<string, number> };
  for (let i = 0; i < receipts.length; i += 500) {
    const ids = receipts.slice(i, i + 500);
    const observations = await db.collection("granot_observations").find({ receipt_id: { $in: ids } }).toArray();
    const decisions = await db.collection("synchronization_decisions").find({ observation_id: { $in: observations.map((o) => o._id) } }).toArray();
    const chains: ArchivedChain[] = observations.map((observation) => ({
      observation, receipt: { _id: observation.receipt_id }, decisions: decisions.filter((d) => String(d.observation_id) === String(observation._id)),
    }));
    const held = await referencedChains(db, chains);
    const superseded = await supersededObservations(db, chains.filter((c) => c.decisions.length));
    for (const chain of chains) {
      const bytes = BSON.calculateObjectSize(chain.observation) + chain.decisions.reduce((sum, d) => sum + BSON.calculateObjectSize(d), 0);
      result.observations++;
      result.decisions += chain.decisions.length;
      result.bytes += bytes;
      const id = String(chain.observation._id);
      if (held.has(id)) {
        result.held_referenced++;
        for (const path of held.get(id)!) result.referenced_by[path] = (result.referenced_by[path] ?? 0) + 1;
      }
      else if (chain.decisions.length && !superseded.has(id)) result.held_current_winner++;
      else { result.follow_evidence_pass++; result.follow_bytes += bytes; }
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
  const databaseAt = args.indexOf("--database");
  const database = databaseAt >= 0 ? args[databaseAt + 1] : "vantagemovers";
  const output = args.filter((a, i) => !a.startsWith("--") && !["--limit", "--database"].includes(args[i - 1])).at(-1);
  if (!/^(vantagemovers|testvantagemovers(?:_[a-z0-9]+)?)$/.test(database)) throw new Error("Unexpected database");
  if (!output || !(limit > 0)) throw new Error("Expected [--apply] [--limit N] <new private JSON file>");
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map((s) => s.trim()));
  const client = new MongoClient(process.env.MONGO_URI!, { appName: "granot-retire-used-receipts", maxPoolSize: 8 });
  const db = client.db(database);
  const startedAt = new Date();
  const report: Document = { mode: apply ? "apply" : "dry_run", database: db.databaseName, started_at: startedAt };
  try {
    report.before = await collectionBytes(db, ["granot_webhook_receipts", "granot_archived_receipts", "granot_observations", "synchronization_decisions"]);
    const selector = { "processing.state": "completed", observation_channel: { $in: CHANNELS }, captured_at: { $lt: startedAt } };
    const ids = (await db.collection("granot_webhook_receipts").find(selector, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray()).map((r) => r._id);
    const ctx: RetireContext = apply
      ? { storage: await productionStorage(), closeRuns: true, now: startedAt }
      : { storage: { store: async () => { throw new GcsNotRead(); }, read: async () => { throw new GcsNotRead(); } }, now: startedAt };
    const channels: Record<string, Tally> = {};
    const leaving: ObjectId[] = [];
    let processed = 0;
    const work = ids.slice(0, Number.isFinite(limit) ? limit : undefined);
    for (let i = 0; i < work.length; i += 8) {
      await Promise.all(work.slice(i, i + 8).map(async (id) => {
        const raw = await db.collection("granot_webhook_receipts").findOne({ _id: id }, { raw: true });
        const size = Buffer.isBuffer(raw) ? raw.length : 0;
        let result: RetireResult | "pending" | "failed";
        try {
          result = await retireReceipt(db, id, ctx.storage, { dryRun: !apply, ctx });
        } catch (error) {
          result = error instanceof GcsNotRead ? "pending" : "failed";
          if (result === "failed" && !apply) throw error;
        }
        const channel = typeof result === "object" && result.channel ? result.channel : String((await db.collection("granot_webhook_receipts").findOne({ _id: id }, { projection: { observation_channel: 1 } }))?.observation_channel ?? "unknown");
        const t = (channels[channel] ??= tally());
        t.examined++;
        if (result === "pending") {
          t.pending_gcs_verification++; t.bytes_leaving += size; leaving.push(id);
          if (Buffer.isBuffer(raw)) t.locator_bytes += locatorBytes(BSON.deserialize(raw));
        }
        else if (result === "failed") { t.failures++; t.bytes_staying += size; }
        else if (result.status === "retirable" || result.status === "retired") {
          t[result.status]++; t.bytes_leaving += result.bytes; t.locator_bytes += result.locator_bytes; leaving.push(id);
        } else if (result.status === "held") { t.holds[result.reason] = (t.holds[result.reason] ?? 0) + 1; t.bytes_staying += size; }
        else t.changed++;
      }));
      processed = Math.min(work.length, i + 8);
      if (processed % 800 === 0) console.error(JSON.stringify({ processed, of: work.length }));
    }
    report.examined = work.length;
    report.channels = channels;
    // Observations and Decisions leave through the online Lead evidence pass once their receipt has left.
    report.evidence_of_leaving_receipts = await evidenceFor(db, leaving);
    if (apply) report.after = await collectionBytes(db, ["granot_webhook_receipts", "granot_archived_receipts", "granot_observations", "synchronization_decisions"]);
    report.finished_at = new Date();
    console.log(JSON.stringify(report));
    await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  } finally {
    await client.close();
  }
}

/** The production Granot history store; built lazily, so a dry run never constructs a GCS client. */
async function productionStorage() {
  return { store: storeArchiveObject, read: readArchiveObject };
}

main().catch((error) => { console.error(error.name, error.code ?? error.message); process.exitCode = 1; });
