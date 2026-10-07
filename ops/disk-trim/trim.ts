/**
 * Disk trim (DISK-TRIM.md, 2026-10-06): stop the two logs that would fill the disk, expire what is stored,
 * and drop six leftover collections. Scope lives in `ops/lib/disk-trim.ts`; nothing here widens it.
 *
 * Dry run (default; read-only, the driver guard exits before any non-read command is sent):
 *   node --env-file=.env --import tsx ops/disk-trim/trim.ts [--report=<json path>]
 *
 * Apply (deletes, TTL index creation, drops; each re-checked against the allowlist):
 *   node --env-file=.env --import tsx ops/disk-trim/trim.ts --apply [--batch=5000] [--report=<json path>]
 *
 * Rehearsal against a loopback replica seeded with a `vantagemovers` database (never Atlas):
 *   node --env-file=.env --import tsx ops/disk-trim/trim.ts --rehearsal-uri=mongodb://127.0.0.1:27189/... [--apply]
 *
 * Refuses unless the database is `vantagemovers`. The RingCentral collection mode is read from the environment
 * the run targets (`RINGCENTRAL_COLLECTION_MODE`, the same `.env` that names the cluster); the `_test` drops are
 * refused unless it is `production` and the suffix collections took no insert in 30 days. The review-items drop
 * is refused while any `src/` file still calls `openReview(`. Never compacts the oplog, never touches
 * `vantageadmin`, never drops an index on `call_interactions`, never unsets a field on a call.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import dns from "node:dns";
import { join, resolve } from "node:path";
import { type Document, type Filter, MongoClient, ObjectId } from "mongodb";
import { getRingCentralCollectionMode } from "../../src/services/ringcentral/ringcentral-config";
import { isLoopbackMongoUri } from "../lib/loopback-mongo";
import {
  DELETE_COLLECTIONS,
  DISK_TRIM_DATABASE,
  DROP_COLLECTIONS,
  INDEX_COLLECTIONS,
  isTrimCommandAllowed,
  type ObservedIndex,
  runDiskTrim,
  summarizeTrimReport,
  type TrimCluster,
  type TrimMode,
  type TtlIndexTarget,
} from "../lib/disk-trim";

const GUARD_EXIT_CODE = 97;
const SERVER_ROOT = resolve(__dirname, "../..");
const out = (line = "") => process.stdout.write(`${line}\n`);
const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

/** Every file under `src/` that calls `openReview(` (the definition was removed with the drop). */
function openReviewCallers(root = join(SERVER_ROOT, "src")): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && readFileSync(path, "utf8").includes("openReview(")) hits.push(path.slice(SERVER_ROOT.length + 1).split("\\").join("/"));
    }
  };
  walk(root);
  return hits.sort();
}

function localHead(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: SERVER_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

class MongoTrimCluster implements TrimCluster {
  constructor(
    private readonly client: MongoClient,
    private readonly dbName: string,
    private readonly mode: TrimMode,
  ) {}
  private get db() {
    return this.client.db(this.dbName);
  }
  databaseName() {
    return this.dbName;
  }
  async replicaSetName() {
    const hello = await this.client.db("admin").command({ hello: 1 });
    return typeof hello.setName === "string" ? hello.setName : null;
  }
  async listCollections() {
    return (await this.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  }
  count(collection: string, filter: Filter<Document>) {
    return this.db.collection(collection).countDocuments(filter);
  }
  async countBy(collection: string, filter: Filter<Document>, field: string) {
    const rows = await this.db.collection(collection).aggregate([{ $match: filter }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    return Object.fromEntries(rows.map((r) => [String(r._id), Number(r.n)]));
  }
  async newestInsertAt(collection: string) {
    const [row] = await this.db.collection(collection).find({}, { projection: { _id: 1 }, sort: { _id: -1 }, limit: 1 }).toArray();
    return row?._id instanceof ObjectId ? row._id.getTimestamp() : null;
  }
  async indexes(collection: string): Promise<ObservedIndex[]> {
    const rows = await this.db.collection(collection).listIndexes().toArray();
    return rows.map((r) => ({ name: String(r.name), key: r.key as Record<string, unknown>, expireAfterSeconds: typeof r.expireAfterSeconds === "number" ? r.expireAfterSeconds : null, unique: Boolean(r.unique), partialFilterExpression: r.partialFilterExpression }));
  }
  async findIds(collection: string, filter: Filter<Document>, limit: number) {
    const rows = await this.db.collection(collection).find(filter, { projection: { _id: 1 }, sort: { _id: 1 }, limit }).toArray();
    return rows.map((r) => r._id);
  }
  async storage() {
    const s = await this.db.command({ dbStats: 1, scale: 1_048_576 });
    const mb = (v: unknown) => (typeof v === "number" ? Number(v.toFixed(1)) : null);
    return { dataMB: mb(s.dataSize) ?? 0, storageMB: mb(s.storageSize) ?? 0, indexMB: mb(s.indexSize) ?? 0, fsUsedMB: mb(s.fsUsedSize), fsTotalMB: mb(s.fsTotalSize) };
  }
  async deployment() {
    const row = await this.db.collection("sales_intelligence_sync_state").findOne({ scope: "deployment" }, { projection: { deployment_commit: 1, recorded_at: 1, vercel_deployment_id: 1 } });
    return { commit: typeof row?.deployment_commit === "string" ? row.deployment_commit : null, recorded_at: row?.recorded_at instanceof Date ? row.recorded_at.toISOString() : null, vercel_deployment_id: typeof row?.vercel_deployment_id === "string" ? row.vercel_deployment_id : null };
  }
  async stuckSheetSyncJobs() {
    const rows = await this.db.collection("sheet_sync_jobs").find({ status: "processing" }, { projection: { operation: 1, updatedAt: 1 }, sort: { _id: 1 }, limit: 50 }).toArray();
    return rows.map((r) => ({ id: String(r._id), operation: typeof r.operation === "string" ? r.operation : null, updated_at: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : null }));
  }
  async deleteByIds(collection: string, ids: unknown[], filter: Filter<Document>) {
    this.assertApply();
    if (!DELETE_COLLECTIONS.has(collection)) throw new Error(`refusing delete on ${collection}: not on the allowlist`);
    if (!ids.length) return 0;
    const result = await this.db.collection(collection).deleteMany({ $and: [{ _id: { $in: ids as ObjectId[] } }, filter] });
    return result.deletedCount;
  }
  async createIndex(collection: string, target: TtlIndexTarget) {
    this.assertApply();
    if (!INDEX_COLLECTIONS.has(collection)) throw new Error(`refusing createIndex on ${collection}: not on the allowlist`);
    await this.db.collection(collection).createIndex(target.key, { name: target.name, expireAfterSeconds: target.expireAfterSeconds });
  }
  async dropCollection(collection: string) {
    this.assertApply();
    if (!DROP_COLLECTIONS.has(collection)) throw new Error(`refusing drop of ${collection}: not on the allowlist`);
    await this.db.dropCollection(collection);
  }
  private assertApply() {
    if (this.mode !== "apply") throw new Error("mutation attempted in a dry run");
  }
}

function guardedClient(uri: string, mode: TrimMode): MongoClient {
  const client = new MongoClient(uri, { appName: `vantage-disk-trim-${mode}`, monitorCommands: true, maxPoolSize: 4, serverSelectionTimeoutMS: 15_000, readPreference: "primary", retryWrites: false });
  client.on("commandStarted", (event) => {
    if (isTrimCommandAllowed(mode, event.commandName)) return;
    process.stderr.write(`\n[disk-trim guard] refused command '${event.commandName}' on '${event.databaseName}' in ${mode} mode; exiting before it is sent.\n`);
    process.exit(GUARD_EXIT_CODE);
  });
  return client;
}

async function main() {
  const mode: TrimMode = hasFlag("apply") ? "apply" : "dry_run";
  const rehearsalUri = argValue("rehearsal-uri");
  if (rehearsalUri && !isLoopbackMongoUri(rehearsalUri)) throw new Error("--rehearsal-uri must be a loopback mongodb:// URI");
  const uri = rehearsalUri ?? (process.env.MONGO_URI ?? "").trim();
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=.env)");
  const dnsServers = (process.env.MONGO_DNS_SERVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (dnsServers.length && !rehearsalUri) dns.setServers(dnsServers);
  const batch = Number(argValue("batch") ?? 5_000);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = argValue("report") ?? join(SERVER_ROOT, "ops/output", `disk-trim-${rehearsalUri ? "rehearsal-" : ""}${mode}-${stamp}.json`);

  const client = guardedClient(uri, mode);
  await client.connect();
  try {
    const cluster = new MongoTrimCluster(client, DISK_TRIM_DATABASE, mode);
    const report = await runDiskTrim(cluster, {
      mode,
      now: () => new Date(),
      ringcentralCollectionMode: getRingCentralCollectionMode(),
      openReviewCallers: openReviewCallers(),
      localHead: localHead(),
      batch,
      log: out,
    });
    mkdirSync(resolve(reportPath, ".."), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    out();
    out(summarizeTrimReport(report));
    out(`report: ${reportPath}`);
    if (report.problems.length) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
