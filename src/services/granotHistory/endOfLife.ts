import { randomUUID } from "node:crypto";
import type { ClientSession, Db, Document } from "mongodb";
import { logger } from "../../logger";
import { CLOUD_STORAGE_NAMESPACES, granotHistoryObjectName, isCloudStorageError, openObjectStore, type ObjectStore } from "../cloudStorage";
import { evidenceFormat } from "./evidencePage";
import { RETIRED_CHANNELS, RETIRED_RECEIPT_FORMATS } from "./retiredRecords";

/**
 * Granot history end of life (Owner decision 2, 2026-11-23). A retired Granot object starts its GCS
 * recovery clock, so the bucket deletes it after the namespace's recovery days (90), and every
 * MongoDB row that points at it expires one day earlier (`expires_at`, TTL). Doc:
 * docs/knowledge/granot-lifecycle/storage-retention-operations.md#end-of-life.
 *
 * Invariant: a row never outlives an object it points at. Rows are marked first (`expires_at` only
 * ever moves earlier), then the clock starts; a clock that fails to start leaves an object that
 * outlives its rows, never the reverse.
 *
 * An object is eligible only while every row pointing at it is a retired-record locator or catalog
 * row (`granot_archived_receipts`, `granot_history_archive_chunks`) whose record has fully left
 * MongoDB. These keep it forever instead:
 * - a hot receipt pointing at it (`evidence_archive`/`history_archive`): that chain is still live;
 * - a receipt locator whose Observation is still hot: Pool admission and the timeline read the
 *   locator to prove the receipt completed (reference holds keep such Observations hot);
 * - a closed scheduled run or run summary: the closed-run row fences deterministic run creation
 *   and serves same-key replay to `applyAutomationPlanAction`, with no Owner-defined bound.
 *
 * Releasing follows the namespace review (cloud-storage.md): a review hold under `REVIEW_TOKEN`,
 * then the 800 s drain, then `startRecoveryClock`, whose reference guard refuses while any row that
 * would outlive the object still points at it. A re-put of identical bytes during or after review
 * re-holds the generation (reuse policy `rehold`), so a new reader is never left on a clocked object.
 */
export const END_OF_LIFE_CONTROL = "end-of-life-v1";
export const END_OF_LIFE_KINDS = ["receipt", "evidence", "history"] as const;
export type EndOfLifeKind = (typeof END_OF_LIFE_KINDS)[number];
export const END_OF_LIFE_STATE = "granot_history_end_of_life";
/** The review hold token, constant so a later pass resumes the same review instead of colliding with it. */
export const REVIEW_TOKEN = "end-of-life-v1";
/**
 * Hard bound of the extension-operation duplicate fence: the browser extension retries a pending
 * operation ID for at most 7 days (`PENDING_OPERATION_MAX_AGE_MS`, granot_sync_extensions_and_services
 * src/lifecycle/ledger.ts). A channel locator is never set to expire before `captured_at` plus this.
 * HTTP automation IDs are deterministic per run and action, and closed runs (kept) fence those.
 */
export const EXTENSION_REPLAY_DAYS = 7;
const DAY_MS = 86_400_000;
const LEASE_MS = 3 * 60_000;
/** Margin over the review drain for clock skew between this process and the provider's `updated`. */
const SKEW_MS = 60_000;
const DRAIN_MS = CLOUD_STORAGE_NAMESPACES["granot-history"].review!.drainMs;

type Control = {
  _id: string; enabled_at?: Date; kinds?: EndOfLifeKind[]; cursors?: Partial<Record<EndOfLifeKind, unknown>>;
  lease_owner?: string | null; lease_until?: Date | null;
};
type StateRow = { _id: string; kind: EndOfLifeKind; generation?: string; review_at?: Date; due_at?: Date; queued_at?: Date };
type RowRef = { coll: "archived" | "chunks"; _id: unknown; expires_at?: Date; fence_until?: Date; points: { hash: string; kind: EndOfLifeKind }[] };
export type References = { rows: RowRef[]; blocked: string | null };

const control = (db: Db) => db.collection<Control>("granot_retention_control");
const stateOf = (db: Db) => db.collection<StateRow>(END_OF_LIFE_STATE);
const archived = (db: Db) => db.collection("granot_archived_receipts");
const chunks = (db: Db) => db.collection("granot_history_archive_chunks");

/** The indexes end of life reads by, plus the two TTLs. Sparse, so `$in` equality uses them. Idempotent. */
export const END_OF_LIFE_INDEXES: [string, Document, Document][] = [
  ["granot_archived_receipts", { hash: 1 }, { name: "granot_archived_receipt_hash", sparse: true }],
  ["granot_archived_receipts", { "evidence_archive.hash": 1 }, { name: "granot_archived_receipt_evidence_hash", sparse: true }],
  ["granot_archived_receipts", { "history_archive.hash": 1 }, { name: "granot_archived_receipt_history_hash", sparse: true }],
  ["granot_archived_receipts", { expires_at: 1 }, { name: "granot_archived_receipt_expiry", expireAfterSeconds: 0 }],
  ["granot_webhook_receipts", { "evidence_archive.hash": 1 }, { name: "granot_receipt_evidence_hash", sparse: true }],
  ["granot_webhook_receipts", { "history_archive.hash": 1 }, { name: "granot_receipt_history_hash", sparse: true }],
  ["granot_history_archive_chunks", { hash: 1 }, { name: "granot_archive_chunk_hash", sparse: true }],
  ["granot_history_archive_chunks", { expires_at: 1 }, { name: "granot_archive_chunk_expiry", expireAfterSeconds: 0 }],
  [END_OF_LIFE_STATE, { due_at: 1 }, { name: "granot_end_of_life_due", sparse: true }],
  [END_OF_LIFE_STATE, { queued_at: 1 }, { name: "granot_end_of_life_queued", sparse: true }],
];
export async function installEndOfLife(db: Db) {
  for (const [name, key, options] of END_OF_LIFE_INDEXES) await db.collection(name).createIndex(key, options);
}

function pointsOfArchived(row: Document): RowRef["points"] {
  const points: RowRef["points"] = [];
  if ((RETIRED_RECEIPT_FORMATS as readonly string[]).includes(row.format) && typeof row.hash === "string") points.push({ hash: row.hash, kind: "receipt" });
  if (typeof row.evidence_archive?.hash === "string") points.push({ hash: row.evidence_archive.hash, kind: "evidence" });
  if (typeof row.history_archive?.hash === "string") points.push({ hash: row.history_archive.hash, kind: "history" });
  if (!row.format && typeof row.hash === "string" && row.job) points.push({ hash: row.hash, kind: "history" });
  return points;
}
const pointsOfChunk = (row: Document): RowRef["points"] =>
  [{ hash: String(row.hash ?? row._id), kind: row.format === evidenceFormat ? "evidence" : "history" }];

/**
 * Every MongoDB row that points at each object, and the first reason it must be kept, read at one
 * snapshot when `session` is given. One indexed `$in` read per collection.
 */
export async function referencesOf(db: Db, hashes: string[], session?: ClientSession): Promise<Map<string, References>> {
  const out = new Map<string, References>(hashes.map((h) => [h, { rows: [], blocked: null }]));
  if (!hashes.length) return out;
  const $in = hashes, opts = { session, maxTimeMS: 10_000 };
  const block = (hash: string, reason: string) => { const r = out.get(hash); if (r && !r.blocked) r.blocked = reason; };
  // Sequential: reads that share one transaction session cannot run concurrently.
  const reads = [
    () => archived(db).find({ $or: [{ hash: { $in } }, { "evidence_archive.hash": { $in } }, { "history_archive.hash": { $in } }] },
      { ...opts, projection: { hash: 1, format: 1, job: 1, "evidence_archive.hash": 1, "history_archive.hash": 1, expires_at: 1, observation_channel: 1, channel_operation_id: 1, captured_at: 1 } }).toArray(),
    () => chunks(db).find({ $or: [{ _id: { $in } as never }, { hash: { $in } }] }, { ...opts, projection: { hash: 1, format: 1, expires_at: 1 } }).toArray(),
    () => db.collection("granot_webhook_receipts").find({ $or: [{ "evidence_archive.hash": { $in } }, { "history_archive.hash": { $in } }] },
      { ...opts, projection: { "evidence_archive.hash": 1, "history_archive.hash": 1 } }).toArray(),
    () => db.collection("granot_closed_automation_runs").find({ $or: [{ hash: { $in } }, { "run_archive.hash": { $in } }] },
      { ...opts, projection: { hash: 1, "run_archive.hash": 1 } }).toArray(),
    () => db.collection("granot_automation_runs").find({ "archive_summary.hash": { $in } }, { ...opts, projection: { "archive_summary.hash": 1 } }).toArray(),
  ];
  const results: Document[][] = [];
  for (const read of reads) results.push(await read());
  const [locators, catalog, hot, closed, runs] = results as [Document[], Document[], Document[], Document[], Document[]];
  for (const row of hot) for (const h of [row.evidence_archive?.hash, row.history_archive?.hash]) if (h) block(h, "hot_receipt");
  for (const row of closed) for (const h of [row.hash, row.run_archive?.hash]) if (h) block(h, "closed_run");
  for (const row of runs) block(row.archive_summary?.hash, "automation_run");
  const observations = locators.length ? await db.collection("granot_observations").find(
    { receipt_id: { $in: locators.map((r) => r._id) } }, { ...opts, projection: { receipt_id: 1 } }).toArray() : [];
  const hotObservation = new Set(observations.map((o) => String(o.receipt_id)));
  for (const row of locators) {
    const points = pointsOfArchived(row);
    const channel = (RETIRED_CHANNELS as readonly string[]).includes(row.observation_channel) && typeof row.channel_operation_id === "string";
    const ref: RowRef = { coll: "archived", _id: row._id, expires_at: row.expires_at, points,
      ...(channel && row.captured_at instanceof Date ? { fence_until: new Date(+row.captured_at + EXTENSION_REPLAY_DAYS * DAY_MS) } : {}) };
    for (const { hash } of points) {
      out.get(hash)?.rows.push(ref);
      if (hotObservation.has(String(row._id))) block(hash, "observation_hot");
    }
  }
  for (const row of catalog) {
    const ref: RowRef = { coll: "chunks", _id: row._id, expires_at: row.expires_at, points: pointsOfChunk(row) };
    out.get(ref.points[0]!.hash)?.rows.push(ref);
  }
  return out;
}

/** Whether a row still pointing at the object would outlive `expiresAt` (the reference guard of the clock). */
const outlives = (refs: References, expiresAt: Date) =>
  !!refs.blocked || refs.rows.some((r) => !(r.expires_at instanceof Date) || +r.expires_at > +expiresAt);

async function snapshot<T>(db: Db, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = db.client.startSession();
  try {
    return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }) as T;
  } finally {
    await session.endSession();
  }
}

/**
 * Moves `expires_at` of every row pointing at `hash` to `expiresAt` or earlier, at one snapshot, and
 * queues every other object those rows point at (it must not be orphaned once its rows are gone).
 * Returns the blocking reason instead, changing nothing.
 */
async function markRows(db: Db, hash: string, expiresAt: Date, now: Date): Promise<{ blocked: string } | { rows: number }> {
  const result = await snapshot(db, async (session) => {
    const refs = (await referencesOf(db, [hash], session)).get(hash)!;
    if (refs.blocked) return { blocked: refs.blocked };
    if (refs.rows.some((r) => r.fence_until && +r.fence_until > +expiresAt)) return { blocked: "operation_fence_window" };
    const earlier = { $or: [{ expires_at: { $exists: false } }, { expires_at: { $gt: expiresAt } }] };
    for (const coll of ["archived", "chunks"] as const) {
      const ids = refs.rows.filter((r) => r.coll === coll).map((r) => r._id);
      if (ids.length) await (coll === "archived" ? archived(db) : chunks(db)).updateMany({ _id: { $in: ids as never[] }, ...earlier }, { $set: { expires_at: expiresAt } }, { session });
    }
    const others = new Map<string, EndOfLifeKind>();
    for (const r of refs.rows) for (const p of r.points) if (p.hash !== hash) others.set(p.hash, p.kind);
    return { rows: refs.rows.length, others };
  });
  if ("blocked" in result) return result;
  for (const [other, kind] of result.others) {
    await stateOf(db).updateOne({ _id: other }, { $setOnInsert: { kind, queued_at: now } }, { upsert: true });
  }
  return { rows: result.rows };
}

export type EndOfLifeOutcome = "review_started" | "released" | "draining" | "already_released" | string;

/** Step 1: classify, then place the review hold. Blocked objects are left as they are. */
export async function startReview(db: Db, store: ObjectStore, hash: string, kind: EndOfLifeKind, now: Date, days: number): Promise<{ outcome: EndOfLifeOutcome; rows?: number }> {
  const name = granotHistoryObjectName(store.prefix, db.databaseName, hash);
  const object = await store.stat(name);
  // A queued object that cannot be reviewed leaves the queue; it keeps its bytes and its other holds.
  const skip = async (outcome: string) => { await stateOf(db).deleteOne({ _id: hash, queued_at: { $exists: true } }); return { outcome }; };
  if (!object) return skip("object_missing");
  if (object.independentHold || object.retentionLocked) return skip("independent_hold");
  if (object.recoveryClockStartedAt && !Object.keys(object.holds).length) {
    // Already released (a manual review): its rows must expire before the bucket deletes it.
    const until = Math.max(+now, Date.parse(object.recoveryClockStartedAt) + (days - 1) * DAY_MS);
    const marked = await markRows(db, hash, new Date(until), now);
    await stateOf(db).deleteOne({ _id: hash });
    return "blocked" in marked ? { outcome: marked.blocked } : { outcome: "already_released", rows: marked.rows };
  }
  const review = object.holds.review;
  if (review && review !== REVIEW_TOKEN) return skip("review_in_progress");
  const refs = (await referencesOf(db, [hash])).get(hash)!;
  if (refs.blocked) {
    if (review === REVIEW_TOKEN) await store.release({ name, generation: object.generation }, "review", REVIEW_TOKEN);
    await stateOf(db).deleteOne({ _id: hash });
    return { outcome: refs.blocked };
  }
  await store.hold({ name, generation: object.generation }, { holder: "review", token: REVIEW_TOKEN, replaces: ["publisher"] });
  await stateOf(db).updateOne({ _id: hash }, {
    $set: { kind, generation: object.generation, review_at: now, due_at: new Date(+now + DRAIN_MS + SKEW_MS) }, $unset: { queued_at: "" },
  }, { upsert: true });
  return { outcome: "review_started" };
}

/** Step 2, after the drain: mark the rows, then start the clock under the reference guard. */
export async function finishReview(db: Db, store: ObjectStore, row: StateRow, now: Date, days: number): Promise<{ outcome: EndOfLifeOutcome; rows?: number }> {
  const name = granotHistoryObjectName(store.prefix, db.databaseName, row._id);
  const ref = { name, generation: row.generation!, sha256: row._id };
  const object = await store.stat(name, row.generation);
  const done = async (outcome: string, rows?: number) => { await stateOf(db).deleteOne({ _id: row._id }); return { outcome, rows }; };
  if (!object) return done("object_missing");
  // A re-put cancelled the review (reuse policy): the object has a new reader. Review it again on a later lap.
  if (object.holds.review !== REVIEW_TOKEN) return done("review_cancelled");
  // Not drained yet: nothing is marked, so a review cancelled later leaves every row as it was.
  if (+now - Date.parse(object.updated) < DRAIN_MS) {
    await stateOf(db).updateOne({ _id: row._id }, { $set: { due_at: new Date(Date.parse(object.updated) + DRAIN_MS + SKEW_MS) } });
    return { outcome: "draining" };
  }
  const expiresAt = new Date(+now + (days - 1) * DAY_MS);
  const marked = await markRows(db, row._id, expiresAt, now);
  if ("blocked" in marked) {
    await store.release(ref, "review", REVIEW_TOKEN);
    return done(marked.blocked);
  }
  try {
    await store.startRecoveryClock(ref, {
      reviewToken: REVIEW_TOKEN,
      references: async () => outlives((await snapshot(db, (s) => referencesOf(db, [row._id], s))).get(row._id)!, expiresAt),
    });
  } catch (error) {
    if (isCloudStorageError(error, "hold_not_drained")) {
      await stateOf(db).updateOne({ _id: row._id }, { $set: { due_at: new Date(+now + 5 * 60_000) } });
      return { outcome: "draining" };
    }
    if (isCloudStorageError(error, "referenced") || isCloudStorageError(error, "held")) {
      // A new row arrived after marking: the object keeps serving it, and the marked rows still expire first.
      await store.release(ref, "review", REVIEW_TOKEN).catch(() => undefined);
      return done(`clock_refused_${(error as { code: string }).code}`);
    }
    throw error;
  }
  return done("released", marked.rows);
}

type ScanRow = { hash: string; kind: EndOfLifeKind; cursor: unknown };
/** One page of rows not yet expiring, per kind, in `_id` order after `cursor`. */
export async function scanCandidates(db: Db, kind: EndOfLifeKind, cursor: unknown, limit: number): Promise<ScanRow[]> {
  const after: Document = cursor == null ? {} : { _id: { $gt: cursor } };
  const unmarked = { expires_at: { $exists: false } };
  if (kind === "receipt") {
    const rows = await archived(db).find({ ...after, ...unmarked, format: { $in: [...RETIRED_RECEIPT_FORMATS] } }, { projection: { hash: 1 }, sort: { _id: 1 }, limit, maxTimeMS: 5000 }).toArray();
    return rows.map((r) => ({ hash: String(r.hash), kind, cursor: r._id }));
  }
  const rows = await chunks(db).find({ ...after, ...unmarked, format: kind === "evidence" ? evidenceFormat : { $exists: false } } as never,
    { projection: { hash: 1 }, sort: { _id: 1 }, limit, maxTimeMS: 5000 }).toArray();
  return rows.map((r) => ({ hash: String(r.hash ?? r._id), kind, cursor: r._id }));
}

export type EndOfLifeRun = {
  status: "not_configured" | "lease_held" | "ran" | "failed";
  released: number; reviews_started: number; draining: number; rows_marked: number; scanned: number;
  outcomes: Record<string, number>; failures: number; error?: string;
};

/**
 * The online pass (cron every two minutes). Off until the Owner writes `granot_retention_control`
 * `{ _id: "end-of-life-v1", enabled_at, kinds }`. Finishes drained reviews, reviews queued objects,
 * then scans the next page of each enabled kind, wrapping at the end. The backlog command calls it
 * with larger budgets.
 */
export async function endOfLifePass(db: Db, options: { now?: Date; store?: ObjectStore; days?: number; limit?: number; page?: number; budgetMs?: number; clock?: () => number } = {}): Promise<EndOfLifeRun> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const started = clock();
  const run: EndOfLifeRun = { status: "ran", released: 0, reviews_started: 0, draining: 0, rows_marked: 0, scanned: 0, outcomes: {}, failures: 0 };
  const owner = `granot-eol:${randomUUID()}`;
  const config = await control(db).findOneAndUpdate(
    { _id: END_OF_LIFE_CONTROL, enabled_at: { $type: "date" }, $or: [{ lease_until: null }, { lease_until: { $exists: false } }, { lease_until: { $lte: now } }] },
    { $set: { lease_owner: owner, lease_until: new Date(+now + LEASE_MS) } }, { returnDocument: "after" });
  if (!config) {
    const row = await control(db).findOne({ _id: END_OF_LIFE_CONTROL }, { projection: { enabled_at: 1 } });
    return { ...run, status: row?.enabled_at instanceof Date ? "lease_held" : "not_configured" };
  }
  const limit = options.limit ?? 12, budget = options.budgetMs ?? 30_000;
  const inBudget = () => clock() - started < budget;
  const note = (outcome: string, rows = 0) => {
    run.outcomes[outcome] = (run.outcomes[outcome] ?? 0) + 1;
    run.rows_marked += rows;
    if (outcome === "released" || outcome === "already_released") run.released++;
    if (outcome === "review_started") run.reviews_started++;
    if (outcome === "draining") run.draining++;
  };
  const attempt = async (work: () => Promise<{ outcome: string; rows?: number }>) => {
    try { const r = await work(); note(r.outcome, r.rows); } catch { run.failures++; }
  };
  const cursors = { ...(config.cursors ?? {}) };
  try {
    // The release capability exists only while the bucket rule matches the recovery days (90).
    const opened = options.store ? null : await openObjectStore(db, "granot-history", { capability: "release" });
    const store = options.store ?? opened!.store;
    const days = options.days ?? opened!.config.recoveryDays;
    for (const row of await stateOf(db).find({ due_at: { $lte: now } }, { sort: { due_at: 1 }, limit }).toArray()) {
      if (!inBudget()) break;
      await attempt(() => finishReview(db, store, row, now, days));
    }
    // Objects whose last unmarked row another release just marked; only kinds the Owner enabled.
    for (const row of await stateOf(db).find({ queued_at: { $exists: true }, kind: { $in: config.kinds ?? [] } }, { sort: { queued_at: 1 }, limit }).toArray()) {
      if (!inBudget()) break;
      await attempt(() => startReview(db, store, row._id, row.kind, now, days));
    }
    let reviews = 0;
    for (const kind of config.kinds ?? []) {
      if (!inBudget() || reviews >= limit) break;
      const page = await scanCandidates(db, kind, cursors[kind] ?? null, options.page ?? 200);
      run.scanned += page.length;
      const wanted = [...new Map(page.map((r) => [r.hash, r])).values()];
      const inState = new Set((await stateOf(db).find({ _id: { $in: wanted.map((r) => r.hash) } }, { projection: { _id: 1 } }).toArray()).map((r) => r._id));
      const refs = await referencesOf(db, wanted.map((r) => r.hash).filter((h) => !inState.has(h)));
      let last: unknown = cursors[kind] ?? null;
      for (const row of page) {
        if (reviews >= limit || !inBudget()) break;
        last = row.cursor;
        const r = refs.get(row.hash);
        if (!r) continue; // already under review, or a duplicate hash on this page
        refs.delete(row.hash);
        if (r.blocked) { note(r.blocked); continue; }
        reviews++;
        await attempt(() => startReview(db, store, row.hash, kind, now, days));
      }
      // Wrap once the scan reaches the end, so rows that were blocked are rechecked next lap.
      cursors[kind] = !page.length || (page.length < (options.page ?? 200) && last === page.at(-1)!.cursor) ? null : last;
    }
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message.slice(0, 200) : "unknown";
  } finally {
    await control(db).updateOne({ _id: END_OF_LIFE_CONTROL, lease_owner: owner },
      { $set: { cursors, lease_owner: null, lease_until: null, last_run: { at: now, ...run } } });
    logger.info({ msg: "granot_history.end_of_life.run", ...run });
  }
  return run;
}
