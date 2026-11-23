/**
 * Validated retirement of completed Sales Intelligence jobs: operator command (docs/knowledge/validated-retirement.md).
 *
 *   pnpm outreach:job-retirement status   --target=vantagemovers                 # read-only: switch, cursor lag, catalog, bucket rule
 *   pnpm outreach:job-retirement dry-run  --target=vantagemovers [--limit=5000]  # read-only verdicts for the next rows (no GCS, no writes)
 *   pnpm outreach:job-retirement install  --target=vantagemovers                 # catalog indexes + the 90-day bucket rule (Owner-approved)
 *   pnpm outreach:job-retirement enable   --target=vantagemovers                 # completions keep full rows; the cron retires them
 *   pnpm outreach:job-retirement disable  --target=vantagemovers                 # back to on-the-spot receipts
 *   pnpm outreach:job-retirement run      --target=vantagemovers [--batches=20]  # one supervised worker pass (same code as the cron)
 *   pnpm outreach:job-retirement lookup   --target=vantagemovers --id=<job _id>  # restore one archived job from GCS (read-only)
 *
 * Write modes pass the production-writer guard. The bucket rule is added with a metageneration precondition and only when no
 * Delete rule already covers the v2 prefix. Prints one JSON summary; never prints the connection string or credentials.
 */
import mongoose from "mongoose";
import { BSON, type Document } from "mongodb";
import { google } from "googleapis";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { checkRecoveryPolicy, openObjectStore, readCloudStorageConfig } from "../../src/services/cloudStorage";
import { createGoogleServiceAccountAuth } from "../../src/services/googleAuth/serviceAccount";
import { RETIREMENT_CONTROL_COLLECTION, RETIREMENT_CONTROL_ID } from "../../src/services/salesIntelligence/retirement/control";
import { loadEffects, verdictOf } from "../../src/services/salesIntelligence/retirement/evidence";
import { ARCHIVE_PACKS_COLLECTION, ARCHIVE_PACK_INDEXES, RETIREMENT_SETTLE_MS, lookupArchivedJob, retireCompletedJobs } from "../../src/services/salesIntelligence/retirement/worker";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

const MODES = ["status", "dry-run", "install", "enable", "disable", "run", "lookup"] as const;
type Mode = (typeof MODES)[number];

function parse(argv: string[]) {
  const [mode, ...rest] = argv;
  if (!MODES.includes(mode as Mode)) throw new Error(`Mode must be one of ${MODES.join(", ")}`);
  const flags = Object.fromEntries(rest.filter((a) => a !== "--allow-schema-drift").map((a) => {
    const m = /^--([a-z-]+)=(.+)$/.exec(a);
    if (!m) throw new Error(`Unknown argument: ${a}`);
    return [m[1], m[2]];
  }));
  const target = flags.target;
  if (!target || !/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target=<database name> is required");
  const int = (name: string, fallback: number, max: number) => {
    if (flags[name] === undefined) return fallback;
    const n = Number(flags[name]);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`--${name} must be 1..${max}`);
    return n;
  };
  if (mode === "lookup" && !/^[a-f0-9]{24}$/.test(flags.id ?? "")) throw new Error("--id=<job _id> is required");
  return { mode: mode as Mode, target, limit: int("limit", 5000, 500_000), batches: int("batches", 20, 500), id: flags.id as string | undefined };
}

async function bucketRules(bucket: string) {
  const storage = google.storage({ version: "v1", auth: createGoogleServiceAccountAuth(["https://www.googleapis.com/auth/devstorage.full_control"]) });
  const { data } = await storage.buckets.get({ bucket, fields: "metageneration,lifecycle" });
  return { storage, metageneration: String(data.metageneration), rules: (data.lifecycle?.rule ?? []) as Array<{ action: { type: string }; condition: Record<string, unknown> }> };
}

async function main() {
  const args = parse(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  const db = mongoose.connection.db!;
  if (["install", "enable", "disable", "run"].includes(args.mode)) await assertProductionWriterMatchesDeployment();
  const config = await readCloudStorageConfig(db, "sales-intelligence-retirement");
  const scope = `${config.prefix}${database}/`;
  const controls = db.collection<{ _id: string; [k: string]: unknown }>(RETIREMENT_CONTROL_COLLECTION);
  const now = new Date();
  let out: Record<string, unknown> = { mode: args.mode, database, measured_at: now.toISOString() };

  if (args.mode === "status") {
    const control = await controls.findOne({ _id: RETIREMENT_CONTROL_ID });
    const packs = await db.collection(ARCHIVE_PACKS_COLLECTION).aggregate([{ $group: { _id: null, packs: { $sum: 1 }, rows: { $sum: "$rows" },
      retire: { $sum: "$retire" }, hold: { $sum: "$hold" }, keep: { $sum: "$keep" }, bytes: { $sum: "$size" } } }]).toArray();
    const cursor = (control?.cursor as { completed_at?: Date } | undefined)?.completed_at ?? null;
    const pending = await db.collection("sales_intelligence_jobs").countDocuments({ ...csiDataset(), status: "completed", record_kind: { $exists: false },
      completed_at: { ...(cursor ? { $gt: cursor } : {}), $lte: new Date(+now - RETIREMENT_SETTLE_MS) } }, { hint: "csi_job_completed_ttl" });
    const { rules } = await bucketRules(config.bucket);
    out = { ...out, enabled_at: control?.enabled_at ?? null, cursor, lag_seconds: cursor ? Math.round((+now - +cursor) / 1000) : null, settled_rows_pending: pending,
      last_run: control?.last_run ?? null, catalog: packs[0] ?? { packs: 0 }, bucket_rule: checkRecoveryPolicy(rules as never, scope, config.recoveryDays) };
  } else if (args.mode === "dry-run") {
    const control = await controls.findOne({ _id: RETIREMENT_CONTROL_ID });
    const cursor = (control?.cursor as { completed_at?: Date } | undefined)?.completed_at ?? null;
    const stream = db.collection("sales_intelligence_jobs").find({ ...csiDataset(), status: "completed", record_kind: { $exists: false },
      completed_at: { ...(cursor ? { $gt: cursor } : {}), $lte: new Date(+now - RETIREMENT_SETTLE_MS) } },
    { sort: { completed_at: 1 }, limit: args.limit, hint: "csi_job_completed_ttl", readPreference: "secondaryPreferred", batchSize: 500 });
    const tally: Record<string, { rows: number; bytes: number }> = {};
    let page: Document[] = [], scanned = 0, first: unknown = null, last: unknown = null;
    const flush = async () => {
      const effects = await loadEffects(db, page);
      for (const doc of page) {
        const v = verdictOf(doc, effects);
        const key = `${v.verdict}:${v.verdict === "retire" ? doc.stage : v.reason}`;
        const t = (tally[key] ??= { rows: 0, bytes: 0 });
        t.rows++; t.bytes += BSON.calculateObjectSize(doc);
      }
      page = [];
    };
    for await (const doc of stream) {
      first ??= doc.completed_at; last = doc.completed_at; scanned++;
      page.push(doc);
      if (page.length === 500) await flush();
    }
    if (page.length) await flush();
    out = { ...out, cursor, scanned, first_completed_at: first, last_completed_at: last, verdicts: tally };
  } else if (args.mode === "install") {
    const packs = db.collection(ARCHIVE_PACKS_COLLECTION);
    for (const index of ARCHIVE_PACK_INDEXES) await packs.createIndex(index.key, { name: index.name, ...("unique" in index ? { unique: true } : {}),
      ...("expireAfterSeconds" in index ? { expireAfterSeconds: index.expireAfterSeconds } : {}) });
    const { storage, metageneration, rules } = await bucketRules(config.bucket);
    const covering = rules.filter((r) => r.action?.type === "Delete" && ((r.condition.matchesPrefix as string[] | undefined) ?? [""]).some((p) => scope.startsWith(p) || p.startsWith(scope)));
    let rule = "present";
    if (!covering.length) {
      const next = [...rules, { action: { type: "Delete" }, condition: { daysSinceCustomTime: config.recoveryDays, matchesPrefix: [scope] } }];
      await storage.buckets.patch({ bucket: config.bucket, ifMetagenerationMatch: metageneration, requestBody: { lifecycle: { rule: next } } });
      rule = "added";
    }
    const after = await bucketRules(config.bucket);
    out = { ...out, indexes: (await packs.indexes()).map((i) => i.name), bucket_rule: rule, metageneration_before: metageneration,
      metageneration_after: after.metageneration, rule_check: checkRecoveryPolicy(after.rules as never, scope, config.recoveryDays), rules_after: after.rules };
  } else if (args.mode === "enable" || args.mode === "disable") {
    if (args.mode === "enable") {
      const present = new Set((await db.collection(ARCHIVE_PACKS_COLLECTION).indexes().catch(() => [])).map((i) => i.name));
      const absent = ARCHIVE_PACK_INDEXES.filter((i) => !present.has(i.name)).map((i) => i.name);
      if (absent.length) throw new Error(`Refusing to enable: run install first (missing ${absent.join(", ")})`);
      const { rules } = await bucketRules(config.bucket);
      const check = checkRecoveryPolicy(rules as never, scope, config.recoveryDays);
      if (!check.ok) throw new Error(`Refusing to enable: ${check.reason}`);
      await openObjectStore(db, "sales-intelligence-retirement", { capability: "release" }); // re-checks the rule through the module
    }
    await controls.updateOne({ _id: RETIREMENT_CONTROL_ID }, args.mode === "enable"
      ? { $set: { enabled_at: now, updated_at: now }, $setOnInsert: { cursor: null } }
      : { $unset: { enabled_at: "" }, $set: { updated_at: now } }, { upsert: true });
    out = { ...out, control: await controls.findOne({ _id: RETIREMENT_CONTROL_ID }) };
  } else if (args.mode === "run") {
    const runs: Awaited<ReturnType<typeof retireCompletedJobs>>[] = [];
    for (let i = 0; i < args.batches; i += 4) {
      const run = await retireCompletedJobs(db, { maxBatches: Math.min(4, args.batches - i), budgetMs: 120_000 });
      runs.push(run);
      if (run.status !== "ran" || run.batches === 0) break;
    }
    const sum = (k: "rows" | "retire" | "hold" | "keep" | "compacted" | "purge_only" | "packs" | "raw_bytes" | "packed_bytes") => runs.reduce((s, r) => s + r[k], 0);
    out = { ...out, passes: runs.length, last_status: runs.at(-1)?.status, rows: sum("rows"), retire: sum("retire"), hold: sum("hold"), keep: sum("keep"),
      compacted: sum("compacted"), purge_only: sum("purge_only"), packs: sum("packs"), raw_bytes: sum("raw_bytes"), packed_bytes: sum("packed_bytes"),
      held_reasons: runs.reduce<Record<string, number>>((a, r) => { for (const [k, n] of Object.entries(r.held_reasons)) a[k] = (a[k] ?? 0) + n; return a; }, {}),
      cursor: runs.at(-1)?.cursor, lag_seconds: runs.at(-1)?.lag_seconds };
  } else {
    const found = await lookupArchivedJob(db, args.id!);
    const live = await db.collection("sales_intelligence_jobs").findOne({ _id: new mongoose.Types.ObjectId(args.id!) }, { projection: { record_kind: 1, status: 1 } });
    out = { ...out, id: args.id, in_mongo: live ?? null, archived: found ? { pack: found.pack, stage: found.doc.stage, status: found.doc.status,
      completed_at: found.doc.completed_at, has_result: found.doc.result !== undefined, bytes: BSON.calculateObjectSize(found.doc) } : null };
  }
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => mongoose.disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
