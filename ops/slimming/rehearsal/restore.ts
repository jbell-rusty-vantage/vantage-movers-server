/**
 * Isolated restore of one purge backup (DATA-AND-STORAGE §3: "restore into an isolated database and demonstrate
 * readability/reference match"). Loopback replica only; the target is a `slimrehearsal_<suffix>` database and a
 * collection that must not exist yet. Never restores over a live namespace.
 *
 *   MONGO_URI=<loopback> node --import tsx ops/slimming/rehearsal/restore.ts --run-dir=<purge run dir> \
 *     --namespace=<db.collection as backed up> --into-db=slimrehearsal_restore --into-collection=<name>
 *
 * Steps: verify the backup file (count + sha256), insert every document, recreate the recorded indexes (`_id_`
 * aside; partial indexes are reported, not guessed), then re-dump the restored collection with the purge's own
 * backup writer (`_id` order, same gzip level) and require the same document count and the same sha256.
 */
import { createReadStream, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { BSON, type Document } from "mongodb";
import { type BackupEntry, verifyBackupFile, writeBackupFile } from "../lib/backup";
import { REHEARSAL_DATABASE_PATTERN } from "../lib/rehearsal";
import { arg, connectLoopbackReplica } from "./guard";

async function main(): Promise<void> {
  const runDir = arg("run-dir") ?? "";
  const namespace = arg("namespace") ?? "";
  const intoDb = arg("into-db") ?? "";
  const intoCollection = arg("into-collection") ?? "";
  if (!runDir || !namespace || !intoCollection) throw new Error("--run-dir, --namespace and --into-collection are required");
  if (!REHEARSAL_DATABASE_PATTERN.test(intoDb)) throw new Error("--into-db must be an isolated slimrehearsal_<suffix> database");
  if (!/^[a-z0-9_]+$/.test(intoCollection)) throw new Error("--into-collection must be a plain collection name");

  const log = JSON.parse(readFileSync(join(runDir, "purge-log.json"), "utf8")) as { manifest_hash: string; backups: BackupEntry[] };
  const entry = log.backups.find((b) => b.namespace === namespace && Object.keys(b.filter ?? {}).length === 0);
  if (!entry) throw new Error(`no full backup of ${namespace} in ${runDir}`);
  const file = join(runDir, entry.file);
  await verifyBackupFile(file, entry);

  const client = await connectLoopbackReplica();
  try {
    const target = client.db(intoDb).collection(intoCollection);
    if ((await client.db(intoDb).listCollections({ name: intoCollection }).toArray()).length) throw new Error(`${intoDb}.${intoCollection} already exists`);
    let inserted = 0;
    let batch: Document[] = [];
    const flush = async () => {
      if (!batch.length) return;
      inserted += (await target.insertMany(batch, { ordered: true })).insertedCount;
      batch = [];
    };
    for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
      if (!line) continue;
      batch.push(BSON.EJSON.parse(line, { relaxed: false }) as Document);
      if (batch.length >= 500) await flush();
    }
    await flush();

    const recreated: string[] = [];
    const skipped: string[] = [];
    for (const index of entry.indexes) {
      if (index.name === "_id_") continue;
      if (index.partial) {
        skipped.push(`${index.name} (partial filter not recorded)`);
        continue;
      }
      await target.createIndex(index.key, {
        name: index.name,
        ...(index.unique ? { unique: true } : {}),
        ...(typeof index.expireAfterSeconds === "number" ? { expireAfterSeconds: index.expireAfterSeconds } : {}),
      });
      recreated.push(index.name);
    }

    const verifyFile = join(runDir, `restore-verify-${intoDb}.${intoCollection}.ejson.gz`);
    const redump = await writeBackupFile(target.find({}, { sort: { _id: 1 } }), verifyFile);
    rmSync(verifyFile, { force: true });
    const result = {
      namespace,
      restored_into: `${intoDb}.${intoCollection}`,
      backup: { file: entry.file, documents: entry.documents, sha256: entry.sha256 },
      restored: { inserted, documents: redump.documents, sha256: redump.sha256 },
      count_match: redump.documents === entry.documents && inserted === entry.documents,
      sha256_match: redump.sha256 === entry.sha256,
      indexes: { recreated, skipped },
    };
    process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
    if (!result.count_match || !result.sha256_match) process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[rehearsal-restore] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
