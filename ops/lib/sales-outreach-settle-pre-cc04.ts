/**
 * Outreach lifecycle repair C3 (OPS-1): settle the Call Log rows captured before CC-04.
 *
 * CC-04 (`c54f10ae`, committed 2026-09-24T01:28:03Z) started stamping `call_interactions.call_log_state`
 * on every Call Log read. Rows the Call Log had already read before it keep `call_log_state: null`, so
 * `derive.ts` (`confirmed = terminal && call_log_state !== null`) leaves their contact events at
 * `awaiting_confirmation` forever (2026-09-22/23: 748 events). This module settles them:
 *
 * - candidates: `call_log_state: null`, `terminal`, not merged, not purged, `Inbound`/`Outbound`, at
 *   least one Call Log id, `started_at < CC04_INSTANT`. The `Internal` null rows stay null: CC-04 keeps
 *   the "pre-CC-04 Internal snapshot may still be corrected" door open;
 * - the write (driver collection, not the strict model): `$set {call_log_state: "settled", updatedAt}`
 *   and `$inc {projection_revision: 1}` — a state change alone is a projection revision (CC-04), so the
 *   derived `source_revision` and fingerprint move and the minute contact sweep's `(updatedAt, _id)`
 *   cursor re-derives each row (awaiting → confirmed) and recounts the dirty rep-days;
 * - batches of `SETTLE_BATCH` by `_id`, each batch read and written in one transaction together with
 *   one `appendCsiAudit` row (`kind: interaction`, `event_kind: call_interactions_settled_pre_cc04`,
 *   the batch's ids) under the caller's operator actor, so the audited id set is the rollback set;
 * - idempotent: a second run matches 0 and writes nothing.
 *
 * Pure parts (argument parsing, filters, the summary) are unit-tested; the Mongo parts are proven on
 * the replica (`ops/sales-outreach/contact-events.replica.ts`).
 */
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../src/db";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getSalesOutreachContactEventModel } from "../../src/models/salesOutreach";
import type { CsiActor } from "../../src/services/salesIntelligence/auth";
import { appendCsiAudit } from "../../src/services/salesIntelligence/transactions";
import { newYorkBusinessDay } from "../../src/services/salesOutreach/reads/businessDay";

/** CC-04 commit instant (`c54f10ae`, 2026-09-23 21:28:03 −0400): every null row before it predates the stamp. */
export const CC04_INSTANT = new Date("2026-09-24T01:28:03Z");
export const SETTLE_BATCH = 500;
/** 1,358 rows expected; the cap only stops a runaway loop (100 × 500 = 50,000 rows). */
export const SETTLE_MAX_BATCHES = 100;
export const SETTLE_EVENT_KIND = "call_interactions_settled_pre_cc04";
export const SETTLE_SUBJECT_KEY = "operator:settle-pre-cc04";
export const SETTLE_VERSION = "settle-pre-cc04-v1";
export const SETTLE_DIRECTIONS = ["Inbound", "Outbound"] as const;
const ALLOW_SCHEMA_DRIFT = "--allow-schema-drift";
const SAMPLE = 20;

export type SettleDirection = (typeof SETTLE_DIRECTIONS)[number];

/**
 *   --target=<database>      required; must equal the database this process resolves
 *   --apply                  write (default: dry run, read-only)
 *   --out=<file.json>        also write the candidate ids (dry run) or the settled ids (apply)
 *   --allow-schema-drift     passed through to the production-writer guard
 */
export type SettleCliArgs = Readonly<{ target: string; apply: boolean; out: string | null }>;

export function parseSettleArgs(argv: readonly string[]): SettleCliArgs {
  let target: string | null = null;
  let apply = false;
  let out: string | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length).trim();
    else if (arg === ALLOW_SCHEMA_DRIFT) continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  if (out !== null && !out) throw new Error("--out=<file.json> needs a path");
  return { target, apply, out };
}

const uncorrected = {
  call_log_state: null,
  terminal: true,
  merged_into_id: null,
  purged_at: null,
  "call_log_ids.0": { $exists: true },
} as const;

/** The rows this script settles (served by `call_interaction_call_log_state_started`). */
export function settleFilter(before: Date = CC04_INSTANT) {
  return { ...uncorrected, direction: { $in: [...SETTLE_DIRECTIONS] }, started_at: { $lt: before } };
}

/** The same shape at or after CC-04, any direction: CC-04 stamps every Call Log read, so expected 0. Never written. */
export function anomalyFilter(before: Date = CC04_INSTANT) {
  return { ...uncorrected, started_at: { $gte: before } };
}

/** `Internal` rows still null (left alone on purpose); reported for the acceptance check. */
export function internalLeftFilter() {
  return { call_log_state: null, direction: "Internal" };
}

export type SettleCandidate = Readonly<{ id: string; started_at: Date; direction: SettleDirection }>;
export type SettleEventFact = Readonly<{ source_id: string; business_date: string; goal_credit: string }>;
type DirectionCounts = { Inbound: number; Outbound: number; total: number };

export type SettleSummary = Readonly<{
  version: typeof SETTLE_VERSION;
  cc04_instant: string;
  candidates: number;
  /** New York day of `started_at` → counts by direction. */
  by_day: Record<string, DirectionCounts>;
  by_direction: DirectionCounts;
  /** The candidates' existing contact events (lookup by `source_id`). */
  contact_events: Readonly<{
    total: number;
    without_event: number;
    by_goal_credit: Record<string, number>;
    by_day: Record<string, Record<string, number>>;
  }>;
  anomalies: Readonly<{ count: number; sample_ids: string[] }>;
  internal_left: number;
}>;

const sorted = <T>(record: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

export function countByDay(candidates: readonly SettleCandidate[]): Record<string, DirectionCounts> {
  const byDay: Record<string, DirectionCounts> = {};
  for (const row of candidates) {
    const day = (byDay[newYorkBusinessDay(row.started_at)] ??= { Inbound: 0, Outbound: 0, total: 0 });
    day[row.direction]++;
    day.total++;
  }
  return sorted(byDay);
}

export function summarizeSettle(input: {
  candidates: readonly SettleCandidate[];
  events: readonly SettleEventFact[];
  anomaly_ids: readonly string[];
  internal_left: number;
}): SettleSummary {
  const byDirection: DirectionCounts = { Inbound: 0, Outbound: 0, total: 0 };
  for (const row of input.candidates) {
    byDirection[row.direction]++;
    byDirection.total++;
  }
  const candidateIds = new Set(input.candidates.map((row) => row.id));
  const withEvent = new Set<string>();
  const byCredit: Record<string, number> = {};
  const byEventDay: Record<string, Record<string, number>> = {};
  for (const event of input.events) {
    if (!candidateIds.has(event.source_id)) continue;
    withEvent.add(event.source_id);
    byCredit[event.goal_credit] = (byCredit[event.goal_credit] ?? 0) + 1;
    const day = (byEventDay[event.business_date] ??= {});
    day[event.goal_credit] = (day[event.goal_credit] ?? 0) + 1;
  }
  return {
    version: SETTLE_VERSION,
    cc04_instant: CC04_INSTANT.toISOString(),
    candidates: input.candidates.length,
    by_day: countByDay(input.candidates),
    by_direction: byDirection,
    contact_events: {
      total: withEvent.size,
      without_event: input.candidates.length - withEvent.size,
      by_goal_credit: sorted(byCredit),
      by_day: Object.fromEntries(Object.entries(sorted(byEventDay)).map(([day, counts]) => [day, sorted(counts)])),
    },
    anomalies: { count: input.anomaly_ids.length, sample_ids: [...input.anomaly_ids].sort().slice(0, SAMPLE) },
    internal_left: input.internal_left,
  };
}

// --- Mongo ----------------------------------------------------------------------------------------

type CandidateDoc = { _id: mongoose.Types.ObjectId; started_at: Date; direction: SettleDirection };
const CANDIDATE_PROJECTION = { _id: 1, started_at: 1, direction: 1 } as const;
/** The driver collection: the write bypasses the strict model (and its automatic `updatedAt`). */
function callsCollection() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("settle-pre-cc04: Mongo is not connected");
  return db.collection(getCallInteractionModel().collection.collectionName);
}
const toCandidate = (doc: CandidateDoc): SettleCandidate => ({ id: String(doc._id), started_at: doc.started_at, direction: doc.direction });

/** Dry run: candidates, their contact events, anomalies and the Internal rows left. Reads only. */
export async function reportSettle(): Promise<{ summary: SettleSummary; ids: string[] }> {
  const calls = callsCollection();
  const docs = (await calls.find(settleFilter(), { projection: CANDIDATE_PROJECTION }).sort({ _id: 1 }).toArray()) as unknown as CandidateDoc[];
  const candidates = docs.map(toCandidate);
  const events: SettleEventFact[] = [];
  const Events = getSalesOutreachContactEventModel();
  for (let i = 0; i < docs.length; i += SETTLE_BATCH) {
    const rows = (await Events.find(
      { source_kind: "call", source_id: { $in: docs.slice(i, i + SETTLE_BATCH).map((doc) => doc._id) } },
      { source_id: 1, business_date: 1, goal_credit: 1 },
    ).lean()) as unknown as Array<{ source_id: unknown; business_date: string; goal_credit: string }>;
    for (const row of rows) events.push({ source_id: String(row.source_id), business_date: row.business_date, goal_credit: row.goal_credit });
  }
  const anomalies = (await calls.find(anomalyFilter(), { projection: { _id: 1 } }).sort({ _id: 1 }).limit(1000).toArray()).map((doc) => String(doc._id));
  const internalLeft = await calls.countDocuments(internalLeftFilter());
  return { summary: summarizeSettle({ candidates, events, anomaly_ids: anomalies, internal_left: internalLeft }), ids: candidates.map((row) => row.id) };
}

export type SettleApplyResult = Readonly<{
  run_id: string;
  settled: number;
  batches: number;
  by_day: Record<string, DirectionCounts>;
  ids: string[];
}>;

export type SettleApplyDeps = Readonly<{
  transaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  now?: () => Date;
  batch?: number;
}>;

/**
 * Settles every candidate in `_id` batches. Each batch is read and written in one transaction with its
 * audit row; the update re-applies the filter, so a row a concurrent capture already settled is skipped.
 * Callers must have passed the target check and the production-writer guard.
 */
export async function applySettle(input: { actor: CsiActor; run_id: string }, deps: SettleApplyDeps = {}): Promise<SettleApplyResult> {
  const transaction = deps.transaction ?? withTransaction;
  const now = deps.now ?? (() => new Date());
  const size = deps.batch ?? SETTLE_BATCH;
  const calls = callsCollection();
  const ids: string[] = [];
  const settledRows: SettleCandidate[] = [];
  let batches = 0;
  for (;;) {
    if (batches >= SETTLE_MAX_BATCHES) throw new Error(`settle stopped after ${SETTLE_MAX_BATCHES} batches; re-run to continue`);
    const batch = await transaction(async (session) => {
      const docs = (await calls
        .find(settleFilter(), { projection: CANDIDATE_PROJECTION, session })
        .sort({ _id: 1 })
        .limit(size)
        .toArray()) as unknown as CandidateDoc[];
      if (!docs.length) return null;
      const at = now();
      const rows = docs.map(toCandidate);
      const result = await calls.updateMany(
        { _id: { $in: docs.map((doc) => doc._id) }, ...settleFilter() },
        { $set: { call_log_state: "settled", updatedAt: at }, $inc: { projection_revision: 1 } },
        { session },
      );
      if (result.modifiedCount !== docs.length) throw new Error(`settle batch changed ${result.modifiedCount} of ${docs.length} rows read in the same transaction`);
      await appendCsiAudit(
        { session, command_id: new mongoose.Types.ObjectId(), now: at, actor: input.actor },
        {
          subject_key: SETTLE_SUBJECT_KEY,
          event_kind: SETTLE_EVENT_KIND,
          kind: "interaction",
          target_id: input.run_id,
          revision: batches + 1,
          prior: { call_log_state: null, count: rows.length },
          current: { call_log_state: "settled", count: rows.length, by_day: countByDay(rows), ids: rows.map((row) => row.id) },
        },
      );
      return rows;
    });
    if (!batch) break;
    batches++;
    settledRows.push(...batch);
    ids.push(...batch.map((row) => row.id));
  }
  return { run_id: input.run_id, settled: ids.length, batches, by_day: countByDay(settledRows), ids };
}
