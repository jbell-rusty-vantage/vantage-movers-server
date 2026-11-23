/**
 * Granot history end of life (Owner decision 2, 2026-11-23). Run with the server environment loaded:
 *
 *   node --env-file=.env --import tsx ops/granot-history-end-of-life.ts status
 *   node --env-file=.env --import tsx ops/granot-history-end-of-life.ts dry-run [--kind receipt|evidence|history] <new private JSON file>
 *       Read-only MongoDB, no GCS request: objects that would start their clock, objects kept by reason,
 *       and the rows (count and BSON bytes) that would expire. Each object is judged on its own, so a
 *       release that marks a shared row can make another object eligible later; the live pass rechecks.
 *   node --env-file=.env --import tsx ops/granot-history-end-of-life.ts install
 *       Idempotent: the sparse hash indexes, the two `expires_at` TTLs and the state indexes.
 *   node --env-file=.env --import tsx ops/granot-history-end-of-life.ts enable --kinds receipt,evidence[,history]
 *   node --env-file=.env --import tsx ops/granot-history-end-of-life.ts disable
 *   node --env-file=.env --import tsx ops/granot-history-end-of-life.ts run --passes N [--limit M]
 *       The backlog: N passes of the online pass (`endOfLifePass`) with M objects per step (default 64).
 *       Needs `enable` first. Each object needs two passes 800 s apart (review hold, then the clock).
 *   (--database testvantagemovers_<x> targets a disposable test database instead of production.)
 *
 * Every mode except status and dry-run needs Owner approval. The online pass and `run` refuse until the
 * bucket rule for `history/granot/v1/<db>/` deletes 90 days after `customTime` (`checkRecoveryPolicy`).
 * Rollback: `disable`. Rows already marked keep their `expires_at`; objects already on their clock keep it
 * (a re-put re-holds one). Runbook: docs/knowledge/granot-lifecycle/storage-retention-operations.md#end-of-life.
 */
import dns from "node:dns";
import { writeFile } from "node:fs/promises";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { CLOUD_STORAGE_NAMESPACES, checkRecoveryPolicy, readCloudStorageConfig } from "../src/services/cloudStorage";
import { createGcsDriver } from "../src/services/cloudStorage/gcsDriver";
import {
  END_OF_LIFE_CONTROL, END_OF_LIFE_KINDS, END_OF_LIFE_STATE, endOfLifePass, installEndOfLife, referencesOf, scanCandidates, type EndOfLifeKind,
} from "../src/services/granotHistory/endOfLife";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const control = (db: Db) => db.collection<{ _id: string; enabled_at?: Date; kinds?: EndOfLifeKind[] }>("granot_retention_control");

function kindsArg(value: string | undefined): EndOfLifeKind[] {
  const kinds = (value ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (!kinds.length || kinds.some((k) => !(END_OF_LIFE_KINDS as readonly string[]).includes(k))) throw new Error(`Expected --kinds from ${END_OF_LIFE_KINDS.join(",")}`);
  return kinds as EndOfLifeKind[];
}

async function status(db: Db) {
  const config = await readCloudStorageConfig(db, "granot-history");
  const rules = await createGcsDriver({ bucket: config.bucket, timeouts: config.timeouts }).lifecycle();
  const expiring = async (name: string) => db.collection(name).countDocuments({ expires_at: { $exists: true } });
  return {
    control: await db.collection("granot_retention_control").findOne({ _id: END_OF_LIFE_CONTROL as never }),
    recovery_days: config.recoveryDays,
    bucket_rule: checkRecoveryPolicy(rules, `${config.prefix}${db.databaseName}/`, config.recoveryDays),
    reviewing: await db.collection(END_OF_LIFE_STATE).countDocuments({ due_at: { $exists: true } }),
    queued: await db.collection(END_OF_LIFE_STATE).countDocuments({ queued_at: { $exists: true } }),
    expiring_rows: { granot_archived_receipts: await expiring("granot_archived_receipts"), granot_history_archive_chunks: await expiring("granot_history_archive_chunks") },
  };
}

async function dryRun(db: Db, only?: EndOfLifeKind) {
  const report: Record<string, { objects: number; eligible: number; kept: Record<string, number>; rows_to_expire: number; row_bytes: number }> = {};
  for (const kind of only ? [only] : END_OF_LIFE_KINDS) {
    const tally = { objects: 0, eligible: 0, kept: {} as Record<string, number>, rows_to_expire: 0, row_bytes: 0 };
    const seen = new Set<string>(), rows = { archived: new Set<string>(), chunks: new Set<string>() };
    for (let cursor: unknown = null; ;) {
      const page = await scanCandidates(db, kind, cursor, 500);
      if (!page.length) break;
      cursor = page.at(-1)!.cursor;
      const hashes = [...new Set(page.map((r) => r.hash))].filter((h) => !seen.has(h));
      hashes.forEach((h) => seen.add(h));
      for (const [, refs] of await referencesOf(db, hashes)) {
        tally.objects++;
        if (refs.blocked) { tally.kept[refs.blocked] = (tally.kept[refs.blocked] ?? 0) + 1; continue; }
        tally.eligible++;
        for (const r of refs.rows) rows[r.coll].add(String(r._id));
      }
    }
    for (const [coll, ids] of [["granot_archived_receipts", rows.archived], ["granot_history_archive_chunks", rows.chunks]] as const) {
      tally.rows_to_expire += ids.size;
      const list = [...ids];
      for (let i = 0; i < list.length; i += 2000) {
        const slice = list.slice(i, i + 2000);
        const keys = coll === "granot_archived_receipts" ? slice.map((id) => new ObjectId(id)) : slice;
        const [sum] = await db.collection(coll).aggregate([{ $match: { _id: { $in: keys } } }, { $group: { _id: null, bytes: { $sum: { $bsonSize: "$$ROOT" } } } }]).toArray();
        tally.row_bytes += sum?.bytes ?? 0;
      }
    }
    report[kind] = tally;
  }
  return report;
}

async function main() {
  const mode = process.argv[2];
  if (!["status", "dry-run", "install", "enable", "disable", "run"].includes(mode ?? "")) throw new Error("Expected status | dry-run | install | enable | disable | run");
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map((s) => s.trim()));
  const database = arg("--database") ?? "vantagemovers";
  if (database !== "vantagemovers" && !/^testvantagemovers_[a-z0-9]+$/.test(database)) throw new Error("Unexpected database");
  const client = new MongoClient(process.env.MONGO_URI!, { maxPoolSize: 4, appName: "granot-history-end-of-life" });
  try {
    const db = client.db(database);
    let out: unknown;
    if (mode === "status") out = await status(db);
    else if (mode === "dry-run") {
      const file = process.argv.at(-1)!;
      if (!file.endsWith(".json")) throw new Error("Supply a new private JSON output file");
      const kind = arg("--kind") as EndOfLifeKind | undefined;
      if (kind && !(END_OF_LIFE_KINDS as readonly string[]).includes(kind)) throw new Error("Unknown --kind");
      const report = { measured_at: new Date(), database, recovery_days_default: CLOUD_STORAGE_NAMESPACES["granot-history"].recoveryDays, kinds: await dryRun(db, kind) };
      await writeFile(file, JSON.stringify(report, null, 2), { flag: "wx" });
      out = report;
    } else if (mode === "install") { await installEndOfLife(db); out = { installed: true }; }
    else if (mode === "enable") {
      const kinds = kindsArg(arg("--kinds"));
      await installEndOfLife(db);
      await control(db).updateOne({ _id: END_OF_LIFE_CONTROL }, { $set: { enabled_at: new Date(), kinds } }, { upsert: true });
      out = await control(db).findOne({ _id: END_OF_LIFE_CONTROL });
    } else if (mode === "disable") {
      await control(db).updateOne({ _id: END_OF_LIFE_CONTROL }, { $unset: { enabled_at: "" } });
      out = { end_of_life: "disabled" };
    } else {
      const passes = Number(arg("--passes")), limit = Number(arg("--limit") ?? 64);
      if (!Number.isInteger(passes) || passes < 1 || passes > 500 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Expected --passes 1..500 [--limit 1..500]");
      const runs = [];
      for (let i = 0; i < passes; i++) {
        const run = await endOfLifePass(db, { limit, page: 1000, budgetMs: 120_000 });
        runs.push(run);
        console.error(JSON.stringify({ pass: i + 1, ...run }));
        if (run.status !== "ran") break;
      }
      out = { passes: runs.length, released: runs.reduce((s, r) => s + r.released, 0), reviews_started: runs.reduce((s, r) => s + r.reviews_started, 0), failures: runs.reduce((s, r) => s + r.failures, 0) };
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
