/**
 * Unreferenced older Granot objects (Owner decision 6, 2026-11-23). Run with the server environment loaded:
 *
 *   node --env-file=.env --import tsx ops/granot-unreferenced-objects.ts inventory --target=vantagemovers <new private JSON file>
 *       Read-only: lists every object under history/granot/v1/<db>/, builds the set of hashes MongoDB rows name,
 *       downloads each unreferenced object (verified by SHA-256) and the live archives of its job, and classifies it
 *       `confirmed_superseded` or `held:<reason>`. MongoDB find only (secondary preferred); GCS list and get only.
 *   node --env-file=.env --import tsx ops/granot-unreferenced-objects.ts apply <manifest> --target=vantagemovers [--limit N]
 *       Owner-approved runs only. For up to N confirmed objects (default 200, at most 5000): re-check the live
 *       generation, that no row names the object and that its covering objects are still named; place the
 *       namespace review hold; on a later run (800 s after the hold) start the 90-day recovery clock through
 *       `startRecoveryClock` with `archiveObjectReferenced` as its guard. Restartable and idempotent: progress
 *       is appended to <manifest>.apply.jsonl and the object's own state (hold token, clock) is authoritative.
 *   (--target=testvantagemovers_<x> targets a disposable test database instead of production.)
 *
 * No runtime or cron change. Recovery by ID stays possible for 90 days after a clock starts (the covering
 * archive by job, or the manifest's object). Runbook:
 * docs/knowledge/granot-lifecycle/storage-retention-operations.md#unreferenced-older-objects.
 */
import dns from "node:dns";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { BSON, MongoClient, ObjectId, type Db, type Document } from "mongodb";
import { openObjectStore, type ObjectState, type ObjectStore } from "../src/services/cloudStorage";
import { archiveJobKey, digest } from "../src/services/granotHistory/archiveCodec";
import { evidenceFormat, liveRow } from "../src/services/granotHistory/evidencePage";
import { RETIRED_RECEIPT_FORMATS, restoreRetiredReceipt } from "../src/services/granotHistory/retiredRecords";
import {
  applyEntry, classifyObject, decodeObject, evidenceDigests, objectReferenced, referencedHashes,
  UNREFERENCED_REVIEW_TOKEN, type ApplyOutcome, type Coverage, type DocDigests, type ManifestEntry,
} from "../src/services/granotHistory/unreferencedObjects";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const PRESERVE = { promoteValues: false, promoteLongs: false, promoteBuffers: false, bsonRegExp: true } as const;
const NAME = /\/([a-f0-9]{64})\.bson\.gz$/;
const CONCURRENCY = 24;

async function pool<T>(items: T[], size: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; await work(items[i]!, i); }
  }));
}

/** Transient provider aborts retried beyond the driver's own attempts; a checksum failure is never retried. */
async function retry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await work(); } catch (error) {
      if (attempt >= 6 || (error as { code?: string })?.code === "verification_failed") throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function listAll(store: ObjectStore, prefix: string) {
  const items: ObjectState[] = [];
  for (let pageToken: string | undefined; ;) {
    const page = await retry(() => store.list({ prefix, pageToken, maxResults: 1000 }));
    items.push(...page.items);
    if (items.length % 50_000 < 1000) console.error(JSON.stringify({ listed: items.length }));
    if (!(pageToken = page.nextPageToken)) return items;
  }
}

/** Live archives that serve a job: month pages of the exact job, Lead evidence pages, and retired receipt packs (added lazily). */
function coverageReader(db: Db, store: ObjectStore, prefix: string) {
  const byJob = new Map<string, Promise<Coverage>>();
  const bytesOf = new Map<string, Promise<Buffer>>();
  const read = (hash: string, generation?: string) => {
    let p = bytesOf.get(hash);
    if (!p) { p = retry(() => store.readVerified({ name: `${prefix}${hash.slice(0, 2)}/${hash}.bson.gz`, generation, sha256: hash })); bytesOf.set(hash, p); }
    return p;
  };
  const add = (coverage: Coverage, hash: string, docs: DocDigests) => {
    for (const [key, d] of docs) { const list = coverage.get(key) ?? []; list.push({ digest: d, hash }); coverage.set(key, list); }
  };
  async function load(job: string): Promise<Coverage> {
    const coverage: Coverage = new Map();
    const rows = await db.collection("granot_history_archive_chunks").find({ job_key: archiveJobKey(job), ...liveRow() } as Document,
      { projection: { hash: 1, generation: 1, job: 1, format: 1, evidence_ids: 1 }, readPreference: "secondaryPreferred" }).toArray();
    for (const row of rows) {
      const hash = String(row.hash ?? row._id);
      if (row.format === evidenceFormat) {
        const bytes = await read(hash, row.generation);
        add(coverage, hash, evidenceDigests(bytes, hash, job, new Set((row.evidence_ids ?? []).map(String))));
      } else if (row.job === job) {
        const decoded = decodeObject(await read(hash, row.generation), hash); // verified read, then decodeChains identity checks
        if (decoded.kind !== "job_chunk" || decoded.job !== job) throw new Error(`Covering page ${hash} identity mismatch`);
        add(coverage, hash, decoded.docs);
        bytesOf.delete(hash); // month pages serve one job; free their bytes
      }
    }
    return coverage;
  }
  /** Receipts not in a page: a retired-by-use receipt pack (`granot_archived_receipts`, receipt format) may hold them. */
  async function addReceiptPacks(coverage: Coverage, docs: DocDigests) {
    const missing = [...docs.keys()].filter((k) => k.startsWith("r:") && !coverage.has(k)).map((k) => k.slice(2)).filter((h) => ObjectId.isValid(h));
    if (!missing.length) return;
    const locators = await db.collection("granot_archived_receipts").find(
      { _id: { $in: missing.map((h) => new ObjectId(h)) }, format: { $in: [...RETIRED_RECEIPT_FORMATS] }, ...liveRow() } as Document,
      { projection: { hash: 1, generation: 1, format: 1 }, readPreference: "secondaryPreferred" }).toArray();
    for (const l of locators) {
      const bytes = await retry(() => store.readVerified({ name: `${prefix}${String(l.hash).slice(0, 2)}/${l.hash}.bson.gz`, generation: l.generation, sha256: l.hash }));
      const { raw } = restoreRetiredReceipt(bytes, l.hash, l._id as ObjectId, l.format);
      add(coverage, l.hash, new Map([[`r:${String(l._id)}` as const, digest(BSON.serialize(BSON.deserialize(raw, PRESERVE)))]]));
    }
  }
  return {
    async forObject(job: string, docs: DocDigests) {
      let p = byJob.get(job);
      if (!p) { p = load(job); byJob.set(job, p); }
      const coverage = await p;
      await addReceiptPacks(coverage, docs);
      return coverage;
    },
  };
}

async function inventory(db: Db, file: string) {
  const { store, config } = await openObjectStore(db, "granot-history");
  const prefix = `${config.prefix}${db.databaseName}/`;
  const measured_at = new Date();
  // List first, then read MongoDB: a locator committed for a listed object during the listing is still seen.
  const listed = await listAll(store, prefix);
  const referenced = await referencedHashes(db);
  const candidates = listed.filter((o) => { const h = NAME.exec(o.name)?.[1]; return h && !referenced.has(h); });
  const coverage = coverageReader(db, store, prefix);
  const objects: ManifestEntry[] = new Array(candidates.length);
  const errors: { hash: string; step: string; error: string }[] = [];
  let done = 0;
  await pool(candidates, CONCURRENCY, async (o, i) => {
    const hash = NAME.exec(o.name)![1]!;
    const base = { hash, generation: o.generation, size: o.size };
    let decoded: ReturnType<typeof decodeObject> = { kind: "unreadable" };
    let bytes: Buffer | null = null, readFailed = false;
    try { bytes = await retry(() => store.readVerified({ name: o.name, generation: o.generation, sha256: hash })); } catch (error) {
      // A failed checksum is unreadable; a provider error that outlasts the retries is held as such, never guessed.
      if ((error as { code?: string })?.code !== "verification_failed") {
        readFailed = true;
        errors.push({ hash, step: "read", error: String((error as Error)?.message ?? error).slice(0, 200) });
      }
    }
    if (bytes) decoded = decodeObject(bytes, hash);
    let cover: Coverage = new Map(), coverageFailed = false;
    if (decoded.kind === "job_chunk") {
      try { cover = await coverage.forObject(decoded.job, decoded.docs); } catch (error) {
        coverageFailed = true;
        errors.push({ hash, step: "coverage", error: String((error as Error)?.message ?? error).slice(0, 200) });
      }
    }
    const verdict = readFailed ? { class: "held:read_error" as const, covering: [] }
      : coverageFailed ? { class: "held:coverage_error" as const, covering: [] }
      : classifyObject(o, decoded, cover, measured_at);
    objects[i] = { ...base, class: verdict.class, ...(decoded.kind === "job_chunk" ? { job: decoded.job, chains: decoded.chains } : {}),
      ...(verdict.covering.length ? { covering: verdict.covering } : {}) };
    if (++done % 10_000 === 0) console.error(JSON.stringify({ classified: done, of: candidates.length }));
  });
  const tally = (rows: { size: number }[]) => ({ objects: rows.length, bytes: rows.reduce((s, r) => s + r.size, 0) });
  const classes: Record<string, { objects: number; bytes: number }> = {};
  for (const o of objects) { const c = (classes[o.class] ??= { objects: 0, bytes: 0 }); c.objects++; c.bytes += o.size; }
  const summary = {
    measured_at, finished_at: new Date(), database: db.databaseName, prefix,
    listed: tally(listed), referenced_hashes: referenced.size, unreferenced: tally(candidates), classes, errors: errors.slice(0, 50), error_count: errors.length,
  };
  await writeFile(file, JSON.stringify({ summary, objects }), { flag: "wx" });
  return summary;
}

type Progress = { hash: string; outcome: ApplyOutcome; at: string };
const TERMINAL = new Set<ApplyOutcome>(["released", "already_released", "object_missing", "generation_changed"]);
const WAIT_MS = 800_000 + 60_000;

async function apply(db: Db, manifestPath: string, limit: number) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { summary: { database: string }; objects: ManifestEntry[] };
  if (manifest.summary.database !== db.databaseName) throw new Error("Manifest is for another database");
  const progressPath = `${manifestPath}.apply.jsonl`;
  const last = new Map<string, Progress>();
  const prior = await readFile(progressPath, "utf8").catch(() => "");
  for (const line of prior.split("\n").filter(Boolean)) { const p = JSON.parse(line) as Progress; last.set(p.hash, p); }
  const now = new Date();
  const pending = manifest.objects.filter((o) => {
    if (o.class !== "confirmed_superseded") return false;
    const p = last.get(o.hash);
    if (!p) return true;
    if (TERMINAL.has(p.outcome)) return false;
    // A review started less than the drain ago cannot finish yet.
    return !(["review_started", "draining"].includes(p.outcome) && +now - Date.parse(p.at) < WAIT_MS);
  });
  // The release capability exists only while the bucket rule deletes 90 days after the clock (checkRecoveryPolicy).
  const { store } = await openObjectStore(db, "granot-history", { capability: "release" });
  const covered = new Map<string, Promise<boolean>>();
  const guards = {
    referenced: (hash: string) => objectReferenced(db, hash),
    covered: (hash: string) => { let p = covered.get(hash); if (!p) { p = objectReferenced(db, hash); covered.set(hash, p); } return p; },
  };
  const outcomes: Record<string, number> = {};
  let acted = 0, failures = 0;
  for (let start = 0; start < pending.length && acted < limit; start += 8) {
    const batch = pending.slice(start, start + 8);
    await Promise.all(batch.map(async (entry) => {
      try {
        const outcome = await applyEntry(store, db.databaseName, entry, guards, new Date());
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        if (outcome === "review_started" || outcome === "released") acted++;
        await appendFile(progressPath, JSON.stringify({ hash: entry.hash, outcome, at: new Date().toISOString() }) + "\n");
      } catch (error) {
        failures++;
        console.error(JSON.stringify({ hash: entry.hash, error: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
      }
    }));
  }
  return { review_token: UNREFERENCED_REVIEW_TOKEN, confirmed: manifest.objects.filter((o) => o.class === "confirmed_superseded").length,
    pending: pending.length, acted, outcomes, failures, progress: progressPath };
}

async function main() {
  const mode = process.argv[2];
  if (!["inventory", "apply"].includes(mode ?? "")) throw new Error("Expected inventory | apply");
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map((s) => s.trim()));
  const database = arg("--target");
  if (!database || (database !== "vantagemovers" && !/^testvantagemovers_[a-z0-9]+$/.test(database))) throw new Error("Expected --target=vantagemovers | testvantagemovers_<x>");
  const files = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const client = new MongoClient(process.env.MONGO_URI!, { maxPoolSize: 8, appName: "granot-unreferenced-objects" });
  try {
    const db = client.db(database);
    let out: unknown;
    if (mode === "inventory") {
      const file = files[0];
      if (!file?.endsWith(".json")) throw new Error("Supply a new private JSON output file");
      out = await inventory(db, file);
    } else {
      const file = files[0];
      if (!file?.endsWith(".json")) throw new Error("Supply the inventory manifest");
      const limit = Number(arg("--limit") ?? 200);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error("Expected --limit=1..5000");
      out = await apply(db, file, limit);
    }
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
