/**
 * What the Domain Command retirement operator commands share (docs/knowledge/validated-retirement.md): argument parsing,
 * the bucket rule check and install for `domain-records-retirement`, switch and catalog modes.
 * Write modes pass the production-writer guard. The bucket rule is added with a metageneration precondition and only when
 * no Delete rule already covers the prefix. Never prints the connection string or credentials.
 */
import mongoose from "mongoose";
import { google } from "googleapis";
import type { Db } from "mongodb";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { checkRecoveryPolicy, openObjectStore, readCloudStorageConfig } from "../../src/services/cloudStorage";
import { createCatalogIndexes, RETIREMENT_CONTROL_COLLECTION, RETIREMENT_NAMESPACE } from "../../src/services/domainCommands/retirement/shared";
import { createGoogleServiceAccountAuth } from "../../src/services/googleAuth/serviceAccount";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

export const MODES = ["status", "dry-run", "install", "enable", "disable", "run", "lookup"] as const;
export type Mode = (typeof MODES)[number];
type Index = { name: string; key: Record<string, unknown>; unique?: boolean; expireAfterSeconds?: number };
type Rule = { action: { type: string }; condition: Record<string, unknown> };

export function parse(argv: string[]) {
  const [mode, ...rest] = argv;
  if (!MODES.includes(mode as Mode)) throw new Error(`Mode must be one of ${MODES.join(", ")}`);
  const flags = Object.fromEntries(rest.map((a) => {
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
  if (flags.id !== undefined && !/^[a-f0-9]{24}$/.test(flags.id)) throw new Error("--id must be a 24-hex _id");
  return { mode: mode as Mode, target, limit: int("limit", 250_000, 1_000_000), batches: int("batches", 20, 500),
    id: flags.id as string | undefined, entity: flags.entity as string | undefined };
}

async function bucketRules(bucket: string) {
  const storage = google.storage({ version: "v1", auth: createGoogleServiceAccountAuth(["https://www.googleapis.com/auth/devstorage.full_control"]) });
  const { data } = await storage.buckets.get({ bucket, fields: "metageneration,lifecycle" });
  return { storage, metageneration: String(data.metageneration), rules: (data.lifecycle?.rule ?? []) as Rule[] };
}

/** Connects, checks the target, and guards write modes. `reader` reads from a secondary when one is available. */
export async function open(args: ReturnType<typeof parse>) {
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  await connectMongo();
  const db = mongoose.connection.db!;
  if (["install", "enable", "disable", "run"].includes(args.mode)) await assertProductionWriterMatchesDeployment();
  const reader = mongoose.connection.getClient().db(db.databaseName, { readPreference: "secondaryPreferred" }) as unknown as Db;
  const config = await readCloudStorageConfig(db, RETIREMENT_NAMESPACE);
  return { db, reader, database, config, scope: `${config.prefix}${database}/` };
}

export async function bucketRuleStatus(config: { bucket: string; recoveryDays: number }, scope: string) {
  const { rules } = await bucketRules(config.bucket);
  return checkRecoveryPolicy(rules as never, scope, config.recoveryDays);
}

/** Catalog indexes plus the single 90-day bucket rule for the shared prefix (added once, by whichever install runs first). */
export async function install(db: Db, catalog: string, indexes: readonly Index[], config: { bucket: string; recoveryDays: number }, scope: string) {
  await createCatalogIndexes(db, catalog, indexes);
  const { storage, metageneration, rules } = await bucketRules(config.bucket);
  const covering = rules.filter((r) => r.action?.type === "Delete" && ((r.condition.matchesPrefix as string[] | undefined) ?? [""]).some((p) => scope.startsWith(p) || p.startsWith(scope)));
  let rule = "present";
  if (!covering.length) {
    const next = [...rules, { action: { type: "Delete" }, condition: { daysSinceCustomTime: config.recoveryDays, matchesPrefix: [scope] } }];
    await storage.buckets.patch({ bucket: config.bucket, ifMetagenerationMatch: metageneration, requestBody: { lifecycle: { rule: next } } });
    rule = "added";
  }
  const after = await bucketRules(config.bucket);
  return { indexes: (await db.collection(catalog).indexes()).map((i) => i.name), bucket_rule: rule, metageneration_before: metageneration,
    metageneration_after: after.metageneration, rule_check: checkRecoveryPolicy(after.rules as never, scope, config.recoveryDays) };
}

/** `enable` refuses until install ran and the bucket rule checks out; `disable` stops the cron at its next run. */
export async function setSwitch(db: Db, id: string, on: boolean, catalog: string, indexes: readonly Index[], now: Date) {
  if (on) {
    const present = new Set((await db.collection(catalog).indexes().catch(() => [])).map((i) => i.name));
    const absent = indexes.filter((i) => !present.has(i.name)).map((i) => i.name);
    if (absent.length) throw new Error(`Refusing to enable: run install first (missing ${absent.join(", ")})`);
    await openObjectStore(db, RETIREMENT_NAMESPACE, { capability: "release" });
  }
  const controls = db.collection<{ _id: string }>(RETIREMENT_CONTROL_COLLECTION);
  await controls.updateOne({ _id: id }, on
    ? { $set: { enabled_at: now, updated_at: now }, $setOnInsert: { cursor: null } }
    : { $unset: { enabled_at: "" }, $set: { updated_at: now } }, { upsert: true });
  return controls.findOne({ _id: id });
}

export async function catalogSummary(db: Db, catalog: string) {
  const [row] = await db.collection(catalog).aggregate([{ $group: { _id: null, packs: { $sum: 1 }, rows: { $sum: "$rows" }, bytes: { $sum: "$size" } } }]).toArray();
  return row ?? { packs: 0 };
}

/** Supervised passes of the cron's own worker until it stops or `batches` is spent. */
export async function supervise<R extends { status: string; batches: number; rows: number; retire: number; hold: number; deleted: number;
  packs: number; raw_bytes: number; packed_bytes: number; held_reasons: Record<string, number>; cursor: string | null }>(batches: number, pass: (max: number) => Promise<R>) {
  const runs: R[] = [];
  for (let i = 0; i < batches; i += 4) {
    const run = await pass(Math.min(4, batches - i));
    runs.push(run);
    if (run.status !== "ran" || run.batches === 0) break;
  }
  const sum = (k: "rows" | "retire" | "hold" | "deleted" | "packs" | "raw_bytes" | "packed_bytes") => runs.reduce((s, r) => s + r[k], 0);
  return { passes: runs.length, last_status: runs.at(-1)?.status, rows: sum("rows"), retire: sum("retire"), hold: sum("hold"), deleted: sum("deleted"),
    packs: sum("packs"), raw_bytes: sum("raw_bytes"), packed_bytes: sum("packed_bytes"),
    held_reasons: runs.reduce<Record<string, number>>((a, r) => { for (const [k, n] of Object.entries(r.held_reasons)) a[k] = (a[k] ?? 0) + n; return a; }, {}),
    cursor: runs.at(-1)?.cursor ?? null };
}

export function finish(main: () => Promise<void>) {
  main().finally(() => mongoose.disconnect()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
