import { randomUUID } from "node:crypto";
import { BSON, ObjectId, type Db, type Document } from "mongodb";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { logger } from "../../../logger";
import { CONTENT_TYPES, openObjectStore, salesIntelligenceRetirementObjectName, sha256Hex, type ObjectStore } from "../../cloudStorage";
import { finishedExecutionFields } from "../routineJobExpiry";
import { RETIREMENT_CONTROL_COLLECTION, RETIREMENT_CONTROL_ID } from "./control";
import { loadEffects, verdictOf } from "./evidence";
import { decodePack, encodePack, packHoldsExactly, type RawRow } from "./pack";

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

type Control = { _id: string; enabled_at?: Date; cursor?: { completed_at: Date } | null; lease_owner?: string | null; lease_until?: Date | null };
export type RetirementRun = {
  status: "disabled" | "lease_held" | "ran";
  batches: number; rows: number; retire: number; hold: number; keep: number;
  held_reasons: Record<string, number>; packs: number; raw_bytes: number; packed_bytes: number; compacted: number;
  cursor: string | null; lag_seconds: number | null;
};

const empty = (status: RetirementRun["status"]): RetirementRun => ({ status, batches: 0, rows: 0, retire: 0, hold: 0, keep: 0,
  held_reasons: {}, packs: 0, raw_bytes: 0, packed_bytes: 0, compacted: 0, cursor: null, lag_seconds: null });

/** The next batch after `after`, in `completed_at` order, without splitting rows that share one completion instant. */
async function nextBatch(db: Db, after: Date | null, until: Date, size: number) {
  const raws = await db.collection("sales_intelligence_jobs").find(
    { ...csiDataset(), status: "completed", record_kind: { $exists: false },
      completed_at: { ...(after ? { $gt: after } : {}), $lte: until } },
    { raw: true, sort: { completed_at: 1 }, limit: size + 1, hint: "csi_job_completed_ttl" },
  ).toArray() as unknown as Buffer[];
  const rows = raws.map((raw) => ({ raw: Buffer.from(raw), doc: BSON.deserialize(raw) as Document }));
  if (rows.length <= size) return rows;
  const boundary = +rows[size - 1]!.doc.completed_at;
  const kept = rows.slice(0, size).filter((r) => +r.doc.completed_at !== boundary || +rows[size]!.doc.completed_at !== boundary);
  if (!kept.length) throw new Error("retirement_tie_overflow");
  return kept;
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
  let cursor = control.cursor?.completed_at ?? null;
  try {
    const store = options.store ?? (await openObjectStore(db, "sales-intelligence-retirement")).store;
    const packs = db.collection(ARCHIVE_PACKS_COLLECTION);
    const until = new Date(+now - RETIREMENT_SETTLE_MS);
    while (run.batches < (options.maxBatches ?? 4) && clock() - started < (options.budgetMs ?? 40_000)) {
      const rows = await nextBatch(db, cursor, until, options.batchSize ?? RETIREMENT_BATCH);
      if (!rows.length) break;
      const docs = rows.map((r) => r.doc);
      const effects = await loadEffects(db, docs);
      const verdicts = docs.map((doc) => verdictOf(doc, effects));
      const raw: RawRow[] = rows.map((r) => ({ raw: r.raw, id: String(r.doc._id) }));
      const bytes = encodePack(raw);
      const sha = sha256Hex(bytes);
      const first = docs[0]!.completed_at as Date, last = docs.at(-1)!.completed_at as Date;
      const name = salesIntelligenceRetirementObjectName(store.prefix, db.databaseName, first.toISOString().slice(0, 10), sha);
      const stored = await store.put({ name, bytes, contentType: CONTENT_TYPES.pack, customTime: now, metadata: { rows: String(rows.length) } });
      if (stored.sha256 !== sha || !packHoldsExactly(stored.persisted, raw)) throw new Error("retirement_pack_verification_failed");
      const ids = raw.map((r) => r.id).sort();
      const held: Record<string, number> = {};
      for (const v of verdicts) if (v.verdict === "hold") held[v.reason] = (held[v.reason] ?? 0) + 1;
      const counts = { retire: verdicts.filter((v) => v.verdict === "retire").length, hold: verdicts.filter((v) => v.verdict === "hold").length };
      await packs.updateOne({ name }, { $setOnInsert: {
        name, generation: stored.generation, sha256: stored.sha256, size: stored.size, rows: rows.length,
        first_id: new ObjectId(ids[0]), last_id: new ObjectId(ids.at(-1)), first_completed_at: first, last_completed_at: last,
        retire: counts.retire, hold: counts.hold, keep: rows.length - counts.retire - counts.hold, held_reasons: held,
        created_at: now, expires_at: new Date(+now + RETIREMENT_ARCHIVE_DAYS * DAY_MS),
      } }, { upsert: true });
      const compactions = docs.flatMap((doc, i) => {
        const v = verdicts[i]!;
        if (v.verdict !== "retire") return [];
        return [{ updateOne: {
          filter: { _id: doc._id, ...csiDataset(), status: "completed", record_kind: { $exists: false }, completed_at: doc.completed_at, payload_hash: doc.payload_hash },
          update: { $set: { record_kind: "completion_receipt", routine_purge_at: v.purge_at, updatedAt: now }, $unset: finishedExecutionFields(String(doc.stage)) },
        } }];
      });
      if (compactions.length) run.compacted += (await db.collection("sales_intelligence_jobs").bulkWrite(compactions, { ordered: false })).modifiedCount;
      cursor = last;
      const moved = await controls.updateOne({ _id: RETIREMENT_CONTROL_ID, lease_owner: owner },
        { $set: { cursor: { completed_at: cursor }, lease_until: new Date(clock() + LEASE_MS) } });
      run.batches++; run.rows += rows.length; run.retire += counts.retire; run.hold += counts.hold; run.keep += rows.length - counts.retire - counts.hold;
      for (const [k, n] of Object.entries(held)) run.held_reasons[k] = (run.held_reasons[k] ?? 0) + n;
      run.packs++; run.raw_bytes += raw.reduce((s, r) => s + r.raw.length, 0); run.packed_bytes += bytes.length;
      if (moved.matchedCount !== 1) break; // lease lost: the next owner resumes from the stored cursor
    }
  } finally {
    run.cursor = cursor?.toISOString() ?? null;
    run.lag_seconds = cursor ? Math.round((+now - +cursor) / 1000) : null;
    await controls.updateOne({ _id: RETIREMENT_CONTROL_ID, lease_owner: owner },
      { $set: { lease_owner: null, lease_until: null, last_run: { at: now, ...run } } });
    logger.info({ msg: "sales_intelligence.retirement.run", ...run });
  }
  return run;
}

/** Restores an archived job by original `_id` from its verified pack, or `null` when no live pack holds it. */
export async function lookupArchivedJob(db: Db, jobId: string, store?: ObjectStore) {
  const id = new ObjectId(jobId);
  const reader = store ?? (await openObjectStore(db, "sales-intelligence-retirement")).store;
  const candidates = await db.collection(ARCHIVE_PACKS_COLLECTION).find(
    { last_completed_at: { $gte: id.getTimestamp() }, first_id: { $lte: id }, last_id: { $gte: id } },
    { sort: { last_completed_at: 1 }, limit: 500 },
  ).toArray();
  for (const pack of candidates) {
    const bytes = await reader.readVerified({ name: pack.name, generation: pack.generation, sha256: pack.sha256, size: pack.size });
    const hit = decodePack(bytes).find((row) => row.id === jobId);
    if (hit) return { pack: { name: pack.name as string, generation: pack.generation as string }, doc: BSON.deserialize(hit.raw) };
  }
  return null;
}
