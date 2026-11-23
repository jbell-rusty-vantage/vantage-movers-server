import { randomUUID } from "node:crypto";
import type { Db, Document, ObjectId } from "mongodb";
import { logger } from "../../logger";
import { toObjectId } from "../../utils/objectId";
import { CONTENT_TYPES, isCloudStorageError, openObjectStore, retirementPackObjectName, sha256Hex, type ObjectStore } from "../cloudStorage";
import { getRingCentralCollectionName } from "../ringcentral/ringcentral-config";
import { loadEffects, verdictOf } from "../salesIntelligence/retirement/evidence";
import { bson, decodePack, encodePack, packHoldsExactly, type RawRow } from "../salesIntelligence/retirement/pack";
import { ARCHIVE_PACKS_COLLECTION as JOB_PACKS_COLLECTION } from "../salesIntelligence/retirement/worker";
import { captureProjectionDedupeKey, CAPTURE_PROJECTION_STAGE, WEBHOOK_RECEIPTS_SCOPE } from "./webhookFanout";

/**
 * Validated retirement of RingCentral telephony webhook receipts (`ringcentral_webhook_events`; Owner decision 5,
 * 2026-11-23; Reference doc: docs/knowledge/validated-retirement.md).
 *
 * A receipt's only purpose is its `capture_projection` job, which loads it once. A receipt leaves MongoDB one day after
 * it arrived when:
 * - the job for its key (`captureProjectionDedupeKey`) is completed **on this receipt** and its effect is proven: a full
 *   row's every touched call is at its revision (`verdictOf`), or a completion receipt was compacted by the job
 *   retirement worker, which proved the same thing (its catalog pack covers the job and was written in that run);
 * - the receipt watermark recovery has passed it (it can no longer re-ensure the job);
 * - it is not the newest telephony receipt (the Desk header reads that one's `receivedAt`).
 * Each batch is packed (exact BSON) to GCS with its 90-day clock started and read back byte for byte, then catalogued,
 * then the proven receipts are deleted in a snapshot transaction that rechecks their exact bytes. A failure before the
 * transaction changes nothing in MongoDB and the cursor does not move. Held receipts stay for the ordinary 7-day TTL,
 * already archived. Receipts without a telephony session (SMS message-store, validation) are not reviewed: nothing
 * reads them after capture and the TTL removes them.
 *
 * The capture job keeps its 7-day key fence (`CAPTURE_RECEIPT_RETENTION_DAYS`): a RingCentral redelivery of a retired
 * receipt's uuid is stored again, but its fan-out finds the completed job and projects nothing.
 */
export const RECEIPT_RETIREMENT_CONTROL_COLLECTION = "ringcentral_webhook_receipt_retirement";
export const RECEIPT_RETIREMENT_CONTROL_ID = "v1";
export const RECEIPT_ARCHIVE_PACKS_COLLECTION = "ringcentral_webhook_receipt_archive_packs";
export const RECEIPT_ARCHIVE_PACK_INDEXES = [
  { name: "rc_receipt_pack_name_unique", key: { name: 1 }, unique: true },
  { name: "rc_receipt_pack_received", key: { last_received_at: 1 } },
  { name: "rc_receipt_pack_expiry", key: { expires_at: 1 }, expireAfterSeconds: 0 },
] as const;
export const RECEIPT_ARCHIVE_DAYS = 90;
/** Owner decision 5: proven receipts stay one day hot. */
export const RECEIPT_HOT_MS = 86_400_000;
/** Kept behind the recovery watermark, well past its re-check overlap (`WEBHOOK_RECOVERY_OVERLAP_MINUTES`, default 5). */
export const RECEIPT_WATERMARK_MARGIN_MS = 60 * 60_000;
export const RECEIPT_BATCH = 500;
const RECEIPT_BATCH_BYTES = 8 * 1024 * 1024;
const LEASE_MS = 3 * 60_000;
const DAY_MS = 86_400_000;
/** The recovery scan's partial `{provider, receivedAt, _id}` index (telephony receipts only); keyset order without a sort. */
const SCAN_HINT = { provider: 1, receivedAt: 1, _id: 1 };
const TELEPHONY = { provider: "ringcentral", telephonySessionId: { $type: "string" } };

type Cursor = { received_at: Date; id: ObjectId };
type Control = { _id: string; enabled_at?: Date; cursor?: Cursor | null; lease_owner?: string | null; lease_until?: Date | null };
export type ReceiptVerdict = { verdict: "retire" } | { verdict: "hold"; reason: string };
/** The job-retirement catalog rows a compacted capture job can be matched against. */
type JobPack = { first_id: ObjectId; last_id: ObjectId; first_completed_at: Date; last_completed_at: Date; created_at: Date; retire: number };
export type ReceiptRetirementRun = {
  status: "disabled" | "lease_held" | "watermark_missing" | "ran";
  batches: number; rows: number; retire: number; hold: number; deleted: number; held_reasons: Record<string, number>;
  packs: number; raw_bytes: number; packed_bytes: number; until: string | null; cursor: string | null; lag_seconds: number | null;
  error?: string; error_at?: string;
};

const empty = (status: ReceiptRetirementRun["status"]): ReceiptRetirementRun => ({ status, batches: 0, rows: 0, retire: 0, hold: 0, deleted: 0,
  held_reasons: {}, packs: 0, raw_bytes: 0, packed_bytes: 0, until: null, cursor: null, lag_seconds: null });
export const receiptsOf = (db: Db) => db.collection(getRingCentralCollectionName("webhookEvents"));
const keyOf = (receipt: Document) => captureProjectionDedupeKey({ receiptId: String(receipt._id), uuid: typeof receipt.uuid === "string" ? receipt.uuid : null });
const within = (id: string, first: unknown, last: unknown) => String(first) <= id && id <= String(last);

/** Whether this receipt's capture job did its work. Pure; `jobs` is keyed by dedupe key. */
export function receiptVerdict(receipt: Document, jobs: Map<string, Document>, effects: Parameters<typeof verdictOf>[1], jobPacks: readonly JobPack[]): ReceiptVerdict {
  const job = jobs.get(keyOf(receipt));
  if (!job) return { verdict: "hold", reason: "job_missing" };
  if (job.status !== "completed") return { verdict: "hold", reason: "job_not_completed" };
  // A redelivery stored after the original left: the job belongs to the earlier row, so this one was never projected.
  if (String(job.input_refs?.[0]) !== String(receipt._id)) return { verdict: "hold", reason: "job_other_receipt" };
  if (job.record_kind === "completion_receipt") {
    // Compacted by the job retirement worker only after it proved the effect: that run catalogued a pack covering this
    // job and stamped the job with the same instant. A completion compacted on the spot (switch off) is not proof.
    const id = String(job._id), completed = job.completed_at instanceof Date ? +job.completed_at : NaN;
    const proven = jobPacks.some((p) => p.retire > 0 && +p.created_at === +job.updatedAt && within(id, p.first_id, p.last_id)
      && +p.first_completed_at <= completed && completed <= +p.last_completed_at);
    return proven ? { verdict: "retire" } : { verdict: "hold", reason: "job_receipt_unproven" };
  }
  const verdict = verdictOf(job, effects);
  if (verdict.verdict === "retire") return { verdict: "retire" };
  return { verdict: "hold", reason: verdict.verdict === "hold" ? verdict.reason : "capture_not_routine" };
}

/** Everything a batch's verdicts read: its jobs (one `$in` on the unique key), their effects, and matching catalog rows. */
export async function loadEvidence(db: Db, receipts: readonly Document[]) {
  const rows = await db.collection("sales_intelligence_jobs").find({ dedupe_key: { $in: receipts.map(keyOf) }, stage: CAPTURE_PROJECTION_STAGE }).toArray();
  const jobs = new Map(rows.map((j) => [String(j.dedupe_key), j]));
  const full = rows.filter((j) => j.status === "completed" && j.record_kind === undefined);
  const effects = await loadEffects(db, full);
  const compacted = rows.filter((j) => j.record_kind === "completion_receipt" && j.completed_at instanceof Date);
  let jobPacks: JobPack[] = [];
  if (compacted.length) {
    const times = compacted.map((j) => +j.completed_at);
    jobPacks = await db.collection<JobPack>(JOB_PACKS_COLLECTION).find(
      { last_completed_at: { $gte: new Date(Math.min(...times)) }, first_completed_at: { $lte: new Date(Math.max(...times)) } },
      { projection: { first_id: 1, last_id: 1, first_completed_at: 1, last_completed_at: 1, created_at: 1, retire: 1 } },
    ).toArray();
  }
  return { jobs, effects, jobPacks };
}

/**
 * The newest instant a receipt may have to be reviewed: one day old, behind the recovery watermark, and older than the
 * newest telephony receipt. `null` when the watermark has never been written (recovery could still need any receipt).
 */
export async function reviewUntil(db: Db, now: Date): Promise<Date | null> {
  const state = await db.collection("sales_intelligence_sync_state").findOne({ scope: WEBHOOK_RECEIPTS_SCOPE }, { projection: { "cursor.last_sync_to": 1 } });
  const watermark = state?.cursor?.last_sync_to;
  if (!(watermark instanceof Date)) return null;
  const newest = await receiptsOf(db).findOne(TELEPHONY, { sort: { receivedAt: -1 }, projection: { receivedAt: 1 } });
  const bounds = [+now - RECEIPT_HOT_MS, +watermark - RECEIPT_WATERMARK_MARGIN_MS, newest?.receivedAt instanceof Date ? +newest.receivedAt - 1 : -Infinity];
  return new Date(Math.min(...bounds));
}

/** The next telephony receipts after `cursor`, in `(receivedAt, _id)` order, up to the count and byte limits. */
async function nextBatch(db: Db, cursor: Cursor | null, until: Date, size: number) {
  const after = cursor ? { $or: [{ receivedAt: { $gt: cursor.received_at } }, { receivedAt: cursor.received_at, _id: { $gt: cursor.id } }] } : {};
  const raws = await receiptsOf(db).find({ ...TELEPHONY, receivedAt: { $lte: until }, ...after },
    { raw: true, sort: { receivedAt: 1, _id: 1 }, limit: size, hint: SCAN_HINT }).toArray() as unknown as Buffer[];
  const rows: Array<{ raw: Buffer; doc: Document }> = [];
  let bytes = 0;
  for (const raw of raws) {
    bytes += raw.length;
    if (bytes > RECEIPT_BATCH_BYTES && rows.length) break;
    rows.push({ raw: Buffer.from(raw), doc: bson.deserialize(raw) as Document });
  }
  return rows;
}

/** Deletes the proven receipts whose stored bytes are still exactly the archived ones. */
async function deleteProven(db: Db, proven: readonly RawRow[]) {
  if (!proven.length) return 0;
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const ids = proven.map((r) => toObjectId(r.id));
      const fresh = await receiptsOf(db).find({ _id: { $in: ids } }, { raw: true, session }).toArray() as unknown as Buffer[];
      const archived = new Map(proven.map((r) => [r.id, r.raw]));
      const same = fresh.map((raw) => Buffer.from(raw)).filter((raw) => archived.get(String(bson.deserialize(raw)._id))?.equals(raw))
        .map((raw) => bson.deserialize(raw)._id as ObjectId);
      if (!same.length) return 0;
      return (await receiptsOf(db).deleteMany({ _id: { $in: same } }, { session })).deletedCount;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
}

export async function retireProvenReceipts(db: Db, options: {
  now?: Date; store?: ObjectStore; maxBatches?: number; budgetMs?: number; batchSize?: number; owner?: string; clock?: () => number;
} = {}): Promise<ReceiptRetirementRun> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const started = clock();
  const owner = options.owner ?? `rc-receipt-retirement:${randomUUID()}`;
  const controls = db.collection<Control>(RECEIPT_RETIREMENT_CONTROL_COLLECTION);
  const control = await controls.findOneAndUpdate(
    { _id: RECEIPT_RETIREMENT_CONTROL_ID, enabled_at: { $type: "date" }, $or: [{ lease_until: null }, { lease_until: { $exists: false } }, { lease_until: { $lte: now } }] },
    { $set: { lease_owner: owner, lease_until: new Date(+now + LEASE_MS) } },
    { returnDocument: "after" },
  );
  if (!control) {
    const row = await controls.findOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID }, { projection: { enabled_at: 1 } });
    return empty(row?.enabled_at instanceof Date ? "lease_held" : "disabled");
  }
  const run = empty("ran");
  let cursor: Cursor | null = control.cursor ?? null;
  try {
    const until = await reviewUntil(db, now);
    if (!until) { run.status = "watermark_missing"; return run; }
    run.until = until.toISOString();
    // Every run re-checks, read-only, the single 90-day bucket rule the catalog expiry assumes.
    const opened = options.store ? null : await openObjectStore(db, "ringcentral-webhook-receipts", { capability: "release" });
    const store = options.store ?? opened!.store;
    const recoveryDays = opened?.config.recoveryDays ?? RECEIPT_ARCHIVE_DAYS;
    while (run.batches < (options.maxBatches ?? 4) && clock() - started < (options.budgetMs ?? 40_000)) {
      const rows = await nextBatch(db, cursor, until, options.batchSize ?? RECEIPT_BATCH);
      if (!rows.length) break;
      const docs = rows.map((r) => r.doc);
      const evidence = await loadEvidence(db, docs);
      const verdicts = docs.map((doc) => receiptVerdict(doc, evidence.jobs, evidence.effects, evidence.jobPacks));
      const raw: RawRow[] = rows.map((r) => ({ raw: r.raw, id: String(r.doc._id) }));
      const bytes = encodePack(raw);
      const sha = sha256Hex(bytes);
      const first = docs[0]!.receivedAt as Date, last = docs.at(-1)!.receivedAt as Date;
      const name = retirementPackObjectName(store.prefix, db.databaseName, first.toISOString().slice(0, 10), sha);
      const stored = await store.put({ name, bytes, contentType: CONTENT_TYPES.pack, customTime: now, metadata: { rows: String(rows.length) } });
      if (stored.sha256 !== sha || !packHoldsExactly(stored.persisted, raw)) throw new Error("receipt_pack_verification_failed");
      const ids = raw.map((r) => r.id).sort();
      const held: Record<string, number> = {};
      for (const v of verdicts) if (v.verdict === "hold") held[v.reason] = (held[v.reason] ?? 0) + 1;
      const retire = verdicts.filter((v) => v.verdict === "retire").length;
      await db.collection(RECEIPT_ARCHIVE_PACKS_COLLECTION).updateOne({ name }, { $setOnInsert: {
        name, generation: stored.generation, sha256: stored.sha256, size: stored.size, rows: rows.length,
        first_id: toObjectId(ids[0]!), last_id: toObjectId(ids.at(-1)!), first_received_at: first, last_received_at: last,
        retire, hold: rows.length - retire, held_reasons: held,
        // One day before GCS can delete the object (the bucket counts whole days since its custom time).
        created_at: now, expires_at: new Date(+now + (recoveryDays - 1) * DAY_MS),
      } }, { upsert: true });
      run.deleted += await deleteProven(db, raw.filter((_, i) => verdicts[i]!.verdict === "retire"));
      cursor = { received_at: last, id: docs.at(-1)!._id as ObjectId };
      const moved = await controls.updateOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID, lease_owner: owner },
        { $set: { cursor, lease_until: new Date(clock() + LEASE_MS) } });
      run.batches++; run.rows += rows.length; run.retire += retire; run.hold += rows.length - retire;
      for (const [k, n] of Object.entries(held)) run.held_reasons[k] = (run.held_reasons[k] ?? 0) + n;
      run.packs++; run.raw_bytes += raw.reduce((s, r) => s + r.raw.length, 0); run.packed_bytes += bytes.length;
      if (moved.matchedCount !== 1) break; // lease lost: the next owner resumes from the stored cursor
    }
  } catch (error) {
    run.error = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    if (error instanceof Error && error.stack) run.error_at = error.stack.split(/\r?\n/).slice(1, 3).map((l) => l.trim()).join(" | ").slice(0, 300);
    throw error;
  } finally {
    run.cursor = cursor?.received_at.toISOString() ?? null;
    run.lag_seconds = cursor ? Math.round((+now - +cursor.received_at) / 1000) : null;
    await controls.updateOne({ _id: RECEIPT_RETIREMENT_CONTROL_ID, lease_owner: owner },
      { $set: { lease_owner: null, lease_until: null, last_run: { at: now, ...run } } });
    logger.info({ msg: "ringcentral.receipt_retirement.run", ...run });
  }
  return run;
}

/** Restores an archived receipt by original `_id` from its verified pack, or `null` when no live pack holds it. */
export async function lookupArchivedReceipt(db: Db, receiptId: string, store?: ObjectStore) {
  const id = toObjectId(receiptId);
  // `receivedAt` is stamped before the insert generates the id; an hour of slack covers any delay between them.
  const created = new Date(parseInt(receiptId.slice(0, 8), 16) * 1000 - 3_600_000);
  const reader = store ?? (await openObjectStore(db, "ringcentral-webhook-receipts")).store;
  const candidates = db.collection(RECEIPT_ARCHIVE_PACKS_COLLECTION).find(
    { last_received_at: { $gte: created }, first_id: { $lte: id }, last_id: { $gte: id } },
    { sort: { last_received_at: 1 } },
  );
  for await (const pack of candidates) {
    let bytes: Buffer;
    try {
      bytes = await reader.readVerified({ name: pack.name, generation: pack.generation, sha256: pack.sha256, size: pack.size });
    } catch (error) {
      if (isCloudStorageError(error, "not_found")) continue; // expired from GCS ahead of its catalog row
      throw error;
    }
    const hit = decodePack(bytes).find((row) => row.id === receiptId);
    if (hit) return { pack: { name: pack.name as string, generation: pack.generation as string }, doc: bson.deserialize(hit.raw) };
  }
  return null;
}
