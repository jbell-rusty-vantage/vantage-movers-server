import { randomUUID } from "node:crypto";
import type { Db, Document, ObjectId } from "mongodb";
import { toObjectId } from "../../../utils/objectId";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { logger } from "../../../logger";
import { CONTENT_TYPES, isCloudStorageError, openObjectStore, retirementPackObjectName, sha256Hex, type ObjectStore } from "../../cloudStorage";
import { finishedExecutionFields } from "../routineJobExpiry";
import { RETIREMENT_CONTROL_COLLECTION, RETIREMENT_CONTROL_ID } from "./control";
import { loadEffects, verdictOf } from "./evidence";
import { bson, decodePack, encodePack, packHoldsExactly, type RawRow } from "./pack";

/**
 * Validated retirement of completed `sales_intelligence_jobs` (Reference doc: docs/knowledge/validated-retirement.md).
 *
 * Each batch, in completion order and only once a completion has settled:
 * 1. prove every job's lifecycle effect from its business record (`evidence.ts`);
 * 2. pack the exact stored BSON of the whole batch, write it create-only to GCS with its 90-day clock started, and
 *    decode the bytes read back from the pinned generation: every row must be present byte for byte;
 * 3. record one catalog row per pack (generation, SHA-256, id and completion ranges, verdict counts);
 * 4. only then compact the proven routine jobs to receipts that leave at the end of their replay window. Held and
 *    ordinary rows are not written; they keep the 14-day window, already archived.
 * A failure anywhere before step 4 changes nothing in MongoDB, and the cursor does not move.
 */
export const ARCHIVE_PACKS_COLLECTION = "sales_intelligence_job_archive_packs";
export const ARCHIVE_PACK_INDEXES = [
  { name: "si_archive_pack_name_unique", key: { name: 1 }, unique: true },
  { name: "si_archive_pack_completed", key: { last_completed_at: 1 } },
  { name: "si_archive_pack_expiry", key: { expires_at: 1 }, expireAfterSeconds: 0 },
] as const;
export const RETIREMENT_ARCHIVE_DAYS = 90;
/** Longer than any completion transaction can stay open (Atlas transaction lifetime 60 s), so no completion lands behind the cursor. */
export const RETIREMENT_SETTLE_MS = 5 * 60_000;
export const RETIREMENT_BATCH = 500;
const LEASE_MS = 3 * 60_000;
const DAY_MS = 86_400_000;

/** `id` is set only while walking a group of rows that share `completed_at` (more than one batch completed in the same millisecond). */
type Cursor = { completed_at: Date; id?: ObjectId | null };
type Control = { _id: string; enabled_at?: Date; cursor?: Cursor | null; lease_owner?: string | null; lease_until?: Date | null };
export type RetirementRun = {
  status: "disabled" | "lease_held" | "ran";
  batches: number; rows: number; retire: number; hold: number; keep: number;
  held_reasons: Record<string, number>; packs: number; raw_bytes: number; packed_bytes: number; compacted: number; purge_only: number;
  cursor: string | null; lag_seconds: number | null; error?: string; error_at?: string;
};

const empty = (status: RetirementRun["status"]): RetirementRun => ({ status, batches: 0, rows: 0, retire: 0, hold: 0, keep: 0,
  held_reasons: {}, packs: 0, raw_bytes: 0, packed_bytes: 0, compacted: 0, purge_only: 0, cursor: null, lag_seconds: null });

/** Raw bytes per pack; well under the 32 MiB decode cap. */
export const RETIREMENT_BATCH_BYTES = 8 * 1024 * 1024;
type Row = { raw: Buffer; doc: Document };
const jobsOf = (db: Db) => db.collection("sales_intelligence_jobs");
const toRows = (raws: unknown[]) => (raws as Buffer[]).map((raw) => ({ raw: Buffer.from(raw), doc: bson.deserialize(raw) as Document }));

/** Rows up to the count and byte limits; returns the cut index (rows before it fit). */
function cutAt(rows: readonly Row[], size: number, bytes: number) {
  let total = 0, i = 0;
  for (; i < rows.length && i < size; i++) {
    total += rows[i]!.raw.length;
    if (total > bytes && i > 0) break;
  }
  return i;
}

/**
 * The next batch after `cursor`, in `completed_at` order. A batch never ends inside a group of rows that share one
 * completion instant: such a group is walked separately by `_id` (`cursor.id`), so no row is skipped or split.
 */
async function nextBatch(db: Db, cursor: Cursor | null, until: Date, size: number, bytes: number): Promise<{ rows: Row[]; next: Cursor | null }> {
  const base = { ...csiDataset(), status: "completed", record_kind: { $exists: false } };
  if (cursor?.id) {
    const group = toRows(await jobsOf(db).find({ ...base, completed_at: cursor.completed_at, _id: { $gt: cursor.id } },
      { raw: true, sort: { _id: 1 }, limit: size, hint: "csi_job_completed_ttl" }).toArray());
    const rows = group.slice(0, Math.max(1, cutAt(group, size, bytes)));
    if (!rows.length) return { rows: [], next: { completed_at: cursor.completed_at, id: null } };
    return { rows, next: { completed_at: cursor.completed_at, id: rows.at(-1)!.doc._id as ObjectId } };
  }
  const rows = toRows(await jobsOf(db).find({ ...base, completed_at: { ...(cursor ? { $gt: cursor.completed_at } : {}), $lte: until } },
    { raw: true, sort: { completed_at: 1 }, limit: size + 1, hint: "csi_job_completed_ttl" }).toArray());
  const cut = cutAt(rows, size, bytes);
  if (cut >= rows.length) return { rows, next: rows.length ? { completed_at: rows.at(-1)!.doc.completed_at as Date } : null };
  const boundary = +rows[cut - 1]!.doc.completed_at;
  const kept = +rows[cut]!.doc.completed_at === boundary ? rows.slice(0, cut).filter((r) => +r.doc.completed_at !== boundary) : rows.slice(0, cut);
  if (kept.length) return { rows: kept, next: { completed_at: kept.at(-1)!.doc.completed_at as Date } };
  // The whole batch shares one instant: walk that group by `_id`, starting just before its first row.
  return nextBatch(db, { completed_at: new Date(boundary), id: toObjectId("000000000000000000000000") as unknown as ObjectId }, until, size, bytes);
}

export async function retireCompletedJobs(db: Db, options: {
  now?: Date; store?: ObjectStore; maxBatches?: number; budgetMs?: number; batchSize?: number; owner?: string; clock?: () => number;
} = {}): Promise<RetirementRun> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const started = clock();
  const owner = options.owner ?? `si-retirement:${randomUUID()}`;
  const controls = db.collection<Control>(RETIREMENT_CONTROL_COLLECTION);
  const control = await controls.findOneAndUpdate(
    { _id: RETIREMENT_CONTROL_ID, enabled_at: { $type: "date" }, $or: [{ lease_until: null }, { lease_until: { $exists: false } }, { lease_until: { $lte: now } }] },
    { $set: { lease_owner: owner, lease_until: new Date(+now + LEASE_MS) } },
    { returnDocument: "after" },
  );
  if (!control) {
    const row = await controls.findOne({ _id: RETIREMENT_CONTROL_ID }, { projection: { enabled_at: 1 } });
    return empty(row?.enabled_at instanceof Date ? "lease_held" : "disabled");
  }
  const run = empty("ran");
  let cursor: Cursor | null = control.cursor ?? null;
  try {
    // Every run re-checks, read-only, that exactly one bucket rule deletes this prefix after the configured recovery days;
    // a changed rule or override stops the run before anything is compacted (the catalog expiry assumes that rule).
    const opened = options.store ? null : await openObjectStore(db, "sales-intelligence-retirement", { capability: "release" });
    const store = options.store ?? opened!.store;
    const recoveryDays = opened?.config.recoveryDays ?? RETIREMENT_ARCHIVE_DAYS;
    const packs = db.collection(ARCHIVE_PACKS_COLLECTION);
    const until = new Date(+now - RETIREMENT_SETTLE_MS);
    while (run.batches < (options.maxBatches ?? 4) && clock() - started < (options.budgetMs ?? 40_000)) {
      const { rows, next } = await nextBatch(db, cursor, until, options.batchSize ?? RETIREMENT_BATCH, RETIREMENT_BATCH_BYTES);
      if (!rows.length) {
        if (next && cursor?.id) { cursor = next; continue; } // a finished tie group: resume after that instant
        break;
      }
      const docs = rows.map((r) => r.doc);
      const effects = await loadEffects(db, docs);
      const verdicts = docs.map((doc) => verdictOf(doc, effects));
      const raw: RawRow[] = rows.map((r) => ({ raw: r.raw, id: String(r.doc._id) }));
      const bytes = encodePack(raw);
      const sha = sha256Hex(bytes);
      const first = docs[0]!.completed_at as Date, last = docs.at(-1)!.completed_at as Date;
      const name = retirementPackObjectName(store.prefix, db.databaseName, first.toISOString().slice(0, 10), sha);
      const stored = await store.put({ name, bytes, contentType: CONTENT_TYPES.pack, customTime: now, metadata: { rows: String(rows.length) } });
      if (stored.sha256 !== sha || !packHoldsExactly(stored.persisted, raw)) throw new Error("retirement_pack_verification_failed");
      const ids = raw.map((r) => r.id).sort();
      const held: Record<string, number> = {};
      for (const v of verdicts) if (v.verdict === "hold") held[v.reason] = (held[v.reason] ?? 0) + 1;
      const counts = { retire: verdicts.filter((v) => v.verdict === "retire").length, hold: verdicts.filter((v) => v.verdict === "hold").length };
      await packs.updateOne({ name }, { $setOnInsert: {
        name, generation: stored.generation, sha256: stored.sha256, size: stored.size, rows: rows.length,
        first_id: toObjectId(ids[0]!), last_id: toObjectId(ids.at(-1)!), first_completed_at: first, last_completed_at: last,
        retire: counts.retire, hold: counts.hold, keep: rows.length - counts.retire - counts.hold, held_reasons: held,
        // One day before GCS can delete the object (the bucket counts whole days since its custom time).
        created_at: now, expires_at: new Date(+now + (recoveryDays - 1) * DAY_MS),
      } }, { upsert: true });
      // The compaction carries the catalog row's own instant, also when a retry reuses a row written by an earlier run:
      // receipt retirement (`numberActivity/receiptRetirement.ts`) proves a compacted capture job by that match.
      const catalogued = (await packs.findOne({ name }, { projection: { created_at: 1 } }))?.created_at;
      if (!(catalogued instanceof Date)) throw new Error("retirement_catalog_missing");
      const compactions = docs.flatMap((doc, i) => {
        const v = verdicts[i]!;
        if (v.verdict !== "retire") return [];
        // Fenced on the exact row that was packed: any later change to it leaves the row as it is.
        const filter = { _id: doc._id, ...csiDataset(), status: "completed", record_kind: { $exists: false }, routine_purge_at: { $exists: false },
          completed_at: doc.completed_at, payload_hash: doc.payload_hash, lease_epoch: doc.lease_epoch, updatedAt: doc.updatedAt };
        // A job that succeeded after a retry keeps its full row (the failure reason is evidence) and only gets its purge instant.
        const update = v.compact
          ? { $set: { record_kind: "completion_receipt", routine_purge_at: v.purge_at, updatedAt: catalogued }, $unset: finishedExecutionFields(String(doc.stage)) }
          : { $set: { routine_purge_at: v.purge_at } };
        return [{ compact: v.compact, op: { updateOne: { filter, update } } }];
      });
      for (const compact of [true, false]) {
        const ops = compactions.filter((c) => c.compact === compact).map((c) => c.op);
        if (!ops.length) continue;
        const modified = (await jobsOf(db).bulkWrite(ops, { ordered: false })).modifiedCount;
        if (compact) run.compacted += modified; else run.purge_only += modified;
      }
      cursor = next;
      const moved = await controls.updateOne({ _id: RETIREMENT_CONTROL_ID, lease_owner: owner },
        { $set: { cursor, lease_until: new Date(clock() + LEASE_MS) } });
      run.batches++; run.rows += rows.length; run.retire += counts.retire; run.hold += counts.hold; run.keep += rows.length - counts.retire - counts.hold;
      for (const [k, n] of Object.entries(held)) run.held_reasons[k] = (run.held_reasons[k] ?? 0) + n;
      run.packs++; run.raw_bytes += raw.reduce((s, r) => s + r.raw.length, 0); run.packed_bytes += bytes.length;
      if (moved.matchedCount !== 1) break; // lease lost: the next owner resumes from the stored cursor
    }
  } catch (error) {
    run.error = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    // Where it failed: the first two stack frames, so a production-only failure is diagnosable from `status`.
    if (error instanceof Error && error.stack) run.error_at = error.stack.split(/\r?\n/).slice(1, 3).map((l) => l.trim()).join(" | ").slice(0, 300);
    throw error;
  } finally {
    run.cursor = cursor?.completed_at.toISOString() ?? null;
    run.lag_seconds = cursor ? Math.round((+now - +cursor.completed_at) / 1000) : null;
    await controls.updateOne({ _id: RETIREMENT_CONTROL_ID, lease_owner: owner },
      { $set: { lease_owner: null, lease_until: null, last_run: { at: now, ...run } } });
    logger.info({ msg: "sales_intelligence.retirement.run", ...run });
  }
  return run;
}

/** Restores an archived job by original `_id` from its verified pack, or `null` when no live pack holds it. */
export async function lookupArchivedJob(db: Db, jobId: string, store?: ObjectStore) {
  const id = toObjectId(jobId);
  const created = new Date(parseInt(jobId.slice(0, 8), 16) * 1000);
  const reader = store ?? (await openObjectStore(db, "sales-intelligence-retirement")).store;
  const candidates = db.collection(ARCHIVE_PACKS_COLLECTION).find(
    { last_completed_at: { $gte: created }, first_id: { $lte: id }, last_id: { $gte: id } },
    { sort: { last_completed_at: 1 } },
  );
  for await (const pack of candidates) {
    let bytes: Buffer;
    try {
      bytes = await reader.readVerified({ name: pack.name, generation: pack.generation, sha256: pack.sha256, size: pack.size });
    } catch (error) {
      if (isCloudStorageError(error, "not_found")) continue; // expired from GCS ahead of its catalog row
      throw error;
    }
    const hit = decodePack(bytes).find((row) => row.id === jobId);
    if (hit) return { pack: { name: pack.name as string, generation: pack.generation as string }, doc: bson.deserialize(hit.raw) };
  }
  return null;
}
