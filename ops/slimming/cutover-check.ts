/**
 * Read-only cutover checks for the slim deploy and the purge (CUTOVER.md). Every Mongo call goes through
 * `ReadOnlyCluster`, whose driver guard exits before any non-read command is sent; Blob access is `list` only.
 * Prints identifiers, counts and timestamps only, never document values (agent usernames aside: internal CRM logins).
 *
 *   node --import tsx ops/slimming/cutover-check.ts --agents
 *       Pre-deploy: duplicate string `agents.granot_identity.username` values (the slim server's first boot builds a
 *       unique partial index on it). Exit 2 when a duplicate exists.
 *   node --import tsx ops/slimming/cutover-check.ts --snapshot --out=<json> [--since=<ISO>] [--compare=<earlier json>] [--skip-blob]
 *       Per retired target: exists, UUID, count, last insert (max `_id` time), last `updatedAt`; the historical DB per
 *       collection; legacy-stage jobs by status with runnable/leased counts; the `deployment` stamp; the Blob
 *       `conversations/` count/bytes/last upload. `--since` flags any write at or after that instant (the deploy time);
 *       `--compare` flags any change against an earlier snapshot (a writer is still active). Exit 2 on a finding.
 *       `--cutover-at=<T0 ISO>` also lists the sales-intelligence jobs (any stage) created before T0 that a consumer can
 *       still claim (pending/retry/leased): with the old deployments kept, an old consumer can claim them (CUTOVER.md 3b).
 *   node --import tsx ops/slimming/cutover-check.ts --recreation [--out=<json>] [--skip-blob]
 *       Post-purge: any retired namespace present again (main, Admin auth, `test_` observability aliases, the
 *       historical DB), any object under `conversations/`, any legacy-stage job row, any C1/C5/C7 field set again.
 *       Exit 2 on a finding.
 *
 * Add `--rehearsal --rehearsal-main-db=… --rehearsal-admin-db=… --manifest=<abs path outside the repo>` to point at a
 * loopback replica (same preconditions as `inventory.ts`; Blob is never called).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { type Document, ObjectId } from "mongodb";
import { listBlobs } from "./lib/blob";
import { argValue, hasFlag, loadSlimmingEnv } from "./lib/env";
import { ReadOnlyCluster } from "./lib/guarded-mongo";
import { liveLeaseFilter, unsetPathFilter } from "./lib/purge-rules";
import { claimableBeforeFilter } from "./lib/write-gate";
import { loadRehearsalEnv, resolveSlimmingTarget } from "./lib/rehearsal";
import {
  ADMIN_DROP_COLLECTIONS,
  CALL_INTERACTION_DEAD_PATHS,
  CONTACT_NUMBER_DEAD_FIELDS,
  CONTACT_NUMBER_REVIEW_FIELDS,
  CONVERSATION_BLOB_PREFIX,
  HISTORICAL_DATABASE,
  LEGACY_JOB_STAGES,
  MAIN_DROP_COLLECTIONS,
} from "./policy";

const OBSERVABILITY = ["operational_events", "operational_incidents", "notification_deliveries", "operational_report_runs"];

type TargetRow = {
  ns: string;
  exists: boolean;
  uuid: string | null;
  count: number;
  last_insert_at: string | null;
  last_updated_at: string | null;
};
export type Snapshot = {
  version: "slimming-cutover-snapshot-v1";
  observed_at: string;
  deployment: Document | null;
  targets: TargetRow[];
  historical: { exists: boolean; collections: TargetRow[] };
  legacy_jobs: { by_status: Record<string, number>; runnable: number; live_leases: number; expired_leases: number; nonterminal_by_dataset: Record<string, number> };
  blob: { objects: number; bytes: number; last_uploaded_at: string | null } | { skipped: string };
  /** `--cutover-at` only: claimable jobs created before T0, by `stage/status`. */
  claimable_jobs_before_cutover?: Record<string, number>;
};

const out = (line = "") => process.stdout.write(`${line}\n`);
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);

async function describe(c: ReadOnlyCluster, db: string, name: string): Promise<TargetRow> {
  const info = await c.collection(db, name);
  if (!info) return { ns: `${db}.${name}`, exists: false, uuid: null, count: 0, last_insert_at: null, last_updated_at: null };
  const [lastId] = await c.find(db, name, {}, { projection: { _id: 1 }, sort: { _id: -1 }, limit: 1 });
  // A top-1 sort: an index when there is one, otherwise one bounded scan of a small retired collection.
  const [lastUpdate] = await c.find(db, name, { updatedAt: { $type: "date" } }, { projection: { updatedAt: 1 }, sort: { updatedAt: -1 }, limit: 1 });
  return {
    ns: `${db}.${name}`,
    exists: true,
    uuid: info.uuid,
    count: await c.count(db, name),
    last_insert_at: lastId?._id instanceof ObjectId ? lastId._id.getTimestamp().toISOString() : null,
    last_updated_at: iso(lastUpdate?.updatedAt),
  };
}

async function legacyJobs(c: ReadOnlyCluster, mainDb: string): Promise<Snapshot["legacy_jobs"]> {
  const stages = [...LEGACY_JOB_STAGES];
  const rows = await c.aggregate(mainDb, "sales_intelligence_jobs", [{ $match: { stage: { $in: stages } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const now = new Date();
  // The server fence (`retireLegacyCsiJobs`) only touches its own dataset (`deployment`/`database`); rows of another
  // dataset stay non-terminal until purge C2 terminalizes and deletes them, so they are shown separately.
  const datasets = await c.aggregate(mainDb, "sales_intelligence_jobs", [
    { $match: { stage: { $in: stages }, status: { $in: ["pending", "retry", "paused", "leased"] } } },
    { $group: { _id: { deployment: "$deployment", database: "$database" }, n: { $sum: 1 } } },
  ]);
  return {
    by_status: Object.fromEntries(rows.map((r) => [String(r._id), Number(r.n)])),
    nonterminal_by_dataset: Object.fromEntries(datasets.map((r) => [`${r._id?.deployment ?? "?"}/${r._id?.database ?? "?"}`, Number(r.n)])),
    runnable: await c.count(mainDb, "sales_intelligence_jobs", { stage: { $in: stages }, status: { $in: ["pending", "retry", "paused"] } }),
    live_leases: await c.count(mainDb, "sales_intelligence_jobs", liveLeaseFilter(stages, now)),
    expired_leases: await c.count(mainDb, "sales_intelligence_jobs", { stage: { $in: stages }, status: "leased", $or: [{ leased_until: null }, { leased_until: { $lte: now } }] }),
  };
}

async function blobState(token: string | null, skip: boolean): Promise<Snapshot["blob"]> {
  if (skip) return { skipped: "--skip-blob" };
  if (!token) return { skipped: "no BLOB_READ_WRITE_TOKEN (rehearsal or unset)" };
  const objects = await listBlobs(token, CONVERSATION_BLOB_PREFIX);
  return { objects: objects.length, bytes: objects.reduce((s, o) => s + o.size, 0), last_uploaded_at: objects.map((o) => o.uploadedAt).sort().at(-1) ?? null };
}

async function snapshot(c: ReadOnlyCluster, mainDb: string, adminDb: string, blob: Snapshot["blob"]): Promise<Snapshot> {
  const targets: TargetRow[] = [];
  for (const name of Object.keys(MAIN_DROP_COLLECTIONS)) targets.push(await describe(c, mainDb, name));
  for (const name of Object.keys(ADMIN_DROP_COLLECTIONS)) targets.push(await describe(c, adminDb, name));
  const historicalExists = (await c.listDatabases()).some((d) => d.name === HISTORICAL_DATABASE);
  const historical = historicalExists ? await Promise.all((await c.listCollections(HISTORICAL_DATABASE)).map((col) => describe(c, HISTORICAL_DATABASE, col.name))) : [];
  const [stamp] = await c.find(mainDb, "sales_intelligence_sync_state", { scope: "deployment" }, { projection: { _id: 0, deployment_commit: 1, commit_source: 1, recorded_at: 1, vercel_deployment_id: 1 }, limit: 1 });
  return {
    version: "slimming-cutover-snapshot-v1",
    observed_at: new Date().toISOString(),
    deployment: stamp ? { ...stamp, recorded_at: iso(stamp.recorded_at) } : null,
    targets,
    historical: { exists: historicalExists, collections: historical },
    legacy_jobs: await legacyJobs(c, mainDb),
    blob,
  };
}

/** Findings of a snapshot on its own (`since`) and against an earlier one (`earlier`). Pure; unit-tested. */
export function snapshotFindings(now: Snapshot, opts: { since?: string; earlier?: Snapshot }): string[] {
  const findings: string[] = [];
  const all = [...now.targets, ...now.historical.collections];
  if (opts.since) {
    for (const t of all) {
      if (t.last_insert_at && t.last_insert_at >= opts.since) findings.push(`${t.ns}: insert at ${t.last_insert_at}, after ${opts.since}`);
      if (t.last_updated_at && t.last_updated_at >= opts.since) findings.push(`${t.ns}: update at ${t.last_updated_at}, after ${opts.since}`);
    }
    if ("objects" in now.blob && now.blob.last_uploaded_at && now.blob.last_uploaded_at >= opts.since) findings.push(`Blob ${CONVERSATION_BLOB_PREFIX}: upload at ${now.blob.last_uploaded_at}, after ${opts.since}`);
  }
  if (now.legacy_jobs.runnable) findings.push(`${now.legacy_jobs.runnable} legacy-stage jobs are runnable (pending/retry/paused): trigger job recovery on the slim deployment`);
  if (now.legacy_jobs.live_leases) findings.push(`${now.legacy_jobs.live_leases} legacy-stage jobs hold a live lease (an old worker is running)`);
  if (now.legacy_jobs.expired_leases) findings.push(`${now.legacy_jobs.expired_leases} legacy-stage jobs are leased with an expired lease: trigger job recovery on the slim deployment`);
  if (opts.earlier) {
    const before = new Map([...opts.earlier.targets, ...opts.earlier.historical.collections].map((t) => [t.ns, t]));
    for (const t of all) {
      const b = before.get(t.ns);
      if (!b) {
        findings.push(`${t.ns}: appeared since the earlier snapshot`);
        continue;
      }
      if (b.exists !== t.exists) findings.push(`${t.ns}: ${b.exists ? "disappeared" : "appeared"} since the earlier snapshot`);
      if (b.uuid !== t.uuid && b.exists && t.exists) findings.push(`${t.ns}: UUID changed (recreated)`);
      if (b.count !== t.count) findings.push(`${t.ns}: count ${b.count} -> ${t.count}`);
      if (b.last_insert_at !== t.last_insert_at) findings.push(`${t.ns}: last insert ${b.last_insert_at} -> ${t.last_insert_at}`);
      if (b.last_updated_at !== t.last_updated_at) findings.push(`${t.ns}: last update ${b.last_updated_at} -> ${t.last_updated_at}`);
    }
    if ("objects" in now.blob && "objects" in opts.earlier.blob && (now.blob.objects !== opts.earlier.blob.objects || now.blob.last_uploaded_at !== opts.earlier.blob.last_uploaded_at))
      findings.push(`Blob ${CONVERSATION_BLOB_PREFIX}: ${opts.earlier.blob.objects} -> ${now.blob.objects} objects, last upload ${opts.earlier.blob.last_uploaded_at} -> ${now.blob.last_uploaded_at}`);
  }
  return findings;
}

async function recreation(c: ReadOnlyCluster, mainDb: string, adminDb: string, blob: Snapshot["blob"]): Promise<{ findings: string[]; facts: Document }> {
  const findings: string[] = [];
  const present: Document[] = [];
  const names = [...Object.keys(MAIN_DROP_COLLECTIONS).map((n) => [mainDb, n]), ...OBSERVABILITY.map((n) => [mainDb, `test_${n}`]), ...Object.keys(ADMIN_DROP_COLLECTIONS).map((n) => [adminDb, n])];
  for (const [db, name] of names) {
    const row = await describe(c, db!, name!);
    if (row.exists) {
      present.push(row);
      findings.push(`${row.ns} exists again: ${row.count} documents, UUID ${row.uuid}, last insert ${row.last_insert_at}, last update ${row.last_updated_at}`);
    }
  }
  if ((await c.listDatabases()).some((d) => d.name === HISTORICAL_DATABASE)) findings.push(`database ${HISTORICAL_DATABASE} exists again (${(await c.listCollections(HISTORICAL_DATABASE)).map((x) => x.name).join(", ")})`);
  const jobs = await legacyJobs(c, mainDb);
  const legacyRows = Object.values(jobs.by_status).reduce((a, b) => a + b, 0);
  if (legacyRows) findings.push(`${legacyRows} legacy-stage job rows exist again ${JSON.stringify(jobs.by_status)}`);
  const fields = {
    contact_numbers_dead_fields: await c.count(mainDb, "contact_numbers", { $or: [...CONTACT_NUMBER_DEAD_FIELDS, ...CONTACT_NUMBER_REVIEW_FIELDS].map((f) => ({ [f]: { $exists: true } })) }),
    call_interactions_conversation_pointers: await c.count(mainDb, "call_interactions", { $or: CALL_INTERACTION_DEAD_PATHS.map(unsetPathFilter) }),
  };
  for (const [key, n] of Object.entries(fields)) if (n) findings.push(`${key}: ${n} documents carry a cleaned field again`);
  if ("objects" in blob && blob.objects) findings.push(`${blob.objects} object(s) under ${CONVERSATION_BLOB_PREFIX} (last upload ${blob.last_uploaded_at}): a conversation-media writer is live`);
  return { findings, facts: { observed_at: new Date().toISOString(), present, legacy_jobs: jobs, fields, blob } };
}

async function main(): Promise<void> {
  const argv = process.argv;
  const target = resolveSlimmingTarget(argv);
  const env = target.rehearsal ? loadRehearsalEnv(target) : loadSlimmingEnv(argv);
  const mainDb = target.mainDatabase;
  const adminDb = target.adminAuthDatabase;
  const outPath = argValue(argv, "out");
  const c = await ReadOnlyCluster.connect(env.serverMongoUri, env);
  let findings: string[] = [];
  try {
    if (hasFlag(argv, "agents")) {
      const groups = await c.aggregate(mainDb, "agents", [
        { $match: { "granot_identity.username": { $type: "string" } } },
        { $group: { _id: "$granot_identity.username", n: { $sum: 1 }, ids: { $push: "$_id" } } },
        { $match: { n: { $gt: 1 } } },
      ]);
      const withUsername = await c.count(mainDb, "agents", { "granot_identity.username": { $type: "string" } });
      out(`[cutover-check] agents with a string granot_identity.username: ${withUsername}; duplicate usernames: ${groups.length}`);
      for (const g of groups) out(`  - ${JSON.stringify(g._id)} x${g.n}: ${g.ids.map(String).join(", ")}`);
      const indexes = (await c.indexes(mainDb, "agents")).map((i) => i.name);
      out(`[cutover-check] agents indexes: ${indexes.join(", ")}`);
      findings = groups.map((g) => `duplicate granot_identity.username ${JSON.stringify(g._id)} on ${g.n} agents`);
    } else if (hasFlag(argv, "snapshot")) {
      const snap = await snapshot(c, mainDb, adminDb, await blobState(env.blobToken, hasFlag(argv, "skip-blob")));
      const earlierPath = argValue(argv, "compare");
      const earlier = earlierPath ? (JSON.parse(readFileSync(earlierPath, "utf8")) as Snapshot) : undefined;
      const sinceArg = argValue(argv, "since");
      if (sinceArg !== undefined && Number.isNaN(Date.parse(sinceArg))) throw new Error("--since must be an ISO timestamp");
      findings = snapshotFindings(snap, { since: sinceArg === undefined ? undefined : new Date(sinceArg).toISOString(), earlier });
      out(`[cutover-check] snapshot ${snap.observed_at} deployment=${JSON.stringify(snap.deployment)}`);
      for (const t of [...snap.targets, ...snap.historical.collections])
        out(`  ${t.ns.padEnd(58)} ${t.exists ? `${String(t.count).padStart(8)}  insert ${t.last_insert_at ?? "-"}  update ${t.last_updated_at ?? "-"}` : "absent"}`);
      out(`  legacy jobs ${JSON.stringify(snap.legacy_jobs)}`);
      const cutoverArg = argValue(argv, "cutover-at");
      if (cutoverArg !== undefined) {
        if (Number.isNaN(Date.parse(cutoverArg))) throw new Error("--cutover-at must be an ISO timestamp");
        const rows = await c.aggregate(mainDb, "sales_intelligence_jobs", [
          { $match: claimableBeforeFilter(new Date(cutoverArg)) },
          { $group: { _id: { stage: "$stage", status: "$status" }, n: { $sum: 1 } } },
        ]);
        snap.claimable_jobs_before_cutover = Object.fromEntries(rows.map((r) => [`${r._id?.stage}/${r._id?.status}`, Number(r.n)]));
        out(`  claimable jobs created before ${new Date(cutoverArg).toISOString()} ${JSON.stringify(snap.claimable_jobs_before_cutover)}`);
      }
      out(`  blob ${JSON.stringify(snap.blob)}`);
      if (outPath) writeFileSync(outPath, `${JSON.stringify(snap, null, 1)}\n`);
    } else if (hasFlag(argv, "recreation")) {
      const result = await recreation(c, mainDb, adminDb, await blobState(env.blobToken, hasFlag(argv, "skip-blob")));
      findings = result.findings;
      if (outPath) writeFileSync(outPath, `${JSON.stringify(result.facts, null, 1)}\n`);
    } else throw new Error("pass one of --agents, --snapshot or --recreation");
  } finally {
    await c.close();
  }
  out(findings.length ? `[cutover-check] ${findings.length} finding(s):\n  - ${findings.join("\n  - ")}` : "[cutover-check] no findings");
  if (findings.length) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`[cutover-check] failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
    process.exit(1);
  });
}
