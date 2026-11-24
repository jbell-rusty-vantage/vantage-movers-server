import type { Db, Document, ObjectId } from "mongodb";
import { toObjectId } from "../../../utils/objectId";
import { CONTENT_TYPES, isCloudStorageError, openObjectStore, retirementPackObjectName, sha256Hex, type ObjectStore } from "../../cloudStorage";
import { bson, decodePack, encodePack, packHoldsExactly, type RawRow } from "../../salesIntelligence/retirement/pack";

/**
 * Validated retirement of Domain Command history (`entity_changes`, `domain_command_executions`; Owner decision 5,
 * 2026-11-23; Reference doc docs/knowledge/validated-retirement.md). The pieces both workers share: the runtime switch and
 * lease, the verified pack write, the catalog row and the exact-row delete.
 *
 * Both collections are permanent, so a held row simply stays in MongoDB: only proven rows are packed (a held row needs no
 * archive copy), and each worker sweeps its collection again a day after a full pass, when holds may have cleared.
 */
export const RETIREMENT_NAMESPACE = "domain-records-retirement" as const;
export const RETIREMENT_CONTROL_COLLECTION = "domain_record_retirement";
export const RETIREMENT_ARCHIVE_DAYS = 90;
/** Settle: longer than any transaction that could still commit an older row. */
export const RETIREMENT_SETTLE_MS = 5 * 60_000;
/** A finished pass rests this long before the next one starts. */
export const RETIREMENT_PASS_INTERVAL_MS = 86_400_000;
export const RETIREMENT_BATCH = 500;
export const RETIREMENT_BATCH_BYTES = 8 * 1024 * 1024;
const LEASE_MS = 3 * 60_000;
const DAY_MS = 86_400_000;

export type RetirementControl<C> = {
  _id: string; enabled_at?: Date; cursor?: C | null; pass_completed_at?: Date | null;
  lease_owner?: string | null; lease_until?: Date | null;
};
export type Verdict = { verdict: "retire" } | { verdict: "hold"; reason: string };
export type RetirementRun = {
  status: "disabled" | "lease_held" | "not_reviewable" | "resting" | "ran";
  batches: number; rows: number; retire: number; hold: number; deleted: number; held_reasons: Record<string, number>;
  packs: number; raw_bytes: number; packed_bytes: number; pass_completed: boolean; cursor: string | null;
  error?: string; error_at?: string;
};

export const emptyRun = (status: RetirementRun["status"]): RetirementRun => ({ status, batches: 0, rows: 0, retire: 0, hold: 0, deleted: 0,
  held_reasons: {}, packs: 0, raw_bytes: 0, packed_bytes: 0, pass_completed: false, cursor: null });

/** The catalog indexes every pack collection carries; `extra` adds the collection's own lookup index. */
export function catalogIndexes(tag: string, extra: { name: string; key: Document }[]) {
  return [
    { name: `${tag}_pack_name_unique`, key: { name: 1 }, unique: true },
    { name: `${tag}_pack_id_range`, key: { first_id: 1, last_id: 1 } },
    ...extra,
    { name: `${tag}_pack_expiry`, key: { expires_at: 1 }, expireAfterSeconds: 0 },
  ] as const;
}

export async function createCatalogIndexes(db: Db, collection: string, indexes: ReadonlyArray<{ name: string; key: Document; unique?: boolean; expireAfterSeconds?: number }>) {
  for (const i of indexes) await db.collection(collection).createIndex(i.key, { name: i.name, ...(i.unique ? { unique: true } : {}),
    ...(i.expireAfterSeconds !== undefined ? { expireAfterSeconds: i.expireAfterSeconds } : {}) });
}

/** Takes the worker's lease when the switch is on; otherwise reports why the run does nothing. */
export async function acquireLease<C>(db: Db, id: string, owner: string, now: Date) {
  const controls = db.collection<RetirementControl<C>>(RETIREMENT_CONTROL_COLLECTION);
  const control = await controls.findOneAndUpdate(
    { _id: id, enabled_at: { $type: "date" }, $or: [{ lease_until: null }, { lease_until: { $exists: false } }, { lease_until: { $lte: now } }] },
    { $set: { lease_owner: owner, lease_until: new Date(+now + LEASE_MS) } },
    { returnDocument: "after" },
  );
  if (control) return { control, status: null };
  const row = await controls.findOne({ _id: id }, { projection: { enabled_at: 1 } });
  return { control: null, status: row?.enabled_at instanceof Date ? "lease_held" as const : "disabled" as const };
}

/** Moves the cursor under the lease; `false` when the lease was lost (the next owner resumes from the stored cursor). */
export async function advance<C>(db: Db, id: string, owner: string, set: { cursor: C | null; pass_completed_at?: Date }, clock: () => number) {
  const moved = await db.collection<RetirementControl<C>>(RETIREMENT_CONTROL_COLLECTION).updateOne({ _id: id, lease_owner: owner },
    { $set: { ...set, lease_until: new Date(clock() + LEASE_MS) } as never });
  return moved.matchedCount === 1;
}

export async function releaseLease(db: Db, id: string, owner: string, now: Date, run: RetirementRun) {
  await db.collection<RetirementControl<unknown>>(RETIREMENT_CONTROL_COLLECTION).updateOne({ _id: id, lease_owner: owner },
    { $set: { lease_owner: null, lease_until: null, last_run: { at: now, ...run } } as never });
}

/** Every run re-checks, read-only, the single 90-day bucket rule the catalog expiry assumes. */
export async function openRetirementStore(db: Db, store?: ObjectStore) {
  if (store) return { store, recoveryDays: RETIREMENT_ARCHIVE_DAYS };
  const opened = await openObjectStore(db, RETIREMENT_NAMESPACE, { capability: "release" });
  return { store: opened.store, recoveryDays: opened.config.recoveryDays };
}

/**
 * Packs the proven rows' exact BSON (90-day clock started), reads them back byte for byte, then writes one catalog row.
 * Throws before anything in MongoDB changes when the write or the read-back fails.
 */
export async function packAndCatalog(db: Db, input: {
  store: ObjectStore; recoveryDays: number; catalog: string; rows: readonly RawRow[]; day: Date; now: Date; fields: Document;
}) {
  const bytes = encodePack(input.rows);
  const sha = sha256Hex(bytes);
  const name = retirementPackObjectName(input.store.prefix, db.databaseName, input.day.toISOString().slice(0, 10), sha);
  const stored = await input.store.put({ name, bytes, contentType: CONTENT_TYPES.pack, customTime: input.now, metadata: { rows: String(input.rows.length) } });
  if (stored.sha256 !== sha || !packHoldsExactly(stored.persisted, input.rows)) throw new Error("retirement_pack_verification_failed");
  const ids = input.rows.map((r) => r.id).sort();
  // A retry can reuse an object written earlier: its recovery clock started then, so the catalog row expires from it.
  let clock = input.now;
  if (!stored.created) {
    const started = (await input.store.stat(name, stored.generation))?.recoveryClockStartedAt;
    if (!started || Number.isNaN(Date.parse(started))) throw new Error("retirement_pack_clock_missing");
    clock = new Date(started);
  }
  await db.collection(input.catalog).updateOne({ name }, { $setOnInsert: {
    name, generation: stored.generation, sha256: stored.sha256, size: stored.size, rows: input.rows.length,
    first_id: toObjectId(ids[0]!), last_id: toObjectId(ids.at(-1)!), ...input.fields,
    // One day before GCS can delete the object (the bucket counts whole days since its custom time).
    created_at: input.now, expires_at: new Date(+clock + (input.recoveryDays - 1) * DAY_MS),
  } }, { upsert: true });
  return { name, packed_bytes: bytes.length };
}

/** Deletes the proven rows whose stored bytes are still exactly the archived ones, in one snapshot transaction. */
export async function deleteExact(db: Db, collection: string, proven: readonly RawRow[]) {
  if (!proven.length) return 0;
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const fresh = await db.collection(collection).find({ _id: { $in: proven.map((r) => toObjectId(r.id)) } }, { raw: true, session }).toArray() as unknown as Buffer[];
      const archived = new Map(proven.map((r) => [r.id, r.raw]));
      const same = fresh.map((raw) => Buffer.from(raw)).filter((raw) => archived.get(String(bson.deserialize(raw)._id))?.equals(raw))
        .map((raw) => bson.deserialize(raw)._id as ObjectId);
      if (!same.length) return 0;
      return (await db.collection(collection).deleteMany({ _id: { $in: same } }, { session })).deletedCount;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
}

/**
 * The rows of one catalogued pack, verified; `null` only when GCS deleted it on schedule, after the catalog row's
 * `expires_at` (the TTL sweep lags). A pack missing before then is an error: fail closed, never a shorter answer.
 */
export async function readCataloguedPack(store: ObjectStore, pack: Document, now = new Date()): Promise<RawRow[] | null> {
  try {
    return decodePack(await store.readVerified({ name: pack.name, generation: pack.generation, sha256: pack.sha256, size: pack.size }));
  } catch (error) {
    if (isCloudStorageError(error, "not_found") && pack.expires_at instanceof Date && +pack.expires_at <= +now) return null;
    throw error;
  }
}

/** Restores one archived row by original `_id`, or `null` when no live pack holds it. */
export async function lookupArchivedRow(db: Db, catalog: string, id: string, store?: ObjectStore) {
  const oid = toObjectId(id);
  const reader = store ?? (await openObjectStore(db, RETIREMENT_NAMESPACE)).store;
  for await (const pack of db.collection(catalog).find({ first_id: { $lte: oid }, last_id: { $gte: oid } }, { sort: { created_at: 1 } })) {
    const hit = (await readCataloguedPack(reader, pack))?.find((row) => row.id === id);
    if (hit) return { pack: { name: pack.name as string, generation: pack.generation as string }, doc: bson.deserialize(hit.raw) };
  }
  return null;
}

export function tally(run: RetirementRun, verdicts: readonly Verdict[]) {
  for (const v of verdicts) {
    if (v.verdict === "retire") run.retire++;
    else { run.hold++; run.held_reasons[v.reason] = (run.held_reasons[v.reason] ?? 0) + 1; }
  }
  run.rows += verdicts.length;
}

export function recordError(run: RetirementRun, error: unknown) {
  run.error = error instanceof Error ? error.message.slice(0, 200) : "unknown";
  if (error instanceof Error && error.stack) run.error_at = error.stack.split(/\r?\n/).slice(1, 3).map((l) => l.trim()).join(" | ").slice(0, 300);
}

/** The next raw rows of a scan, up to the count and byte limits. */
export async function readRawBatch(cursor: AsyncIterable<unknown> & { close(): Promise<void> }) {
  const rows: Array<{ raw: Buffer; doc: Document }> = [];
  let bytes = 0;
  for await (const value of cursor) {
    const raw = Buffer.from(value as Buffer);
    bytes += raw.length;
    if (bytes > RETIREMENT_BATCH_BYTES && rows.length) break;
    rows.push({ raw, doc: bson.deserialize(raw) as Document });
  }
  await cursor.close();
  return rows;
}
