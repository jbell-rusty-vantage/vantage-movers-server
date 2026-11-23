/**
 * Validated retirement of RingCentral webhook receipts: operator command (docs/knowledge/validated-retirement.md).
 *
 *   pnpm ringcentral:receipt-retirement status   --target=vantagemovers                 # read-only: switch, cursor, catalog, bucket rule
 *   pnpm ringcentral:receipt-retirement dry-run  --target=vantagemovers [--limit=5000]  # read-only verdicts for the next receipts (no GCS, no writes)
 *   pnpm ringcentral:receipt-retirement install  --target=vantagemovers                 # catalog indexes + the 90-day bucket rule (Owner decision 5)
 *   pnpm ringcentral:receipt-retirement enable   --target=vantagemovers                 # the cron starts retiring proven receipts
 *   pnpm ringcentral:receipt-retirement disable  --target=vantagemovers                 # back to the plain 7-day TTL
 *   pnpm ringcentral:receipt-retirement run      --target=vantagemovers [--batches=20]  # one supervised worker pass (same code as the cron)
 *   pnpm ringcentral:receipt-retirement lookup   --target=vantagemovers --id=<receipt>  # restore one archived receipt from GCS (read-only)
 *
 * Write modes pass the production-writer guard. The bucket rule is added with a metageneration precondition and only when no
 * Delete rule already covers the prefix. Prints one JSON summary; never prints the connection string or credentials.
 */
import mongoose from "mongoose";
import { google } from "googleapis";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { checkRecoveryPolicy, openObjectStore, readCloudStorageConfig } from "../../src/services/cloudStorage";
import { createGoogleServiceAccountAuth } from "../../src/services/googleAuth/serviceAccount";
import {
  RECEIPT_ARCHIVE_PACKS_COLLECTION, RECEIPT_ARCHIVE_PACK_INDEXES, RECEIPT_RETIREMENT_CONTROL_COLLECTION, RECEIPT_RETIREMENT_CONTROL_ID,
  loadEvidence, lookupArchivedReceipt, receiptsOf, receiptVerdict, retireProvenReceipts, reviewUntil,
} from "../../src/services/numberActivity/receiptRetirement";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

const MODES = ["status", "dry-run", "install", "enable", "disable", "run", "lookup"] as const;
type Mode = (typeof MODES)[number];
const NAMESPACE = "ringcentral-webhook-receipts" as const;

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
  if (mode === "lookup" && !/^[a-f0-9]{24}$/.test(flags.id ?? "")) throw new Error("--id=<receipt _id> is required");
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
  const config = await readCloudStorageConfig(db, NAMESPACE);
  const scope = `${config.prefix}${database}/`;
  const controls = db.collection<{ _id: string; [k: string]: unknown }>(RECEIPT_RETIREMENT_CONTROL_COLLECTION);
  const now = new Date();
  let out: Record<string, unknown> = { mode: args.mode, database, measured_at: now.toISOString() };
  const control = await controls.findOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID });
  const cursor = (control?.cursor as { received_at?: Date; id?: unknown } | undefined) ?? null;
  const until = await reviewUntil(db, now);
  const pendingFilter = (): Record<string, unknown> => ({ provider: "ringcentral", telephonySessionId: { $type: "string" }, receivedAt: { $lte: until ?? new Date(0) },
    ...(cursor?.received_at ? { $or: [{ receivedAt: { $gt: cursor.received_at } }, { receivedAt: cursor.received_at, _id: { $gt: cursor.id } }] } : {}) });

  if (args.mode === "status") {
    const packs = await db.collection(RECEIPT_ARCHIVE_PACKS_COLLECTION).aggregate([{ $group: { _id: null, packs: { $sum: 1 }, rows: { $sum: "$rows" },
      retire: { $sum: "$retire" }, hold: { $sum: "$hold" }, bytes: { $sum: "$size" } } }]).toArray();
    const { rules } = await bucketRules(config.bucket);
    out = { ...out, enabled_at: control?.enabled_at ?? null, review_until: until, cursor: cursor?.received_at ?? null,
      lag_seconds: cursor?.received_at ? Math.round((+now - +cursor.received_at) / 1000) : null,
      reviewable_pending: until ? await receiptsOf(db).countDocuments(pendingFilter(), { hint: { provider: 1, receivedAt: 1, _id: 1 } }) : null,
      hot_receipts: await receiptsOf(db).estimatedDocumentCount(), last_run: control?.last_run ?? null, catalog: packs[0] ?? { packs: 0 },
      bucket_rule: checkRecoveryPolicy(rules as never, scope, config.recoveryDays) };
  } else if (args.mode === "dry-run") {
    if (!until) throw new Error("Nothing is reviewable: no receipt watermark or no telephony receipt");
    const docs = await receiptsOf(db).find(pendingFilter(), { sort: { receivedAt: 1, _id: 1 }, limit: args.limit,
      hint: { provider: 1, receivedAt: 1, _id: 1 }, readPreference: "secondaryPreferred" }).toArray();
    const tally: Record<string, { rows: number; bytes: number }> = {};
    for (let i = 0; i < docs.length; i += 500) {
      const page = docs.slice(i, i + 500);
      const { jobs, effects, jobPacks } = await loadEvidence(db, page);
      for (const doc of page) {
        const v = receiptVerdict(doc, jobs, effects, jobPacks);
        const key = v.verdict === "retire" ? "retire" : `hold:${v.reason}`;
        const t = (tally[key] ??= { rows: 0, bytes: 0 });
        t.rows++; t.bytes += mongoose.mongo.BSON.calculateObjectSize(doc);
      }
    }
    out = { ...out, review_until: until, cursor: cursor?.received_at ?? null, scanned: docs.length,
      first_received_at: docs[0]?.receivedAt ?? null, last_received_at: docs.at(-1)?.receivedAt ?? null, verdicts: tally };
  } else if (args.mode === "install") {
    const packs = db.collection(RECEIPT_ARCHIVE_PACKS_COLLECTION);
    for (const index of RECEIPT_ARCHIVE_PACK_INDEXES) await packs.createIndex(index.key, { name: index.name, ...("unique" in index ? { unique: true } : {}),
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
      const present = new Set((await db.collection(RECEIPT_ARCHIVE_PACKS_COLLECTION).indexes().catch(() => [])).map((i) => i.name));
      const absent = RECEIPT_ARCHIVE_PACK_INDEXES.filter((i) => !present.has(i.name)).map((i) => i.name);
      if (absent.length) throw new Error(`Refusing to enable: run install first (missing ${absent.join(", ")})`);
      await openObjectStore(db, NAMESPACE, { capability: "release" }); // checks the single 90-day rule through the module
    }
    await controls.updateOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID }, args.mode === "enable"
      ? { $set: { enabled_at: now, updated_at: now }, $setOnInsert: { cursor: null } }
      : { $unset: { enabled_at: "" }, $set: { updated_at: now } }, { upsert: true });
    out = { ...out, control: await controls.findOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID }) };
  } else if (args.mode === "run") {
    const runs: Awaited<ReturnType<typeof retireProvenReceipts>>[] = [];
    for (let i = 0; i < args.batches; i += 4) {
      const run = await retireProvenReceipts(db, { maxBatches: Math.min(4, args.batches - i), budgetMs: 120_000 });
      runs.push(run);
      if (run.status !== "ran" || run.batches === 0) break;
    }
    const sum = (k: "rows" | "retire" | "hold" | "deleted" | "packs" | "raw_bytes" | "packed_bytes") => runs.reduce((s, r) => s + r[k], 0);
    out = { ...out, passes: runs.length, last_status: runs.at(-1)?.status, rows: sum("rows"), retire: sum("retire"), hold: sum("hold"), deleted: sum("deleted"),
      packs: sum("packs"), raw_bytes: sum("raw_bytes"), packed_bytes: sum("packed_bytes"),
      held_reasons: runs.reduce<Record<string, number>>((a, r) => { for (const [k, n] of Object.entries(r.held_reasons)) a[k] = (a[k] ?? 0) + n; return a; }, {}),
      until: runs.at(-1)?.until, cursor: runs.at(-1)?.cursor, lag_seconds: runs.at(-1)?.lag_seconds };
  } else {
    const found = await lookupArchivedReceipt(db, args.id!);
    const live = await receiptsOf(db).findOne({ _id: new mongoose.Types.ObjectId(args.id!) }, { projection: { _id: 1 } });
    out = { ...out, id: args.id, in_mongo: live !== null, archived: found ? { pack: found.pack, receivedAt: found.doc.receivedAt, uuid: found.doc.uuid ?? null,
      telephonySessionId: found.doc.telephonySessionId ?? null, has_raw_body: found.doc.rawBody !== undefined, bytes: mongoose.mongo.BSON.calculateObjectSize(found.doc) } : null };
  }
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => mongoose.disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
