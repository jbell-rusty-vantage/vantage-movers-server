import { randomUUID } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import { ObjectId } from "mongodb";
import { assertArtifactHash } from "./stableJson";
import { mongoDocument, matchesPlanned } from "./mongoValues";
import { assertRollbackAuthorized } from "./targetGuard";
import { requireHistoricalMigrationContext } from "./migrationContext";
import { acquireHistoricalOperationalLock, assertHistoricalOperationalFence, heartbeatHistoricalOperationalLock, releaseHistoricalOperationalLock } from "./operationalLock";
import type { HistoricalManifest, RollbackResult } from "./types";

export async function rollbackHistoricalManifest(
  manifest: HistoricalManifest,
  db: Db,
  authorization: { apply: boolean; database_confirmation?: string; manifest_hash_confirmation?: string; human_confirmation?: string },
  options: { batch_size?: number; lock_owner?: string } = {},
): Promise<RollbackResult> {
  assertArtifactHash(manifest);
  assertRollbackAuthorized(db.databaseName, manifest.manifest_hash, authorization.apply, authorization.database_confirmation, authorization.manifest_hash_confirmation, authorization.human_confirmation);
  requireHistoricalMigrationContext();
  let deleted = 0;
  let restored = 0;
  let alreadyRolledBack = 0;
  const conflicts: string[] = [];
  const lockOwner = options.lock_owner ?? `${process.pid}:${randomUUID()}:rollback`;
  const lock = await acquireHistoricalOperationalLock(db, manifest.manifest_hash, lockOwner);
  const batchSize = Math.max(1, Math.min(options.batch_size ?? 100, 500));
  try {
    const reversed = [...manifest.operations].reverse();
    await db.collection("historical_import_apply_journal").insertOne({ manifest_hash: manifest.manifest_hash, kind: "rollback_start", target_database: db.databaseName, fencing_token: lock.fencing_token, created_at: new Date() });
    for (let offset = 0; offset < reversed.length; offset += batchSize) {
      const session = db.client.startSession();
      const batch = reversed.slice(offset, offset + batchSize);
      try {
        const outcome = await session.withTransaction(async () => {
          await assertHistoricalOperationalFence(db, lock, session);
          const batchOutcome = { deleted: 0, restored: 0, already_rolled_back: 0, conflicts: [] as string[] };
          for (const operation of batch) {
            const registry = await db.collection("historical_import_registry").findOne({ operation_id: operation.operation_id }, { session });
            if (!registry || registry.state === "rolled_back") {
              batchOutcome.already_rolled_back += 1;
              continue;
            }
            const collection = db.collection(operation.collection);
            const id = new ObjectId(operation.target_id);
            const current = await collection.findOne({ _id: id }, { session });
            const applied = operation.action === "insert" ? operation.document : operation.set;
            if (!current || !applied || !matchesPlanned(current, applied)) {
              batchOutcome.conflicts.push(operation.operation_id);
              continue;
            }
            if (operation.action === "insert") {
              const externalReference = await hasNonMigrationReference(db, operation.target_id, operation.operation_id, session);
              if (externalReference) {
                if (!["agents", "merchants", "lead_source_companies", "lead_source_granularities"].includes(operation.collection)) {
                  batchOutcome.conflicts.push(operation.operation_id);
                  continue;
                }
                await collection.updateOne({ _id: id }, { $set: { active: false, deactivation_reason: `historical rollback ${manifest.manifest_hash}` } }, { session });
                batchOutcome.restored += 1;
              } else {
                await collection.deleteOne({ _id: id }, { session });
                batchOutcome.deleted += 1;
              }
            } else {
              const { set, unset } = buildRollbackUpdate(operation.before ?? {}, operation.precondition);
              const update = {
                ...(Object.keys(set).length ? { $set: set } : {}),
                ...(Object.keys(unset).length ? { $unset: unset } : {}),
              };
              await collection.updateOne({ _id: id }, update, { session });
              batchOutcome.restored += 1;
            }
            await db.collection("historical_import_registry").updateOne({ operation_id: operation.operation_id }, { $set: { state: "rolled_back", rolled_back_at: new Date() }, $inc: { state_revision: 1 } }, { session });
          }
          await db.collection("historical_import_apply_journal").insertOne({ manifest_hash: manifest.manifest_hash, kind: "rollback_batch_committed", batch_offset: offset, operation_ids: batch.map((entry) => entry.operation_id), fencing_token: lock.fencing_token, outcome: batchOutcome, created_at: new Date() }, { session });
          return batchOutcome;
        });
        deleted += outcome.deleted;
        restored += outcome.restored;
        alreadyRolledBack += outcome.already_rolled_back;
        conflicts.push(...outcome.conflicts);
      } finally {
        await session.endSession();
      }
      await heartbeatHistoricalOperationalLock(db, lock);
    }
    await db.collection("historical_import_apply_journal").insertOne({ manifest_hash: manifest.manifest_hash, kind: "rollback_complete", outcome: { deleted, restored, already_rolled_back: alreadyRolledBack, conflicts }, created_at: new Date() });
  } finally {
    await releaseHistoricalOperationalLock(db, lock);
  }
  return { manifest_hash: manifest.manifest_hash, target_database: db.databaseName, dry_run: false, deleted, restored, already_rolled_back: alreadyRolledBack, conflicts };
}

export function buildRollbackUpdate(before: Record<string, unknown>, precondition: Record<string, unknown>): { set: Record<string, unknown>; unset: Record<string, ""> } {
  const set = mongoDocument(before);
  const unset: Record<string, ""> = {};
  for (const [field, condition] of Object.entries(precondition)) {
    if (condition && typeof condition === "object" && (condition as Record<string, unknown>).$exists === false) {
      delete set[field];
      unset[field] = "";
    }
  }
  return { set, unset };
}

async function hasNonMigrationReference(db: Db, targetId: string, operationId: string, session: ClientSession): Promise<boolean> {
  const id = new ObjectId(targetId);
  const references: Array<[string, Record<string, unknown>]> = [
    ["form_leads", { $or: [{ receiver_agent: id }, { lead_source_company: id }, { source_granularity_id: id }] }],
    ["call_leads", { $or: [{ receiver_agent: id }, { lead_source_company: id }, { source_granularity_id: id }] }],
    ["booked_leads", { $or: [{ customer: id }, { lead_ref: id }, { "agent_allocations.agent": id }] }],
    ["cancelled_leads", { $or: [{ booked_lead: id }, { customer: id }, { lead_ref: id }] }],
  ];
  for (const [collection, filter] of references) {
    const documents = await db.collection(collection).find(filter, { projection: { _id: 1 }, session }).toArray();
    for (const document of documents) {
      const owned = await db.collection("historical_import_registry").findOne({ target_entity_id: document._id, operation_id: { $ne: operationId }, state: { $in: ["applied", "verified"] } }, { session });
      if (!owned) return true;
    }
  }
  return false;
}
