/**
 * Validated retirement of closed-day Daily Operations Events: operator command (docs/knowledge/validated-retirement.md).
 *
 *   pnpm dailyops:event-retirement status   --target=vantagemovers                   # read-only: switch, cursor, window, catalog, bucket rule
 *   pnpm dailyops:event-retirement dry-run  --target=vantagemovers [--limit=500000]  # read-only verdicts for the next events (no GCS, no writes)
 *   pnpm dailyops:event-retirement install  --target=vantagemovers                   # catalog indexes + the 90-day bucket rule
 *   pnpm dailyops:event-retirement enable   --target=vantagemovers                   # the cron starts retiring closed-day events
 *   pnpm dailyops:event-retirement disable  --target=vantagemovers                   # back to plain 400-day bodies
 *   pnpm dailyops:event-retirement run      --target=vantagemovers [--batches=20]    # one supervised worker pass (same code as the cron)
 *   pnpm dailyops:event-retirement lookup   --target=vantagemovers --id=<event>      # restore one archived event from GCS (read-only)
 *
 * `status`, `dry-run` and `lookup` only read (dry-run from a secondary). Write modes pass the production-writer guard. The
 * bucket rule is added with a metageneration precondition and only when no Delete rule already covers the prefix.
 * Prints one JSON summary; never prints the connection string or credentials.
 */
import mongoose from "mongoose";
import { google } from "googleapis";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { DAILY_OPERATIONS_EVENT_TTL_INDEX } from "../../src/models/DailyOperationsEvent";
import { checkRecoveryPolicy, openObjectStore, readCloudStorageConfig } from "../../src/services/cloudStorage";
import {
  EVENT_ARCHIVE_PACKS_COLLECTION, EVENT_ARCHIVE_PACK_INDEXES, EVENT_RETIREMENT_CONTROL_COLLECTION, EVENT_RETIREMENT_CONTROL_ID,
  eventsOf, eventVerdict, fenceOf, loadDays, lookupArchivedEvent, pendingFilter, retireClosedDayEvents, reviewWindow,
} from "../../src/services/dailyOperations/eventRetirement";
import { createGoogleServiceAccountAuth } from "../../src/services/googleAuth/serviceAccount";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

const MODES = ["status", "dry-run", "install", "enable", "disable", "run", "lookup"] as const;
type Mode = (typeof MODES)[number];
const NAMESPACE = "daily-operations-events" as const;
const size = (doc: unknown) => mongoose.mongo.BSON.calculateObjectSize(doc as never);

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
  if (mode === "lookup" && !/^[a-f0-9]{24}$/.test(flags.id ?? "")) throw new Error("--id=<event _id> is required");
  return { mode: mode as Mode, target, limit: int("limit", 5000, 2_000_000), batches: int("batches", 20, 2000), id: flags.id as string | undefined };
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
  const config = await readCloudStorageConfig(db, NAMESPACE);
  const scope = `${config.prefix}${database}/`;
  const controls = db.collection<{ _id: string; [k: string]: unknown }>(EVENT_RETIREMENT_CONTROL_COLLECTION);
  const now = new Date();
  let out: Record<string, unknown> = { mode: args.mode, database, collection: eventsOf(db).collectionName, measured_at: now.toISOString() };
  const control = await controls.findOne({ _id: EVENT_RETIREMENT_CONTROL_ID });
  const cursor = (control?.cursor as { created_at: Date; id?: null } | undefined) ?? null;
  const window = await reviewWindow(db, now);

  if (args.mode === "status") {
    const packs = await db.collection(EVENT_ARCHIVE_PACKS_COLLECTION).aggregate([{ $group: { _id: null, packs: { $sum: 1 }, rows: { $sum: "$rows" },
      retire: { $sum: "$retire" }, hold: { $sum: "$hold" }, bytes: { $sum: "$size" } } }]).toArray();
    const { rules } = await bucketRules(config.bucket);
    out = { ...out, enabled_at: control?.enabled_at ?? null, window, cursor: cursor?.created_at ?? null,
      lag_seconds: cursor?.created_at ? Math.round((+now - +cursor.created_at) / 1000) : null,
      pending: await eventsOf(db).countDocuments(pendingFilter(cursor, window.until), { hint: DAILY_OPERATIONS_EVENT_TTL_INDEX.name }),
      hot_events: await eventsOf(db).estimatedDocumentCount(), last_run: control?.last_run ?? null, catalog: packs[0] ?? { packs: 0 },
      bucket_rule: checkRecoveryPolicy(rules as never, scope, config.recoveryDays) };
  } else if (args.mode === "dry-run") {
    // Read-only by construction: a secondary read, no lease, no store, no write call.
    const scan = eventsOf(db).find(pendingFilter(cursor, window.until), { sort: { createdAt: 1 }, limit: args.limit,
      hint: DAILY_OPERATIONS_EVENT_TTL_INDEX.name, readPreference: "secondaryPreferred", batchSize: 1000 });
    const tally: Record<string, { rows: number; bytes: number; fence_bytes: number }> = {};
    const byDay: Record<string, Record<string, number>> = {};
    let scanned = 0, first: Date | null = null, last: Date | null = null;
    const flush = async (page: Record<string, unknown>[]) => {
      const days = await loadDays(db, page);
      for (const doc of page) {
        const v = eventVerdict(doc, days.get(doc.day as string), window.cutoffDay);
        const key = v.verdict === "retire" ? "retire" : `hold:${v.reason}`;
        const t = (tally[key] ??= { rows: 0, bytes: 0, fence_bytes: 0 });
        t.rows++; t.bytes += size(doc); if (v.verdict === "retire") t.fence_bytes += size(fenceOf(doc));
        const month = String(doc.day).slice(0, 7);
        (byDay[month] ??= {})[key] = (byDay[month]![key] ?? 0) + 1;
      }
    };
    let page: Record<string, unknown>[] = [];
    for await (const doc of scan) {
      scanned++; first ??= doc.createdAt as Date; last = doc.createdAt as Date;
      page.push(doc);
      if (page.length === 1000) { await flush(page); page = []; }
    }
    if (page.length) await flush(page);
    out = { ...out, window, cursor: cursor?.created_at ?? null, scanned, first_created_at: first, last_created_at: last, verdicts: tally, by_month: byDay };
  } else if (args.mode === "install") {
    const packs = db.collection(EVENT_ARCHIVE_PACKS_COLLECTION);
    for (const index of EVENT_ARCHIVE_PACK_INDEXES) await packs.createIndex(index.key, { name: index.name, ...("unique" in index ? { unique: true } : {}),
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
      const present = new Set((await db.collection(EVENT_ARCHIVE_PACKS_COLLECTION).indexes().catch(() => [])).map((i) => i.name));
      const absent = EVENT_ARCHIVE_PACK_INDEXES.filter((i) => !present.has(i.name)).map((i) => i.name);
      if (absent.length) throw new Error(`Refusing to enable: run install first (missing ${absent.join(", ")})`);
      await openObjectStore(db, NAMESPACE, { capability: "release" }); // checks the single 90-day rule through the module
    }
    await controls.updateOne({ _id: EVENT_RETIREMENT_CONTROL_ID }, args.mode === "enable"
      ? { $set: { enabled_at: now, updated_at: now }, $setOnInsert: { cursor: null } }
      : { $unset: { enabled_at: "" }, $set: { updated_at: now } }, { upsert: true });
    out = { ...out, control: await controls.findOne({ _id: EVENT_RETIREMENT_CONTROL_ID }) };
  } else if (args.mode === "run") {
    const runs: Awaited<ReturnType<typeof retireClosedDayEvents>>[] = [];
    for (let i = 0; i < args.batches; i += 4) {
      const run = await retireClosedDayEvents(db, { maxBatches: Math.min(4, args.batches - i), budgetMs: 120_000 });
      runs.push(run);
      if (run.status !== "ran" || run.batches === 0) break;
    }
    const sum = (k: "rows" | "retire" | "hold" | "fenced" | "packs" | "raw_bytes" | "packed_bytes") => runs.reduce((s, r) => s + r[k], 0);
    out = { ...out, passes: runs.length, last_status: runs.at(-1)?.status, reason: runs.at(-1)?.reason, rows: sum("rows"), retire: sum("retire"),
      hold: sum("hold"), fenced: sum("fenced"), packs: sum("packs"), raw_bytes: sum("raw_bytes"), packed_bytes: sum("packed_bytes"),
      held_reasons: runs.reduce<Record<string, number>>((a, r) => { for (const [k, n] of Object.entries(r.held_reasons)) a[k] = (a[k] ?? 0) + n; return a; }, {}),
      until: runs.at(-1)?.until, cutoff_day: runs.at(-1)?.cutoff_day, cursor: runs.at(-1)?.cursor, lag_seconds: runs.at(-1)?.lag_seconds };
  } else {
    const found = await lookupArchivedEvent(db, args.id!);
    const live = await eventsOf(db).findOne({ _id: new mongoose.Types.ObjectId(args.id!) }, { projection: { kind: 1, day: 1 } });
    out = { ...out, id: args.id, in_mongo: live ? (live.kind ? "full" : "fence") : null, archived: found ? { pack: found.pack, day: found.doc.day,
      kind: found.doc.kind, dedupe_key: found.doc.dedupe_key, bytes: found.raw.length } : null };
  }
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => mongoose.disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
