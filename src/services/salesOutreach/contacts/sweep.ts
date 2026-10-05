import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { OUTREACH_CONTACT_CALLS_SCOPE, OUTREACH_CONTACT_SMS_SCOPE } from "../../../config/domain/salesOutreachContacts";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { getRingCentralRepSmsEvidenceModel } from "../../../models/salesOutreach/repSmsEvidence";
import { MongoLeaseStore } from "../../durableWork/leases";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../../numberActivity/reconcileCallLog";
import { salesOutreachConfigurationLoader, type ActiveConfiguration, type ConfigurationLoader } from "../config/load";
import { addDays } from "../engine/calendar";
import { OutreachError } from "../errors";
import { newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
import { applyContactSources, repDayKeyOf, type ContactEventStore, type RepDayKey } from "./apply";
import { publishGoalChangesSafely, type OutreachGoalChange, type OutreachGoalPublisher } from "./goalPublish";
import { wantsContactEvidence } from "./jobs";
import { mongoContactEventStore } from "./mongoStore";
import { mongoRepDayStore, recountRepDay, type RepDayStore } from "./repDayService";

/**
 * The minute sweep — the net under the queued `outreach_contact_change` wake (IMPLEMENTATION-PLAN §6.2):
 * walks `call_interactions` (and `ringcentral_rep_sms_evidence`) by a durable `(updatedAt, _id)` cursor
 * in `sales_intelligence_sync_state`, derives each page inline in one transaction with the cursor, and
 * recounts every rep-day the pages moved. Derivation is idempotent (fingerprints), so overlapping with
 * the queued consumer only costs reads.
 *
 * - `updatedAt` is stamped before a capture transaction commits, so each pass first re-scans a short
 *   overlap behind the cursor (bounded).
 * - First pass (no cursor): starts at the New York start of `today − transition.backfill_lookback_days`
 *   (persisted configuration; 0 when unset), recorded as `coverage_from`. Calls started earlier are
 *   outside the derived evidence and their days read as `unknown`, never as zero.
 * - Derivation watermark (calls): when a pass catches up (a short page), the Call Log capture
 *   `known_complete_through` read at the start of that pass is stored as this scope's
 *   `known_complete_through`: every call capture knew of then has its contact event. Rep-day coverage
 *   is the minimum of the two watermarks (S1's open question on a projection watermark).
 * - Single runner per scope (lease in the scope row); fails closed without an active configuration
 *   that wants contact evidence (cursor unmoved, nothing lost).
 */

export const CONTACT_SWEEP_PAGE = 200;
export const CONTACT_SWEEP_OVERLAP_MS = 120_000;
const OVERLAP_LIMIT = 500;
const ZERO_ID = "000000000000000000000000";

export type SweepKind = "call" | "sms";
export type SweepCursor = Readonly<{ updated_at: Date; id: string }>;
export type SweepState = Readonly<{ cursor: SweepCursor | null; coverage_from: Date | null }>;

export type SweepStore = {
  readState(kind: SweepKind, session: ClientSession): Promise<SweepState>;
  writeState(kind: SweepKind, update: { cursor: SweepCursor; coverage_from?: Date; known_complete_through?: Date | null }, session: ClientSession): Promise<void>;
  /** Source ids strictly after the cursor, oldest first. */
  sourcesAfter(kind: SweepKind, cursor: SweepCursor, limit: number, session: ClientSession): Promise<Array<{ id: string; updated_at: Date }>>;
  /** Source ids in `(cursor − overlap, cursor]`. */
  sourcesInOverlap(kind: SweepKind, cursor: SweepCursor, overlapMs: number, limit: number, session: ClientSession): Promise<string[]>;
  captureKnownCompleteThrough(): Promise<Date | null>;
};

const scopeOf = (kind: SweepKind) => (kind === "call" ? OUTREACH_CONTACT_CALLS_SCOPE : OUTREACH_CONTACT_SMS_SCOPE);
const modelOf = (kind: SweepKind) => (kind === "call" ? getCallInteractionModel() : getRingCentralRepSmsEvidenceModel());
const oid = (id: string) => new mongoose.Types.ObjectId(id);

export const mongoSweepStore: SweepStore = {
  async readState(kind, session) {
    const row = (await getSalesIntelligenceSyncStateModel().findOne({ scope: scopeOf(kind) }, { cursor: 1 }).session(session).lean()) as {
      cursor?: { outreach_source_updated_at?: Date | null; outreach_source_id?: unknown; outreach_coverage_from?: Date | null };
    } | null;
    const cursor = row?.cursor;
    return {
      cursor: cursor?.outreach_source_updated_at ? { updated_at: cursor.outreach_source_updated_at, id: String(cursor.outreach_source_id ?? ZERO_ID) } : null,
      coverage_from: cursor?.outreach_coverage_from ?? null,
    };
  },
  async writeState(kind, update, session) {
    const set: Record<string, unknown> = {
      "cursor.outreach_source_updated_at": update.cursor.updated_at,
      "cursor.outreach_source_id": oid(update.cursor.id),
    };
    if (update.coverage_from) set["cursor.outreach_coverage_from"] = update.coverage_from;
    if (update.known_complete_through) set.known_complete_through = update.known_complete_through;
    await getSalesIntelligenceSyncStateModel().updateOne({ scope: scopeOf(kind) }, { $set: set }, { session, upsert: true });
  },
  async sourcesAfter(kind, cursor, limit, session) {
    const rows = (await (modelOf(kind) as unknown as mongoose.Model<unknown>)
      .find({ $or: [{ updatedAt: { $gt: cursor.updated_at } }, { updatedAt: cursor.updated_at, _id: { $gt: oid(cursor.id) } }] }, { _id: 1, updatedAt: 1 })
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit)
      .session(session)
      .lean()) as unknown as Array<{ _id: unknown; updatedAt: Date }>;
    return rows.map((row) => ({ id: String(row._id), updated_at: row.updatedAt }));
  },
  async sourcesInOverlap(kind, cursor, overlapMs, limit, session) {
    const rows = (await (modelOf(kind) as unknown as mongoose.Model<unknown>)
      .find({ updatedAt: { $gt: new Date(cursor.updated_at.getTime() - overlapMs), $lte: cursor.updated_at } }, { _id: 1 })
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit)
      .session(session)
      .lean()) as unknown as Array<{ _id: unknown }>;
    return rows.map((row) => String(row._id));
  },
  async captureKnownCompleteThrough() {
    const row = (await getSalesIntelligenceSyncStateModel().findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, { known_complete_through: 1 }).lean()) as {
      known_complete_through?: Date | null;
    } | null;
    return row?.known_complete_through ?? null;
  },
};

export type SweepLease = { acquire(): Promise<boolean>; release(): Promise<void> };

function mongoSweepLease(kind: SweepKind, now: Date): SweepLease {
  const leases = new MongoLeaseStore(getSalesIntelligenceSyncStateModel());
  let token: Awaited<ReturnType<MongoLeaseStore["acquire"]>> = null;
  return {
    async acquire() {
      token = await leases.acquire({ scope: scopeOf(kind), owner: `sod-contact-sweep:${randomUUID()}`, now, ttl_ms: 120_000 });
      return token !== null;
    },
    async release() {
      if (token) await leases.release({ token, now: new Date() });
    },
  };
}

export type SweepDeps = {
  loader?: ConfigurationLoader;
  store?: SweepStore;
  events?: ContactEventStore;
  repDays?: RepDayStore;
  lease?: SweepLease;
  transaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  /** `outreach_goal` live hint after rep-day writes commit (seam until S1 phase 4b). */
  publishGoal?: OutreachGoalPublisher;
  /** Wall-clock budget of one pass (ms). */
  budgetMs?: number;
  clock?: () => number;
};

export type SweepResult = Readonly<{
  skipped: boolean;
  reason: string | null;
  pages: number;
  derived: number;
  changed: number;
  caught_up: boolean;
  rep_days_recounted: number;
  rep_day_failures: number;
}>;

const skipped = (reason: string): SweepResult => ({ skipped: true, reason, pages: 0, derived: 0, changed: 0, caught_up: false, rep_days_recounted: 0, rep_day_failures: 0 });

/** Bootstrap start: New York midnight of `today − backfill_lookback_days` (0 when unset). */
export function sweepBootstrapStart(configuration: ActiveConfiguration, now: Date): Date {
  const lookback = configuration.value.transition.backfill_lookback_days ?? 0;
  return newYorkDayBounds(addDays(newYorkBusinessDay(now), -lookback)).start;
}

/** Recounts each dirty rep-day in its own transaction (a failure is logged; the refresh pass retries). */
export async function recountRepDays(
  keys: readonly RepDayKey[],
  loader: ConfigurationLoader,
  now: Date,
  store: RepDayStore,
  transaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>,
  publishGoal?: OutreachGoalPublisher,
): Promise<{ recounted: number; failures: number }> {
  let recounted = 0;
  let failures = 0;
  const published: OutreachGoalChange[] = [];
  for (const key of keys) {
    try {
      const result = await transaction(async (session) => {
        const configuration = await loader.requireActive(session);
        if (!wantsContactEvidence(configuration)) throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "controls", code: "disabled" }]);
        return recountRepDay(key, configuration, now, store, session);
      });
      if (result.outcome === "written" && result.publication_revision !== null)
        published.push({ agent_id: key.agent_id, business_day: key.business_day, publication_revision: result.publication_revision });
      recounted++;
    } catch (error) {
      failures++;
      logger.warn({ msg: "sales_outreach.rep_day.recount_failed", errorName: error instanceof Error ? error.name : "Error" });
    }
  }
  await publishGoalChangesSafely(published, publishGoal);
  return { recounted, failures };
}

export async function sweepContactSources(kind: SweepKind, now = new Date(), deps: SweepDeps = {}): Promise<SweepResult> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const inspected = await loader.inspect();
  if (inspected.state !== "active") return skipped(`configuration_${inspected.state}`);
  if (!wantsContactEvidence(inspected)) return skipped("desk_and_goal_metrics_disabled");
  const lease = deps.lease ?? mongoSweepLease(kind, now);
  if (!(await lease.acquire())) return skipped("lease_held");
  const store = deps.store ?? mongoSweepStore;
  const transaction = deps.transaction ?? withTransaction;
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + (deps.budgetMs ?? 25_000);
  const dirty = new Map<string, RepDayKey>();
  let pages = 0;
  let derived = 0;
  let changed = 0;
  let caughtUp = false;
  try {
    const captureThrough = kind === "call" ? await store.captureKnownCompleteThrough() : null;
    while (!caughtUp && clock() < deadline) {
      const firstPage = pages === 0;
      const page = await transaction(async (session) => {
        const current = await loader.requireActive(session);
        if (current.revision !== inspected.revision || current.version !== inspected.version || !wantsContactEvidence(current))
          throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "configuration", code: "revision_changed" }]);
        const state = await store.readState(kind, session);
        const bootstrap = state.cursor ? null : sweepBootstrapStart(current, now);
        const cursor = state.cursor ?? { updated_at: bootstrap!, id: ZERO_ID };
        const overlap = firstPage && state.cursor ? await store.sourcesInOverlap(kind, cursor, CONTACT_SWEEP_OVERLAP_MS, OVERLAP_LIMIT, session) : [];
        const rows = await store.sourcesAfter(kind, cursor, CONTACT_SWEEP_PAGE, session);
        const ids = [...new Set([...overlap, ...rows.map((row) => row.id)])];
        const result = await applyContactSources(
          ids.map((source_id) => ({ source_kind: kind, source_id })),
          { now, queueRepDays: false },
          deps.events ?? mongoContactEventStore,
          session,
        );
        const short = rows.length < CONTACT_SWEEP_PAGE;
        const last = rows.at(-1);
        await store.writeState(
          kind,
          {
            cursor: last ? { updated_at: last.updated_at, id: last.id } : cursor,
            ...(bootstrap ? { coverage_from: bootstrap } : {}),
            ...(short && kind === "call" ? { known_complete_through: captureThrough } : {}),
          },
          session,
        );
        return { result, short };
      });
      pages++;
      derived += page.result.derived;
      changed += page.result.changed;
      for (const key of page.result.rep_days) dirty.set(repDayKeyOf(key), key);
      caughtUp = page.short;
    }
  } finally {
    await lease.release();
  }
  const recount = await recountRepDays([...dirty.values()], loader, now, deps.repDays ?? mongoRepDayStore, transaction, deps.publishGoal);
  return {
    skipped: false,
    reason: null,
    pages,
    derived,
    changed,
    caught_up: caughtUp,
    rep_days_recounted: recount.recounted,
    rep_day_failures: recount.failures,
  };
}

/**
 * Refresh pass (every minute): recounts today's and yesterday's existing rep-day rows whose coverage
 * is not complete yet, or whose past-day goal is not frozen yet — so coverage catches up and each day
 * freezes its goal after midnight even without new calls. Bounded by the roster.
 */
export async function refreshOpenRepDays(now = new Date(), deps: SweepDeps = {}): Promise<{ skipped: boolean; reason: string | null; recounted: number; failures: number }> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const inspected = await loader.inspect();
  if (inspected.state !== "active") return { skipped: true, reason: `configuration_${inspected.state}`, recounted: 0, failures: 0 };
  if (!wantsContactEvidence(inspected)) return { skipped: true, reason: "desk_and_goal_metrics_disabled", recounted: 0, failures: 0 };
  const store = deps.repDays ?? mongoRepDayStore;
  const today = newYorkBusinessDay(now);
  const keys: RepDayKey[] = [];
  for (const day of [addDays(today, -1), today]) {
    for (const row of await store.rowsOfDay(day)) {
      if (row.coverage_state !== "complete" || (day < today && !row.frozen)) keys.push({ agent_id: row.agent_id, business_day: day });
    }
  }
  const result = await recountRepDays(keys, loader, now, store, deps.transaction ?? withTransaction, deps.publishGoal);
  return { skipped: false, reason: null, ...result };
}
