import type { Db, Document, FindCursor } from "mongodb";
import { openObjectStore, type ObjectStore } from "../../cloudStorage";
import { bson } from "../../salesIntelligence/retirement/pack";
import { readCataloguedPack, RETIREMENT_NAMESPACE } from "./shared";

/** Catalog of retired Entity Changes, one row per verified pack (TTL 89 days, one day before GCS deletes the pack). */
export const ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION = "entity_change_archive_packs";

type EntityRef = { model: string; id: string };

/** Raised before any GCS read when the archived rows of the requested entities would exceed the caller's bound. */
export class ArchivedEntityChangesLimitError extends Error {
  readonly code = "EVIDENCE_LIMIT_REACHED";
  constructor() { super("EVIDENCE_LIMIT_REACHED"); }
}
/** Bound for callers that set none (the Granot timelines): far above any Lead's incident stock (max 318 rows). */
export const ARCHIVED_ENTITY_CHANGES_MAX_ROWS = 2_000;
const READ_CONCURRENCY = 3;
const READ_DEADLINE_MS = 20_000;

/**
 * The timelines' GCS fallback by entity (Granot lead and job timelines, Job Number Timeline): every retired Entity Change
 * of these entities still inside its 90-day archive, decoded from its verified pack. One indexed catalog query, and no
 * GCS read at all for an entity that never had a row retired.
 * - Bounded: the catalog's per-entity counts (`entity_rows`) are summed first, and more than `maxRows` raises `limitError`
 *   (default `ArchivedEntityChangesLimitError`) before any GCS read. Packs are read three at a time under a 20 s deadline.
 * - Fail closed: an unreadable pack, or one missing before its catalog row expires, fails the read (never a silently
 *   shorter timeline). `read` lets a bounded caller run the catalog query under its own limit and timeout.
 */
export async function readArchivedEntityChanges(db: Db, refs: readonly EntityRef[], options: {
  store?: ObjectStore; read?: (cursor: FindCursor<Document>) => Promise<Document[]>;
  maxRows?: number; limitError?: () => Error; deadlineMs?: number; now?: Date;
} = {}): Promise<Document[]> {
  const byModel = new Map<string, Set<string>>();
  for (const ref of refs) (byModel.get(ref.model) ?? byModel.set(ref.model, new Set()).get(ref.model)!).add(String(ref.id));
  if (!byModel.size) return [];
  const cursor = db.collection(ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION).find(
    { $or: [...byModel].map(([model, ids]) => ({ entity_model: model, entity_ids: { $in: [...ids] } })) },
    { projection: { name: 1, generation: 1, sha256: 1, size: 1, rows: 1, entity_model: 1, entity_rows: 1, expires_at: 1 } },
  );
  const packs = options.read ? await options.read(cursor) : await cursor.toArray();
  if (!packs.length) return [];
  const projected = packs.reduce((sum, pack) => {
    const ids = byModel.get(pack.entity_model) ?? new Set<string>();
    const counts = pack.entity_rows as Record<string, number> | undefined;
    return sum + (counts ? [...ids].reduce((n, id) => n + (counts[id] ?? 0), 0) : Number(pack.rows ?? 0));
  }, 0);
  if (projected > (options.maxRows ?? ARCHIVED_ENTITY_CHANGES_MAX_ROWS)) throw (options.limitError ?? (() => new ArchivedEntityChangesLimitError()))();
  const reader = options.store ?? (await openObjectStore(db, RETIREMENT_NAMESPACE)).store;
  const now = options.now ?? new Date();
  const found = new Map<string, Document>();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("archived_entity_changes_deadline")), options.deadlineMs ?? READ_DEADLINE_MS);
    timer.unref?.();
  });
  const queue = [...packs];
  const worker = async () => {
    for (let pack = queue.shift(); pack; pack = queue.shift()) {
      for (const row of (await readCataloguedPack(reader, pack, now)) ?? []) {
        const doc = bson.deserialize(row.raw) as Document;
        if (byModel.get(doc.entity?.model)?.has(String(doc.entity?.id))) found.set(row.id, doc);
      }
    }
  };
  try {
    await Promise.race([Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, packs.length) }, worker)), deadline]);
  } finally {
    clearTimeout(timer);
  }
  return [...found.values()];
}

/** Hot rows plus archived rows of the same entities, each `_id` once (a row is never both, but a retry may race). */
export function withArchived<T extends object>(hot: readonly T[], archived: readonly Document[]): T[] {
  const seen = new Set(hot.map((row) => String((row as { _id?: unknown })._id)));
  return [...hot, ...(archived.filter((row) => !seen.has(String(row._id))) as unknown as T[])];
}
