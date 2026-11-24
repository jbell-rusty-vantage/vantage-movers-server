import { randomUUID } from "node:crypto";
import type { ClientSession, Db, Document, ObjectId } from "mongodb";
import { getDailyOperationsCollectionName } from "../../config/domain/dailyOperations";
import { logger } from "../../logger";
import { DAILY_OPERATIONS_EVENT_TTL_INDEX } from "../../models/DailyOperationsEvent";
import { toObjectId } from "../../utils/objectId";
import { CONTENT_TYPES, isCloudStorageError, openObjectStore, retirementPackObjectName, sha256Hex, type ObjectStore } from "../cloudStorage";
import { bson, decodePack, encodePack, packHoldsExactly, type RawRow } from "../salesIntelligence/retirement/pack";
import { easternDayKey, easternInstantBounds, previousEasternDayKey } from "./dayDocument";

/**
 * Validated retirement of `daily_operations_events` for closed days (Owner approval 2026-11-23, proposal §1 of
 * docs/operations/VALIDATED-RETIREMENT-PROPOSALS-2026-11-23.md; Reference doc: docs/knowledge/validated-retirement.md).
 *
 * Every reader of an event body reads today only (board, `/events`, rebuild, live stream), and a closed day keeps its
 * frozen counters on the day document. An event's body has done its job when its day document is closed (`status`,
 * `closed_at`), the day is at least two New York days before today, and the day carries `webhook_counts_version: 1`
 * (the webhook backfill can never read it). Such an event is packed (exact BSON) to GCS with its 90-day clock started,
 * read back byte for byte, catalogued by `days` and `_id`, and then compacted **in place** to a dedupe fence
 * `{_id, dedupe_key, day, createdAt}` in a snapshot transaction that rechecks its exact bytes and its day.
 *
 * The fence keeps the unique `dedupe_key` index and the 400-day `createdAt` TTL working unchanged: a late fact on a
 * closed day, an Admin retry of an old Sheet job or an intake refresh that re-emits an old key still meets
 * `dedupe_key_1` and is a `duplicate`. A fence has no `kind`, `occurred_at` or card, and its day is never today, so no
 * board, page, rebuild or count reads it. A failure before the transaction changes nothing and the cursor does not move.
 *
 * The scan walks `createdAt` (the TTL index, no blocking sort) up to the start of yesterday in New York, so a late
 * event on an old closed day is reviewed when its own `createdAt` passes. Rows sharing one `createdAt` instant never
 * split across batches. Held rows keep their body for the ordinary 400 days, already archived.
 */
export const EVENT_RETIREMENT_CONTROL_COLLECTION = "daily_operations_event_retirement";
export const EVENT_RETIREMENT_CONTROL_ID = "v1";
export const EVENT_ARCHIVE_PACKS_COLLECTION = "daily_operations_event_archive_packs";
export const EVENT_ARCHIVE_PACK_INDEXES = [
  { name: "dailyops_event_pack_name_unique", key: { name: 1 }, unique: true },
  { name: "dailyops_event_pack_created", key: { last_created_at: 1 } },
  { name: "dailyops_event_pack_days", key: { days: 1 } },
  { name: "dailyops_event_pack_expiry", key: { expires_at: 1 }, expireAfterSeconds: 0 },
] as const;
export const EVENT_ARCHIVE_DAYS = 90;
/** Longer than any fact transaction can stay open (Atlas transaction lifetime 60 s). */
export const EVENT_SETTLE_MS = 5 * 60_000;
export const EVENT_BATCH = 500;
const EVENT_BATCH_BYTES = 8 * 1024 * 1024;
const LEASE_MS = 3 * 60_000;
const DAY_MS = 86_400_000;
const NAMESPACE = "daily-operations-events" as const;
const SCAN_HINT = DAILY_OPERATIONS_EVENT_TTL_INDEX.name;

/** `id` is set only while walking a group of rows that share one `createdAt` instant. */
type Cursor = { created_at: Date; id?: ObjectId | null };
type Control = { _id: string; enabled_at?: Date; cursor?: Cursor | null; lease_owner?: string | null; lease_until?: Date | null };
type Row = { raw: Buffer; doc: Document };
export type DayRow = { day: string; status?: unknown; closed_at?: unknown; webhook_counts_version?: unknown };
export type EventVerdict = { verdict: "retire" } | { verdict: "hold"; reason: string };
export type EventRetirementRun = {
  status: "disabled" | "lease_held" | "not_reviewable" | "ran";
  batches: number; rows: number; retire: number; hold: number; fenced: number; held_reasons: Record<string, number>;
  packs: number; raw_bytes: number; packed_bytes: number; until: string | null; cutoff_day: string | null;
  cursor: string | null; lag_seconds: number | null; reason?: string; error?: string; error_at?: string;
};

const empty = (status: EventRetirementRun["status"]): EventRetirementRun => ({ status, batches: 0, rows: 0, retire: 0, hold: 0, fenced: 0,
  held_reasons: {}, packs: 0, raw_bytes: 0, packed_bytes: 0, until: null, cutoff_day: null, cursor: null, lag_seconds: null });
export const eventsOf = (db: Db) => db.collection(getDailyOperationsCollectionName("events"));
export const daysOf = (db: Db) => db.collection<DayRow>(getDailyOperationsCollectionName("days"));
const toRows = (raws: unknown[]): Row[] => (raws as Buffer[]).map((raw) => ({ raw: Buffer.from(raw), doc: bson.deserialize(raw) as Document }));

/** Whether this event's body has done its job. Pure; `cutoffDay` is the newest New York day that may retire. */
export function eventVerdict(event: Document, day: DayRow | undefined, cutoffDay: string): EventVerdict {
  if (event.kind === undefined) return { verdict: "hold", reason: "already_fenced" };
  if (typeof event.dedupe_key !== "string" || !event.dedupe_key) return { verdict: "hold", reason: "dedupe_key_missing" };
  if (typeof event.day !== "string" || event.day > cutoffDay) return { verdict: "hold", reason: "day_too_recent" };
  if (!day) return { verdict: "hold", reason: "day_missing" };
  if (day.status !== "closed") return { verdict: "hold", reason: "day_open" };
  if (!(day.closed_at instanceof Date)) return { verdict: "hold", reason: "day_closed_at_missing" };
  if (day.webhook_counts_version !== 1) return { verdict: "hold", reason: "day_webhook_counts_unversioned" };
  return { verdict: "retire" };
}

/**
 * The dedupe fence a retired event leaves behind: what `dedupe_key_1` and the 400-day TTL need, nothing a reader renders.
 * Every live event has a `kind` (schema-required); a fence has none, which is how scans and readers tell them apart.
 */
export function fenceOf(event: Document): Document {
  return { _id: event._id, dedupe_key: event.dedupe_key, day: event.day, createdAt: event.createdAt };
}
/** Matches live events only (never a fence). */
export const LIVE_EVENT = { kind: { $exists: true } } as const;

/**
 * The review window at `now`: rows created before the start of yesterday in New York (and settled), on days up to the
 * day before yesterday. `reason` is set when nothing may be reviewed: an old day is still open (the hourly close cron
 * has not run), so its frozen totals are not final.
 */
export async function reviewWindow(db: Db, now: Date): Promise<{ until: Date; cutoffDay: string; reason?: string }> {
  const yesterday = previousEasternDayKey(easternDayKey(now));
  const cutoffDay = previousEasternDayKey(yesterday);
  const until = new Date(Math.min(+now - EVENT_SETTLE_MS, +easternInstantBounds(yesterday).start - 1));
  const open = await daysOf(db).findOne({ status: "open", day: { $lte: cutoffDay } }, { projection: { day: 1 } });
  return open ? { until, cutoffDay, reason: `day_open:${open.day}` } : { until, cutoffDay };
}

/** The day documents a batch's verdicts read (one `$in` on the unique `day`). */
export async function loadDays(db: Db, events: readonly Document[], session?: ClientSession): Promise<Map<string, DayRow>> {
  const keys = [...new Set(events.map((e) => e.day).filter((d): d is string => typeof d === "string"))];
  if (!keys.length) return new Map();
  const rows = await daysOf(db).find({ day: { $in: keys } },
    { projection: { day: 1, status: 1, closed_at: 1, webhook_counts_version: 1 }, ...(session ? { session } : {}) }).toArray();
  return new Map(rows.map((d) => [d.day, d]));
}

/** Rows up to the count and byte limits; returns the cut index (rows before it fit). */
function cutAt(rows: readonly Row[], size: number, bytes: number) {
  let total = 0, i = 0;
  for (; i < rows.length && i < size; i++) {
    total += rows[i]!.raw.length;
    if (total > bytes && i > 0) break;
  }
  return i;
}

/** Live (unfenced) events after `cursor`, in `createdAt` order; the filter every scan of the collection uses. */
export function pendingFilter(cursor: Cursor | null, until: Date): Document {
  return { ...LIVE_EVENT, createdAt: { ...(cursor ? { $gt: cursor.created_at } : {}), $lte: until } };
}

/** The next batch after `cursor`. A group of rows sharing one `createdAt` is walked separately by `_id`, never split. */
async function nextBatch(db: Db, cursor: Cursor | null, until: Date, size: number): Promise<{ rows: Row[]; next: Cursor | null }> {
  if (cursor?.id) {
    const group = toRows(await eventsOf(db).find({ ...LIVE_EVENT, createdAt: cursor.created_at, _id: { $gt: cursor.id } },
      { raw: true, sort: { _id: 1 }, limit: size, hint: SCAN_HINT }).toArray());
    const rows = group.slice(0, Math.max(1, cutAt(group, size, EVENT_BATCH_BYTES)));
    if (!rows.length) return { rows: [], next: { created_at: cursor.created_at, id: null } };
    return { rows, next: { created_at: cursor.created_at, id: rows.at(-1)!.doc._id as ObjectId } };
  }
  const rows = toRows(await eventsOf(db).find(pendingFilter(cursor, until),
    { raw: true, sort: { createdAt: 1 }, limit: size + 1, hint: SCAN_HINT }).toArray());
  const cut = cutAt(rows, size, EVENT_BATCH_BYTES);
  if (cut >= rows.length) return { rows, next: rows.length ? { created_at: rows.at(-1)!.doc.createdAt as Date } : null };
  const boundary = +rows[cut - 1]!.doc.createdAt;
  const kept = +rows[cut]!.doc.createdAt === boundary ? rows.slice(0, cut).filter((r) => +r.doc.createdAt !== boundary) : rows.slice(0, cut);
  if (kept.length) return { rows: kept, next: { created_at: kept.at(-1)!.doc.createdAt as Date } };
  return nextBatch(db, { created_at: new Date(boundary), id: toObjectId("000000000000000000000000") as unknown as ObjectId }, until, size);
}

/** Compacts the proven events whose stored bytes are still exactly the archived ones and whose day still qualifies. */
async function fenceProven(db: Db, proven: readonly RawRow[], cutoffDay: string) {
  if (!proven.length) return 0;
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const archived = new Map(proven.map((r) => [r.id, r.raw]));
      const fresh = toRows(await eventsOf(db).find({ _id: { $in: proven.map((r) => toObjectId(r.id)) } }, { raw: true, session }).toArray());
      const same = fresh.filter((r) => archived.get(String(r.doc._id))?.equals(r.raw)).map((r) => r.doc);
      const days = await loadDays(db, same, session);
      const ops = same.filter((doc) => eventVerdict(doc, days.get(doc.day), cutoffDay).verdict === "retire")
        .map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: fenceOf(doc) } }));
      if (!ops.length) return 0;
      return (await eventsOf(db).bulkWrite(ops, { session, ordered: true })).modifiedCount;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
}

export async function retireClosedDayEvents(db: Db, options: {
  now?: Date; store?: ObjectStore; maxBatches?: number; budgetMs?: number; batchSize?: number; owner?: string; clock?: () => number;
} = {}): Promise<EventRetirementRun> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const started = clock();
  const owner = options.owner ?? `dailyops-event-retirement:${randomUUID()}`;
  const controls = db.collection<Control>(EVENT_RETIREMENT_CONTROL_COLLECTION);
  const control = await controls.findOneAndUpdate(
    { _id: EVENT_RETIREMENT_CONTROL_ID, enabled_at: { $type: "date" }, $or: [{ lease_until: null }, { lease_until: { $exists: false } }, { lease_until: { $lte: now } }] },
    { $set: { lease_owner: owner, lease_until: new Date(+now + LEASE_MS) } },
    { returnDocument: "after" },
  );
  if (!control) {
    const row = await controls.findOne({ _id: EVENT_RETIREMENT_CONTROL_ID }, { projection: { enabled_at: 1 } });
    return empty(row?.enabled_at instanceof Date ? "lease_held" : "disabled");
  }
  const run = empty("ran");
  let cursor: Cursor | null = control.cursor ?? null;
  try {
    const window = await reviewWindow(db, now);
    run.until = window.until.toISOString();
    run.cutoff_day = window.cutoffDay;
    if (window.reason) { run.status = "not_reviewable"; run.reason = window.reason; return run; }
    // Every run re-checks, read-only, the single 90-day bucket rule the catalog expiry assumes.
    const opened = options.store ? null : await openObjectStore(db, NAMESPACE, { capability: "release" });
    const store = options.store ?? opened!.store;
    const recoveryDays = opened?.config.recoveryDays ?? EVENT_ARCHIVE_DAYS;
    while (run.batches < (options.maxBatches ?? 4) && clock() - started < (options.budgetMs ?? 40_000)) {
      const { rows, next } = await nextBatch(db, cursor, window.until, options.batchSize ?? EVENT_BATCH);
      if (!rows.length) {
        if (next && cursor?.id) { cursor = next; continue; } // finished a shared-instant group; resume by time
        break;
      }
      const docs = rows.map((r) => r.doc);
      const days = await loadDays(db, docs);
      const verdicts = docs.map((doc) => eventVerdict(doc, days.get(doc.day), window.cutoffDay));
      const raw: RawRow[] = rows.map((r) => ({ raw: r.raw, id: String(r.doc._id) }));
      const bytes = encodePack(raw);
      const sha = sha256Hex(bytes);
      const name = retirementPackObjectName(store.prefix, db.databaseName, String(docs[0]!.day ?? easternDayKey(docs[0]!.createdAt)), sha);
      const stored = await store.put({ name, bytes, contentType: CONTENT_TYPES.pack, customTime: now, metadata: { rows: String(rows.length) } });
      if (stored.sha256 !== sha || !packHoldsExactly(stored.persisted, raw)) throw new Error("event_pack_verification_failed");
      const ids = raw.map((r) => r.id).sort();
      const held: Record<string, number> = {};
      for (const v of verdicts) if (v.verdict === "hold") held[v.reason] = (held[v.reason] ?? 0) + 1;
      const retire = verdicts.filter((v) => v.verdict === "retire").length;
      await db.collection(EVENT_ARCHIVE_PACKS_COLLECTION).updateOne({ name }, { $setOnInsert: {
        name, generation: stored.generation, sha256: stored.sha256, size: stored.size, rows: rows.length,
        first_id: toObjectId(ids[0]!), last_id: toObjectId(ids.at(-1)!),
        first_created_at: docs[0]!.createdAt, last_created_at: docs.at(-1)!.createdAt,
        days: [...new Set(docs.map((d) => String(d.day)))].sort(),
        retire, hold: rows.length - retire, held_reasons: held,
        // One day before GCS can delete the object (the bucket counts whole days since its custom time).
        created_at: now, expires_at: new Date(+now + (recoveryDays - 1) * DAY_MS),
      } }, { upsert: true });
      run.fenced += await fenceProven(db, raw.filter((_, i) => verdicts[i]!.verdict === "retire"), window.cutoffDay);
      cursor = next;
      const moved = await controls.updateOne({ _id: EVENT_RETIREMENT_CONTROL_ID, lease_owner: owner },
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
    run.cursor = cursor?.created_at.toISOString() ?? null;
    run.lag_seconds = cursor ? Math.round((+now - +cursor.created_at) / 1000) : null;
    await controls.updateOne({ _id: EVENT_RETIREMENT_CONTROL_ID, lease_owner: owner },
      { $set: { cursor, lease_owner: null, lease_until: null, last_run: { at: now, ...run } } });
    logger.info({ msg: "daily_operations.event_retirement.run", ...run });
  }
  return run;
}

/** Restores an archived event by original `_id` from its verified pack, or `null` when no live pack holds it. */
export async function lookupArchivedEvent(db: Db, eventId: string, store?: ObjectStore) {
  const id = toObjectId(eventId);
  // The fence (hot for 400 days) carries the exact `createdAt`; without it, an hour of slack around the id's time.
  const fence = await eventsOf(db).findOne({ _id: id }, { projection: { createdAt: 1 } });
  const exact = fence?.createdAt instanceof Date ? fence.createdAt : null;
  const idTime = parseInt(eventId.slice(0, 8), 16) * 1000;
  const reader = store ?? (await openObjectStore(db, NAMESPACE)).store;
  const candidates = db.collection(EVENT_ARCHIVE_PACKS_COLLECTION).find(exact
    ? { first_created_at: { $lte: exact }, last_created_at: { $gte: exact }, first_id: { $lte: id }, last_id: { $gte: id } }
    : { last_created_at: { $gte: new Date(idTime - 3_600_000) }, first_id: { $lte: id }, last_id: { $gte: id } },
  { sort: { last_created_at: 1 } });
  for await (const pack of candidates) {
    let bytes: Buffer;
    try {
      bytes = await reader.readVerified({ name: pack.name, generation: pack.generation, sha256: pack.sha256, size: pack.size });
    } catch (error) {
      if (isCloudStorageError(error, "not_found")) continue; // expired from GCS ahead of its catalog row
      throw error;
    }
    const hit = decodePack(bytes).find((row) => row.id === eventId);
    if (hit) return { pack: { name: pack.name as string, generation: pack.generation as string }, raw: hit.raw, doc: bson.deserialize(hit.raw) };
  }
  return null;
}
