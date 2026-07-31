import { randomUUID } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import { ObjectId } from "mongodb";
import { assertArtifactHash, sha256 } from "./stableJson";
import { comparable, mongoDocument, matchesPlanned } from "./mongoValues";
import { assertApplyAuthorized, type ApplyAuthorization } from "./targetGuard";
import { requireHistoricalMigrationContext } from "./migrationContext";
import { acquireHistoricalOperationalLock, assertHistoricalOperationalFence, heartbeatHistoricalOperationalLock, releaseHistoricalOperationalLock } from "./operationalLock";
import type { ApplyResult, HistoricalManifest, HistoricalOperation } from "./types";

const REGISTRY = "historical_import_registry";
const JOURNAL = "historical_import_apply_journal";
const SIDE_EFFECT_COLLECTIONS = ["sheet_sync_jobs", "lead_messages", "operational_events", "notification_deliveries"];

export async function applyHistoricalManifest(
  manifest: HistoricalManifest,
  db: Db,
  authorization: ApplyAuthorization,
  options: { batch_size?: number; lock_owner?: string } = {},
): Promise<ApplyResult> {
  assertArtifactHash(manifest);
  assertApplyAuthorized(manifest, db.databaseName, authorization);
  requireHistoricalMigrationContext();
  await preflightHistoricalManifest(manifest, db);
  await ensureOperationalIndexes(db);
  const lockOwner = options.lock_owner ?? `${process.pid}:${randomUUID()}`;
  const lock = await acquireHistoricalOperationalLock(db, manifest.manifest_hash, lockOwner);
  const batchSize = Math.max(1, Math.min(options.batch_size ?? 100, 500));
  let inserted = 0;
  let updated = 0;
  let alreadyApplied = 0;
  let batches = 0;
  try {
    const baseline = Object.fromEntries(await Promise.all(SIDE_EFFECT_COLLECTIONS.map(async (name) => [name, await db.collection(name).countDocuments()])));
    await db.collection(JOURNAL).insertOne({ manifest_hash: manifest.manifest_hash, kind: "apply_start", target_database: db.databaseName, fencing_token: lock.fencing_token, side_effect_baseline: baseline, created_at: new Date() });
    for (let offset = 0; offset < manifest.operations.length; offset += batchSize) {
      const batch = manifest.operations.slice(offset, offset + batchSize);
      const outcome = await withTransaction(db, async (session) => {
        await assertHistoricalOperationalFence(db, lock, session);
        const batchOutcome = { inserted: 0, updated: 0, alreadyApplied: 0 };
        for (const operation of batch) {
          const result = await applyOperation(db, manifest, operation, session);
          batchOutcome[result] += 1;
        }
        await db.collection(JOURNAL).insertOne({ manifest_hash: manifest.manifest_hash, kind: "batch_committed", batch_offset: offset, operation_ids: batch.map((entry) => entry.operation_id), fencing_token: lock.fencing_token, outcome: batchOutcome, created_at: new Date() }, { session });
        return batchOutcome;
      });
      inserted += outcome.inserted;
      updated += outcome.updated;
      alreadyApplied += outcome.alreadyApplied;
      batches += 1;
      await heartbeatHistoricalOperationalLock(db, lock);
    }
    await db.collection(JOURNAL).insertOne({ manifest_hash: manifest.manifest_hash, kind: "apply_complete", outcome: { inserted, updated, already_applied: alreadyApplied, batches }, created_at: new Date() });
    return { manifest_hash: manifest.manifest_hash, target_database: db.databaseName, dry_run: false, inserted, updated, already_applied: alreadyApplied, batches };
  } catch (error) {
    await db.collection(JOURNAL).insertOne({ manifest_hash: manifest.manifest_hash, kind: "apply_failed", error: error instanceof Error ? error.message : String(error), created_at: new Date() });
    throw error;
  } finally {
    await releaseHistoricalOperationalLock(db, lock);
  }
}

async function applyOperation(db: Db, manifest: HistoricalManifest, operation: HistoricalOperation, session: ClientSession): Promise<"inserted" | "updated" | "alreadyApplied"> {
  const registry = await db.collection(REGISTRY).findOne({ operation_id: operation.operation_id }, { session });
  if (registry?.state === "applied" || registry?.state === "verified") return "alreadyApplied";
  const targetId = new ObjectId(operation.target_id);
  const collection = db.collection(operation.collection);
  if (operation.action === "insert") {
    if (!operation.document) throw new Error(`Insert ${operation.operation_id} has no document`);
    const existing = await collection.findOne({ _id: targetId }, { session });
    const planned = { ...mongoDocument(operation.document), _id: targetId };
    if (existing) throw new Error(`Target ID collision without an applied registry record for ${operation.operation_id}`);
    await collection.insertOne(planned, { session });
  } else {
    if (!operation.set || !operation.before) throw new Error(`Update ${operation.operation_id} is missing set/before images`);
    const filter = { _id: targetId, ...mongoDocument(operation.precondition) };
    const result = await collection.updateOne(filter, { $set: mongoDocument(operation.set) }, { session });
    if (result.matchedCount !== 1) {
      const existing = await collection.findOne({ _id: targetId }, { session });
      if (!existing || !matchesPlanned(existing, operation.set)) throw new Error(`Compare-and-swap precondition failed for ${operation.operation_id}`);
    }
  }
  await db.collection(REGISTRY).updateOne(
    { operation_id: operation.operation_id },
    { $setOnInsert: { migration_key: operation.migration_key, manifest_hash: manifest.manifest_hash, entity_model: operation.model, source_provenance: operation.provenance, target_entity_id: targetId, state_revision: 0, created_at: new Date() }, $set: { state: "applied", applied_at: new Date() }, $inc: { state_revision: 1 } },
    { upsert: true, session },
  );
  return operation.action === "insert" ? "inserted" : "updated";
}

async function ensureOperationalIndexes(db: Db): Promise<void> {
  await db.collection(REGISTRY).createIndex({ operation_id: 1 }, { unique: true, name: "operation_id_unique" });
  await db.collection(REGISTRY).createIndex({ migration_key: 1 }, { unique: true, name: "migration_key_unique" });
  await db.collection(JOURNAL).createIndex({ manifest_hash: 1, created_at: 1 }, { name: "manifest_journal" });
}

async function withTransaction<T>(db: Db, callback: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = db.client.startSession();
  try {
    return await session.withTransaction(() => callback(session));
  } finally {
    await session.endSession();
  }
}

export { SIDE_EFFECT_COLLECTIONS };

export async function preflightHistoricalManifest(manifest: HistoricalManifest, db: Db): Promise<{ ok: true; target_database: string; resume_operations: number }> {
  assertArtifactHash(manifest);
  if (manifest.conflicts.some((entry) => entry.blocking && entry.status !== "decision_supplied")) throw new Error("Manifest has unresolved blocking conflicts");
  const hello = await db.command({ hello: 1 });
  const fingerprint = sha256({ setName: hello.setName ?? null, hosts: [...(hello.hosts ?? [])].sort() });
  if (fingerprint !== manifest.target_cluster_fingerprint) throw new Error("Target cluster fingerprint does not match the reviewed manifest");
  const resume = await db.collection(REGISTRY).countDocuments({ manifest_hash: manifest.manifest_hash });
  if (resume === 0) {
    for (const [collection, expected] of Object.entries(manifest.target_collection_checksums)) {
      const current = await db.collection(collection).find({}).sort({ _id: 1 }).toArray();
      const checksum = sha256(current.map(comparable));
      if (checksum !== expected) throw new Error(`Target preflight checksum changed for ${collection}`);
    }
  }
  for (const expected of manifest.expected_indexes.filter((entry) => entry.collection !== REGISTRY)) {
    const exists = await db.listCollections({ name: expected.collection }, { nameOnly: true }).hasNext();
    if (!exists) throw new Error(`Required collection ${expected.collection} is missing`);
    const indexes = await db.collection(expected.collection).indexes();
    const index = indexes.find((entry) => entry.name === expected.name);
    if (!index || Boolean(index.unique) !== expected.unique || JSON.stringify(index.key) !== JSON.stringify(expected.key)) throw new Error(`Required index ${expected.collection}.${expected.name} is missing or changed`);
  }
  return { ok: true, target_database: db.databaseName, resume_operations: resume };
}
