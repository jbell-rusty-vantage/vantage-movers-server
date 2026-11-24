import type { Db, Document, FindCursor } from "mongodb";
import { openObjectStore, type ObjectStore } from "../../cloudStorage";
import { bson } from "../../salesIntelligence/retirement/pack";
import { readCataloguedPack, RETIREMENT_NAMESPACE } from "./shared";

/** Catalog of retired Entity Changes, one row per verified pack (TTL 89 days, one day before GCS deletes the pack). */
export const ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION = "entity_change_archive_packs";

type EntityRef = { model: string; id: string };

/**
 * The timelines' GCS fallback by entity (Granot lead and job timelines, Job Number Timeline): every retired Entity Change
 * of these entities still inside its 90-day archive, decoded from its verified pack. One indexed catalog query, and no
 * GCS read at all for an entity that never had a row retired. A pack that cannot be read fails the read (never a silently
 * shorter timeline); a pack GCS already expired is skipped, like its catalog row a day later. `read` lets a bounded caller
 * (the Job Number Timeline's row limit and timeout) run the catalog query.
 */
export async function readArchivedEntityChanges(db: Db, refs: readonly EntityRef[], options: {
  store?: ObjectStore; read?: (cursor: FindCursor<Document>) => Promise<Document[]>;
} = {}): Promise<Document[]> {
  const byModel = new Map<string, Set<string>>();
  for (const ref of refs) (byModel.get(ref.model) ?? byModel.set(ref.model, new Set()).get(ref.model)!).add(String(ref.id));
  if (!byModel.size) return [];
  const cursor = db.collection(ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION).find(
    { $or: [...byModel].map(([model, ids]) => ({ entity_model: model, entity_ids: { $in: [...ids] } })) },
    { projection: { name: 1, generation: 1, sha256: 1, size: 1 } },
  );
  const packs = options.read ? await options.read(cursor) : await cursor.toArray();
  if (!packs.length) return [];
  const reader = options.store ?? (await openObjectStore(db, RETIREMENT_NAMESPACE)).store;
  const found = new Map<string, Document>();
  for (const pack of packs) {
    for (const row of (await readCataloguedPack(reader, pack)) ?? []) {
      const doc = bson.deserialize(row.raw) as Document;
      if (byModel.get(doc.entity?.model)?.has(String(doc.entity?.id))) found.set(row.id, doc);
    }
  }
  return [...found.values()];
}

/** Hot rows plus archived rows of the same entities, each `_id` once (a row is never both, but a retry may race). */
export function withArchived<T extends object>(hot: readonly T[], archived: readonly Document[]): T[] {
  const seen = new Set(hot.map((row) => String((row as { _id?: unknown })._id)));
  return [...hot, ...(archived.filter((row) => !seen.has(String(row._id))) as unknown as T[])];
}
