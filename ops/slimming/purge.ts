/**
 * SLIM-10 exact purge of the slimming deletion manifest.
 *
 * Dry run (default; read-only: the inventory's driver guard, nothing but reads and Blob `list`):
 *   node --import tsx ops/slimming/purge.ts [--report=<json path>]
 *
 * Apply (only after the slim server and Admin are deployed and quiesced, and the manifest was regenerated):
 *   node --import tsx ops/slimming/purge.ts --apply --manifest-hash=<sha256> --backup-dir=<dir outside the repo> \
 *     --i-confirm-slim-deployed [--batch=500] [--skip-blob-backup] [--resume=<run dir>]
 *
 * Steps, each verified, aborting on the first mismatch:
 *   (a) assert cluster, database names, collection UUIDs and counts against `deletion-manifest.json`, the
 *       deployed server commit, and that no legacy job holds a live lease;
 *   (b) back up every drop target, every historical collection, every document a cleanup touches and every Blob
 *       key (gzipped canonical EJSON / raw files, counts + sha256, read back) under the backup dir;
 *   (c) run the targeted cleanups in bounded, checkpointed, idempotent `_id` batches;
 *   (d) delete the exact Blob keys of the manifest;
 *   (e) drop the exact collections (UUID and count re-asserted immediately before each drop);
 *   (f) drop the exact database `vantagemovershistorical`;
 *   (g) verify targets absent and protected namespaces present; print before/after statistics.
 *
 * Never a prefix, wildcard or "unused collections" sweep: every namespace, scope and key comes from the hashed
 * manifest, and `assertManifestInvariants` refuses a manifest that names a protected namespace or database.
 * `--resume=<run dir>` continues an interrupted apply from its `purge-log.json` (same manifest hash only). A drop
 * target already absent on resume (a crash between the drop and its log write) counts as dropped once this run's
 * backup of it verifies on disk. Blob backups are checked on disk (stat size vs listing, sha256 vs stream), and any
 * object under `conversations/` that the manifest does not list is a problem in step (a) and step (g).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Document, Filter, ObjectId } from "mongodb";
import { type BackupEntry, verifyBackupFile, verifyBlobBackupFile, writeBackupFile } from "./lib/backup";
import { deleteBlobKeys, downloadBlob, listBlobs } from "./lib/blob";
import { argValue, clusterFingerprint, hasFlag, loadSlimmingEnv, type SlimmingEnv } from "./lib/env";
import { PurgeCluster, ReadOnlyCluster } from "./lib/guarded-mongo";
import { type Manifest, MANIFEST_PATH, canonicalJson, dropCountMatches, loadBlobKeys, loadManifest, sha256 } from "./lib/manifest";
import {
  PurgeAbort,
  assertBackupDir,
  cleanupFilter,
  deploymentProblems,
  liveLeaseFilter,
  terminalJobsFilter,
  terminalizeFilter,
  manifestPolicyDrift,
  unlistedBlobProblems,
  verifiedFullBackupProblem,
} from "./lib/purge-rules";
import { FORBIDDEN_DATABASE_DROPS, HISTORICAL_DATABASE } from "./policy";

type RunLog = {
  manifest_hash: string;
  started_at: string;
  steps: Array<{ step: string; at: string; detail: Document }>;
  backup_done: boolean;
  backups: BackupEntry[];
  cleanups_done: string[];
  checkpoints: Record<string, { last_id: string | null; processed: number }>;
  blob_done: boolean;
  dropped: string[];
  database_dropped: boolean;
  finished_at: string | null;
};

const out = (line = "") => process.stdout.write(`${line}\n`);
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const ns = (db: string, name: string) => `${db}.${name}`;

async function assertState(
  c: ReadOnlyCluster,
  manifest: Manifest,
  env: SlimmingEnv,
  blobKeys: string[],
  log: RunLog | null,
): Promise<{ problems: string[]; facts: Document }> {
  const t = manifest.targets;
  const problems: string[] = [];
  const facts: Document = {};
  const dropped = new Set(log?.dropped ?? []);

  const fingerprint = clusterFingerprint(env.serverMongoUri);
  if (fingerprint !== t.cluster.fingerprint) problems.push(`cluster fingerprint ${fingerprint} != manifest ${t.cluster.fingerprint}`);
  const rs = await c.replicaSetName();
  if (rs !== t.cluster.replica_set) problems.push(`replica set ${rs} != manifest ${t.cluster.replica_set}`);
  if (env.adminAuthDbName && env.adminAuthDbName !== t.admin_auth_database) problems.push(`ADMIN_AUTH_DB_NAME ${env.adminAuthDbName} != manifest ${t.admin_auth_database}`);
  if (env.adminMongoUri && clusterFingerprint(env.adminMongoUri) !== fingerprint) problems.push("Admin MONGODB_URI is a different cluster");

  const databases = await c.listDatabases();
  for (const db of [t.main_database, t.admin_auth_database]) if (!databases.some((d) => d.name === db)) problems.push(`database ${db} is missing`);

  facts.drop_collections = [];
  for (const target of t.drop_collections) {
    const key = ns(target.db, target.name);
    const info = await c.collection(target.db, target.name);
    if (!info) {
      if (!dropped.has(key)) problems.push(`${key} is absent but not recorded as dropped by this run`);
      (facts.drop_collections as Document[]).push({ namespace: key, live: "absent" });
      continue;
    }
    if (dropped.has(key)) problems.push(`${key} was dropped by this run and exists again (recreated by a writer)`);
    const count = await c.count(target.db, target.name);
    if (info.uuid !== target.uuid) problems.push(`${key} UUID ${info.uuid} != manifest ${target.uuid}`);
    if (!dropCountMatches(target, count)) problems.push(`${key} has ${count} documents, manifest ${target.count} (a writer is still active or the manifest is stale)`);
    (facts.drop_collections as Document[]).push({ namespace: key, live_count: count, manifest_count: target.count, storage: mb(target.storage_size + target.index_size) });
  }
  for (const absent of t.absent_targets)
    if (await c.collection(absent.db, absent.name)) problems.push(`${ns(absent.db, absent.name)} was absent in the manifest and now exists (recreated by a writer)`);

  for (const db of t.drop_databases) {
    if ((FORBIDDEN_DATABASE_DROPS as readonly string[]).includes(db.name) || db.name !== HISTORICAL_DATABASE) throw new PurgeAbort(`refusing database target ${db.name}`);
    if (!databases.some((d) => d.name === db.name)) {
      if (!log?.database_dropped) problems.push(`${db.name} is absent but not recorded as dropped by this run`);
      continue;
    }
    if (log?.database_dropped) problems.push(`${db.name} was dropped by this run and exists again`);
    const live = await c.listCollections(db.name);
    const shape = (rows: Array<{ name: string; uuid: string | null }>) => canonicalJson(rows.map((r) => ({ name: r.name, uuid: r.uuid })).sort((a, b) => a.name.localeCompare(b.name)));
    if (shape(live) !== shape(db.collections)) problems.push(`${db.name} collection/UUID set differs from the manifest`);
    for (const col of db.collections) {
      const count = live.some((l) => l.name === col.name) ? await c.count(db.name, col.name) : -1;
      if (count !== col.count) problems.push(`${ns(db.name, col.name)} has ${count} documents, manifest ${col.count}`);
    }
  }

  facts.protected = [];
  for (const p of t.protected) {
    const info = await c.collection(p.db, p.name);
    if (!info) {
      if (p.uuid) problems.push(`protected ${ns(p.db, p.name)} is missing`);
      continue;
    }
    if (p.uuid && info.uuid !== p.uuid) problems.push(`protected ${ns(p.db, p.name)} UUID changed (${info.uuid} != ${p.uuid})`);
    (facts.protected as Document[]).push({ namespace: ns(p.db, p.name), count: await c.count(p.db, p.name) });
  }

  const now = new Date();
  facts.cleanups = [];
  for (const cleanup of t.cleanups) {
    const live = await c.count(cleanup.db, cleanup.collection, cleanupFilter(cleanup));
    const expected = cleanup.kind === "retire_jobs" ? Object.values(cleanup.expected_by_status).reduce((a, b) => a + b, 0) : cleanup.expected_matches;
    if (live > expected) problems.push(`cleanup ${cleanup.id}: ${live} live matches exceed the manifest's ${expected} (a legacy writer is still active)`);
    const row: Document = { id: cleanup.id, status: cleanup.status, collection: cleanup.collection, live_matches: live, manifest_matches: expected, done: Boolean(log?.cleanups_done.includes(cleanup.id)) };
    if (cleanup.kind === "retire_jobs") {
      row.live_leases = await c.count(cleanup.db, cleanup.collection, liveLeaseFilter(cleanup.stages, now));
      row.to_terminalize = await c.count(cleanup.db, cleanup.collection, terminalizeFilter(cleanup.stages, now));
      if (row.live_leases > 0) problems.push(`cleanup ${cleanup.id}: ${row.live_leases} legacy jobs hold a live lease (old workers still running)`);
    }
    (facts.cleanups as Document[]).push(row);
  }

  if (t.blob) {
    if (sha256(canonicalJson(blobKeys)) !== t.blob.keys_sha256) problems.push("conversation-blob-keys.json does not match the manifest keys_sha256");
    if (blobKeys.some((k) => !k.startsWith(t.blob!.prefix))) problems.push("a manifest Blob key is outside the conversations/ prefix");
    if (!env.blobToken) problems.push("BLOB_READ_WRITE_TOKEN is not set");
    else {
      const listed = await listBlobs(env.blobToken, t.blob.prefix);
      const present = new Set(listed.map((o) => o.pathname));
      const manifestSet = new Set(blobKeys);
      if (log?.blob_done && blobKeys.some((k) => present.has(k))) problems.push("manifest Blob keys exist again after this run deleted them");
      problems.push(...unlistedBlobProblems(listed, blobKeys, t.blob.prefix));
      facts.blob = {
        manifest_keys: blobKeys.length,
        present_manifest_keys: blobKeys.filter((k) => present.has(k)).length,
        present_bytes: mb(listed.filter((o) => manifestSet.has(o.pathname)).reduce((s, o) => s + o.size, 0)),
        unlisted_under_prefix: listed.filter((o) => !manifestSet.has(o.pathname)).length,
      };
    }
  }
  return { problems, facts };
}

async function readDeploymentStamp(c: ReadOnlyCluster, mainDb: string): Promise<string | null> {
  const [row] = await c.find(mainDb, "sales_intelligence_sync_state", { scope: "deployment" }, { projection: { deployment_commit: 1 }, limit: 1 });
  return typeof row?.deployment_commit === "string" ? row.deployment_commit : null;
}

function saveLog(runDir: string, log: RunLog): void {
  writeFileSync(join(runDir, "purge-log.json"), `${JSON.stringify(log, null, 2)}\n`);
}

function step(log: RunLog, runDir: string, name: string, detail: Document): void {
  log.steps.push({ step: name, at: new Date().toISOString(), detail });
  saveLog(runDir, log);
  out(`[purge] ${name} ${JSON.stringify(detail)}`);
}

async function backupAll(c: PurgeCluster, env: SlimmingEnv, manifest: Manifest, blobKeys: string[], runDir: string, log: RunLog, skipBlobBackup: boolean): Promise<void> {
  const t = manifest.targets;
  const selections: Array<{ db: string; name: string; filter: Filter<Document>; label: string }> = [
    ...t.drop_collections.map((d) => ({ db: d.db, name: d.name, filter: {}, label: ns(d.db, d.name) })),
    ...t.drop_databases.flatMap((d) => d.collections.map((col) => ({ db: d.name, name: col.name, filter: {}, label: ns(d.name, col.name) }))),
    ...t.cleanups.map((cl) => ({ db: cl.db, name: cl.collection, filter: cleanupFilter(cl), label: `cleanup-${cl.id}` })),
  ];
  for (const sel of selections) {
    const file = join(runDir, `${sel.label}.ejson.gz`);
    const expected = await c.count(sel.db, sel.name, sel.filter);
    const written = await writeBackupFile(c.stream(sel.db, sel.name, sel.filter), file);
    if (written.documents !== expected) throw new PurgeAbort(`backup ${sel.label}: wrote ${written.documents}, expected ${expected}`);
    await verifyBackupFile(file, written);
    log.backups.push({ namespace: ns(sel.db, sel.name), filter: sel.filter, file: relative(runDir, file), ...written, indexes: await c.indexes(sel.db, sel.name) });
    step(log, runDir, "b.backup", { label: sel.label, documents: written.documents, sha256: written.sha256, size: mb(written.bytes) });
  }
  if (t.blob && blobKeys.length) {
    if (skipBlobBackup) step(log, runDir, "b.blob_backup_skipped", { reason: "--skip-blob-backup", keys: blobKeys.length });
    else {
      const listed = new Map((await listBlobs(env.blobToken!, t.blob.prefix)).map((o) => [o.pathname, o.size]));
      const files: Array<{ key: string; bytes: number; sha256: string }> = [];
      for (const key of blobKeys) {
        const listedSize = listed.get(key);
        if (listedSize === undefined) continue;
        const destination = join(runDir, "blob", key);
        mkdirSync(dirname(destination), { recursive: true });
        const streamed = await downloadBlob(env.blobToken!, key, destination);
        if (streamed === null) throw new PurgeAbort(`blob backup ${key}: listed but no longer readable`);
        if (streamed.bytes !== listedSize) throw new PurgeAbort(`blob backup ${key}: streamed ${streamed.bytes} bytes, listed ${listedSize}`);
        // The bytes on disk, not the Blob metadata: stat size against the listing and sha256 against the stream.
        const onDisk = await verifyBlobBackupFile(destination, { listedSize, streamedSha256: streamed.sha256 }).catch((error: unknown) => {
          throw new PurgeAbort(error instanceof Error ? error.message : String(error));
        });
        files.push({ key, ...onDisk });
      }
      writeFileSync(join(runDir, "blob-backup.json"), `${JSON.stringify(files, null, 1)}\n`);
      step(log, runDir, "b.blob_backup", { files: files.length, size: mb(files.reduce((sum, f) => sum + f.bytes, 0)), index: "blob-backup.json" });
    }
  }
  log.backup_done = true;
  saveLog(runDir, log);
}

/** Pages `_id`s matching `filter` in ascending order and applies `op` to each page; checkpoints after every page. */
async function inBatches(
  c: PurgeCluster,
  db: string,
  name: string,
  filter: () => Filter<Document>,
  batch: number,
  checkpointKey: string,
  log: RunLog,
  runDir: string,
  op: (ids: ObjectId[]) => Promise<number>,
): Promise<number> {
  let processed = 0;
  let last: ObjectId | null = null;
  for (;;) {
    const page = await c.find(db, name, last ? { $and: [filter(), { _id: { $gt: last } }] } : filter(), { projection: { _id: 1 }, sort: { _id: 1 }, limit: batch });
    if (!page.length) break;
    const ids = page.map((r) => r._id as ObjectId);
    processed += await op(ids);
    last = ids.at(-1)!;
    log.checkpoints[checkpointKey] = { last_id: String(last), processed };
    saveLog(runDir, log);
  }
  return processed;
}

async function runCleanups(c: PurgeCluster, manifest: Manifest, runDir: string, log: RunLog, batch: number): Promise<void> {
  for (const cleanup of manifest.targets.cleanups) {
    if (log.cleanups_done.includes(cleanup.id)) continue;
    const { db, collection } = cleanup;
    if (cleanup.kind === "retire_jobs") {
      const stages = cleanup.stages;
      const abortOnLiveLease = async () => {
        const live = await c.count(db, collection, liveLeaseFilter(stages, new Date()));
        if (live > 0) throw new PurgeAbort(`${cleanup.id}: ${live} legacy jobs hold a live lease`);
      };
      await abortOnLiveLease();
      const terminalized = await inBatches(c, db, collection, () => terminalizeFilter(stages, new Date()), batch, `${cleanup.id}:terminalize`, log, runDir, async (ids) => {
        await abortOnLiveLease();
        return c.updateByIds(db, collection, ids, terminalizeFilter(stages, new Date()), {
          $set: { status: "dead_letter", reason: cleanup.reason, lease_owner: null, leased_until: null },
          $inc: { lease_epoch: 1 },
        });
      });
      const terminal = terminalJobsFilter(stages);
      const deleted = await inBatches(c, db, collection, () => terminal, batch, `${cleanup.id}:delete`, log, runDir, (ids) => c.deleteByIds(db, collection, ids, terminal));
      const remaining = await c.count(db, collection, cleanupFilter(cleanup));
      if (remaining !== 0) throw new PurgeAbort(`${cleanup.id}: ${remaining} legacy-stage jobs remain after cleanup`);
      step(log, runDir, "c.cleanup", { id: cleanup.id, terminalized, deleted });
    } else {
      const filter = cleanupFilter(cleanup);
      const processed =
        cleanup.kind === "unset_fields"
          ? await inBatches(c, db, collection, () => filter, batch, cleanup.id, log, runDir, (ids) => c.unsetFields(db, collection, ids, filter, cleanup.fields))
          : await inBatches(c, db, collection, () => filter, batch, cleanup.id, log, runDir, (ids) => c.deleteByIds(db, collection, ids, filter));
      const remaining = await c.count(db, collection, filter);
      if (remaining !== 0) throw new PurgeAbort(`${cleanup.id}: ${remaining} documents still match after cleanup`);
      step(log, runDir, "c.cleanup", { id: cleanup.id, kind: cleanup.kind, processed });
    }
    log.cleanups_done.push(cleanup.id);
    saveLog(runDir, log);
  }
}

async function deleteBlobs(env: SlimmingEnv, manifest: Manifest, blobKeys: string[], runDir: string, log: RunLog): Promise<void> {
  const t = manifest.targets;
  if (!t.blob || log.blob_done) return;
  const present = new Set((await listBlobs(env.blobToken!, t.blob.prefix)).map((o) => o.pathname));
  const toDelete = blobKeys.filter((k) => present.has(k));
  const deleted = await deleteBlobKeys(env.blobToken!, toDelete);
  const after = new Set((await listBlobs(env.blobToken!, t.blob.prefix)).map((o) => o.pathname));
  const survivors = blobKeys.filter((k) => after.has(k));
  if (survivors.length) throw new PurgeAbort(`${survivors.length} manifest Blob keys still exist after delete`);
  log.blob_done = true;
  step(log, runDir, "d.blob_delete", { deleted, already_absent: blobKeys.length - toDelete.length, remaining_under_prefix: after.size });
}

async function dropTargets(c: PurgeCluster, manifest: Manifest, runDir: string, log: RunLog): Promise<void> {
  for (const target of manifest.targets.drop_collections) {
    const key = ns(target.db, target.name);
    if (log.dropped.includes(key)) continue;
    if (!(await c.collection(target.db, target.name))) {
      const problem = await verifiedFullBackupProblem(log, runDir, key, (documents) => dropCountMatches(target, documents));
      if (problem) throw new PurgeAbort(`${key} is already absent and ${problem}`);
      log.dropped.push(key);
      step(log, runDir, "e.drop_collection_already_absent", { namespace: key, backup: "verified" });
      continue;
    }
    const count = await c.count(target.db, target.name);
    if (!dropCountMatches(target, count)) throw new PurgeAbort(`${key}: ${count} documents at drop time, manifest ${target.count}`);
    await c.dropCollectionExact(target.db, target.name, target.uuid);
    if (await c.collection(target.db, target.name)) throw new PurgeAbort(`${key} still exists after drop`);
    log.dropped.push(key);
    step(log, runDir, "e.drop_collection", { namespace: key, documents: count });
  }
  for (const db of manifest.targets.drop_databases) {
    if (log.database_dropped) continue;
    if (db.name !== HISTORICAL_DATABASE || (FORBIDDEN_DATABASE_DROPS as readonly string[]).includes(db.name)) throw new PurgeAbort(`refusing to drop database ${db.name}`);
    if (!(await c.listDatabases()).some((d) => d.name === db.name)) {
      const problems = await databaseBackupProblems(db, runDir, log);
      if (problems.length) throw new PurgeAbort(`${db.name} is already absent and:\n  - ${problems.join("\n  - ")}`);
      log.database_dropped = true;
      step(log, runDir, "f.drop_database_already_absent", { database: db.name, backup: "verified" });
      continue;
    }
    const live = await c.listCollections(db.name);
    const same = live.length === db.collections.length && db.collections.every((col) => live.some((l) => l.name === col.name && l.uuid === col.uuid));
    if (!same) throw new PurgeAbort(`${db.name} collections changed since the manifest`);
    await c.dropDatabaseExact(db.name);
    if ((await c.listDatabases()).some((d) => d.name === db.name)) throw new PurgeAbort(`${db.name} still listed after dropDatabase`);
    log.database_dropped = true;
    step(log, runDir, "f.drop_database", { database: db.name, collections: live.length });
  }
}

function databaseBackupProblems(db: Manifest["targets"]["drop_databases"][number], runDir: string, log: RunLog): Promise<string[]> {
  return Promise.all(db.collections.map((col) => verifiedFullBackupProblem(log, runDir, ns(db.name, col.name), (documents) => documents === col.count)))
    .then((rows) => rows.filter((row): row is string => row !== null));
}

/**
 * Resume only: a drop whose `dropCollection`/`dropDatabase` succeeded but whose log write did not (a crash in
 * between) leaves the target absent and unrecorded. It counts as dropped once this run's backup of it verifies on
 * disk; otherwise step (a) reports the absence and the run aborts.
 */
async function reconcileAbsentDrops(c: ReadOnlyCluster, manifest: Manifest, runDir: string, log: RunLog): Promise<void> {
  if (!log.backup_done) return;
  for (const target of manifest.targets.drop_collections) {
    const key = ns(target.db, target.name);
    if (log.dropped.includes(key) || (await c.collection(target.db, target.name))) continue;
    if (await verifiedFullBackupProblem(log, runDir, key, (documents) => dropCountMatches(target, documents))) continue;
    log.dropped.push(key);
    step(log, runDir, "e.drop_collection_reconciled", { namespace: key, reason: "absent on resume; this run's backup verified" });
  }
  for (const db of manifest.targets.drop_databases) {
    if (log.database_dropped || (await c.listDatabases()).some((d) => d.name === db.name)) continue;
    if ((await databaseBackupProblems(db, runDir, log)).length) continue;
    log.database_dropped = true;
    step(log, runDir, "f.drop_database_reconciled", { database: db.name, reason: "absent on resume; this run's backups verified" });
  }
}

async function stats(c: ReadOnlyCluster, manifest: Manifest): Promise<Document> {
  const t = manifest.targets;
  const dbStats: Document = {};
  for (const db of [t.main_database, t.admin_auth_database]) {
    const s = await c.dbStats(db);
    dbStats[db] = { collections: s.collections, objects: s.objects, data: mb(Number(s.dataSize)), storage: mb(Number(s.storageSize)), indexes: mb(Number(s.indexSize)) };
  }
  const databases = (await c.listDatabases()).map((d) => ({ name: d.name, size_on_disk: mb(d.sizeOnDisk) }));
  return { databases, db_stats: dbStats };
}

function planSummary(manifest: Manifest, blobKeys: string[], batch: number): Document {
  const t = manifest.targets;
  return {
    b_backup: {
      namespaces: t.drop_collections.length + t.drop_databases.reduce((s, d) => s + d.collections.length, 0),
      cleanup_selections: t.cleanups.length,
      blob_objects: blobKeys.length,
    },
    c_cleanups: t.cleanups.map((cl) => ({ id: cl.id, kind: cl.kind, collection: cl.collection, status: cl.status, batch })),
    d_blob_delete: t.blob ? { prefix: t.blob.prefix, keys: t.blob.count, bytes: mb(t.blob.bytes), unreferenced_left_alone: t.blob.unreferenced_count } : null,
    e_drop_collections: t.drop_collections.map((d) => ({ namespace: ns(d.db, d.name), documents: d.count, storage_plus_index: mb(d.storage_size + d.index_size) })),
    f_drop_database: t.drop_databases.map((d) => ({ database: d.name, collections: d.collections.length, size_on_disk: mb(d.size_on_disk) })),
    g_verify: { protected_namespaces: t.protected.length, absent_targets: t.absent_targets.map((a) => ns(a.db, a.name)) },
  };
}

function printDryRun(report: Document): void {
  const plan = report.plan as Document;
  const facts = report.facts as Document;
  out("[purge] DRY RUN (read-only). Planned steps:");
  out("  (a) assert cluster/db/UUID/counts/deployed commit against the manifest");
  out(`  (b) back up ${plan.b_backup.namespaces} namespaces, ${plan.b_backup.cleanup_selections} cleanup selections, ${plan.b_backup.blob_objects} Blob objects`);
  for (const cl of facts.cleanups as Document[])
    out(`  (c) ${cl.id} [${cl.status}] ${cl.collection}: live ${cl.live_matches} / manifest ${cl.manifest_matches}${cl.to_terminalize !== undefined ? `; to terminalize ${cl.to_terminalize}; live leases ${cl.live_leases}` : ""}`);
  if (plan.d_blob_delete) out(`  (d) delete ${plan.d_blob_delete.keys} Blob keys (${plan.d_blob_delete.bytes}) under ${plan.d_blob_delete.prefix}; live ${JSON.stringify(facts.blob ?? {})}`);
  for (const d of facts.drop_collections as Document[]) out(`  (e) drop ${d.namespace}: live ${d.live_count ?? d.live} / manifest ${d.manifest_count ?? "-"} (${d.storage ?? ""})`);
  for (const d of plan.f_drop_database as Document[]) out(`  (f) drop database ${d.database}: ${d.collections} collections, ${d.size_on_disk}`);
  out(`  (g) verify ${plan.g_verify.protected_namespaces} protected namespaces present and every target absent`);
  const problems = report.problems as string[];
  out(problems.length ? `[purge] ${problems.length} problem(s); an --apply run would abort at step (a):\n  - ${problems.join("\n  - ")}` : "[purge] no problems: the manifest matches live state");
}

async function main(): Promise<void> {
  const argv = process.argv;
  const apply = hasFlag(argv, "apply");
  const env = loadSlimmingEnv(argv);
  const { manifest, computedHash } = loadManifest();
  const blobKeys = manifest.targets.blob ? loadBlobKeys() : [];
  const pending = manifest.targets.cleanups.filter((cl) => cl.status !== "final").map((cl) => cl.id);
  const drift = manifestPolicyDrift(manifest.targets.cleanups);
  const batch = Math.min(Math.max(Number(argValue(argv, "batch") ?? 500) || 500, 1), 2_000);

  out(`[purge] mode=${apply ? "APPLY" : "dry-run"} manifest_hash=${computedHash} generated_at=${manifest.generated_at}`);
  if (drift.length) out(`[purge] the manifest is stale against policy.ts (regenerate it with inventory.ts):\n  - ${drift.join("\n  - ")}`);
  let runDir = "";
  let log: RunLog | null = null;
  if (apply) {
    const given = argValue(argv, "manifest-hash");
    if (given !== computedHash) throw new PurgeAbort(`--manifest-hash ${given ?? "(missing)"} does not match the manifest (${computedHash})`);
    if (!hasFlag(argv, "i-confirm-slim-deployed")) throw new PurgeAbort("--i-confirm-slim-deployed is required");
    if (pending.length) throw new PurgeAbort(`cleanups still pending wave 3: ${pending.join(", ")}; finalize policy.ts and regenerate the manifest`);
    if (drift.length) throw new PurgeAbort(`the manifest is stale against policy.ts (${drift.length} difference(s)); regenerate it`);
    const backupDir = assertBackupDir(argValue(argv, "backup-dir"));
    const resume = argValue(argv, "resume");
    if (resume) {
      runDir = assertBackupDir(resume);
      log = JSON.parse(readFileSync(join(runDir, "purge-log.json"), "utf8")) as RunLog;
      if (log.manifest_hash !== computedHash) throw new PurgeAbort(`resume run ${runDir} belongs to manifest ${log.manifest_hash}`);
    } else {
      runDir = join(backupDir, `slimming-purge-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      if (existsSync(runDir) && readdirSync(runDir).length) throw new PurgeAbort(`${runDir} is not empty`);
      mkdirSync(runDir, { recursive: true });
      log = { manifest_hash: computedHash, started_at: new Date().toISOString(), steps: [], backup_done: false, backups: [], cleanups_done: [], checkpoints: {}, blob_done: false, dropped: [], database_dropped: false, finished_at: null };
      saveLog(runDir, log);
    }
    writeFileSync(join(runDir, "deletion-manifest.json"), readFileSync(MANIFEST_PATH));
  }

  const c = apply ? await PurgeCluster.connectForPurge(env.serverMongoUri, env) : await ReadOnlyCluster.connect(env.serverMongoUri, env);
  try {
    // (a) assertions
    const deployed = await readDeploymentStamp(c, manifest.targets.main_database);
    out(`[purge] deployed server commit: ${deployed ?? "(none recorded)"}`);
    if (apply && log && argValue(argv, "resume")) await reconcileAbsentDrops(c, manifest, runDir, log);
    const { problems, facts } = await assertState(c, manifest, env, blobKeys, log);
    const allProblems = [...problems, ...deploymentProblems(deployed), ...pending.map((id) => `cleanup ${id} is pending wave 3`)];
    const before = await stats(c, manifest);
    const report = { mode: apply ? "apply" : "dry-run", observed_at: new Date().toISOString(), manifest_hash: computedHash, deployed_server_commit: deployed, problems: allProblems, plan: planSummary(manifest, blobKeys, batch), facts, before };
    if (!apply || !log) {
      printDryRun(report);
      const reportPath = argValue(argv, "report");
      if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    if (allProblems.length) throw new PurgeAbort(`step (a) assertions failed:\n  - ${allProblems.join("\n  - ")}`);
    const purge = c as PurgeCluster;
    step(log, runDir, "a.assert", { ok: true, deployed_server_commit: deployed, before });

    // (b) backup, (c) cleanups, (d) Blob, (e) collection drops, (f) database drop
    if (!log.backup_done) await backupAll(purge, env, manifest, blobKeys, runDir, log, hasFlag(argv, "skip-blob-backup"));
    await runCleanups(purge, manifest, runDir, log, batch);
    await deleteBlobs(env, manifest, blobKeys, runDir, log);
    await dropTargets(purge, manifest, runDir, log);

    // (g) verify
    const verify = await assertState(c, manifest, env, blobKeys, log);
    const remainingBlob = Number((verify.facts.blob as Document | undefined)?.present_manifest_keys ?? 0);
    const residual = [...verify.problems, ...(remainingBlob ? [`${remainingBlob} manifest Blob keys still present`] : [])];
    if (residual.length) throw new PurgeAbort(`step (g) verification failed:\n  - ${residual.join("\n  - ")}`);
    log.finished_at = new Date().toISOString();
    step(log, runDir, "g.verify", { ok: true, before, after: await stats(c, manifest), protected: verify.facts.protected });
    out(`[purge] done. Backup and log: ${runDir}`);
  } finally {
    await c.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[purge] ABORTED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
  process.exit(1);
});
