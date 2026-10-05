import { createHash, randomBytes } from "node:crypto";
import { logger } from "../../logger";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore } from "../durableWork/leases";
import type { LeaseToken } from "../durableWork/types";
import { minuteOfDay } from "../salesOutreach/engine/calendar";
import { wakeOutreachForTouchedCalls } from "../salesOutreach/capture/contactChangeWake";
import { configuredRingCentralAccountId } from "./accountIdentity";
import { createCallLogApplier, emptyBatchCounts, type TouchedInteraction } from "./callLogApplier";
import { fetchCallLogSync, type CallLogSyncFetcher } from "./callLogClient";
import {
  DEFAULT_QUARANTINE_LIMITS,
  QuarantineBook,
  type QuarantinedRecord,
  type RecordFailure,
} from "./callLogQuarantine";
import {
  CALL_LOG_SYNC_TOKEN_MAX_AGE_MS,
  runCallLogSyncStep,
  type StoredCallLogSync,
  type SyncStepErrorCode,
} from "./callLogSyncDriver";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import { applyInteractionObservation } from "./persistInteraction";
import {
  CALL_LOG_ALL_DIRECTIONS_SCOPE,
  callLogReconcileConfig,
  syncStateLeaseModel,
  type ReconcileConfig,
} from "./reconcileCallLog";
import type { RouteResolver } from "./types";

/**
 * Staffed-hours minute Call Log ISync lane (RINGCENTRAL-CAPTURE §4.2, decision IMPL-06).
 *
 * A webhook shows a call at once as "awaiting confirmation"; credit needs the call present in the
 * Call Log. This lane confirms calls within about a minute of the provider publishing them: every
 * minute while New York time is in [07:45, 20:30) it sends **one** account Call Log Sync ISync with
 * the stored token (Heavy group, high lane, short gate wait) and follows further pages only while a
 * page comes back full. Records go through the reconcile's own applier (per-row skip, quarantine),
 * and the desk is woken for the rows each batch changed.
 *
 * It shares the reconcile's state and lease (`sales_intelligence_sync_state`, scope
 * `call_log_all_directions`): the token chain, the quarantine and the lease are one, so the lane and
 * the 5-minute window reconcile never apply the same chain twice. The 5-minute reconcile keeps its
 * own sync step unchanged; on its minutes (UTC minute ≡ 3 mod 5) and outside staffed hours it is the
 * one that carries ISync, and the lane yields. The lane never bootstraps a missing token (FSync
 * belongs to the reconcile, which owns the window and `known_complete_through`); an expired token
 * met mid-run falls back to FSync inside the page budget exactly like the reconcile.
 *
 * It runs only when Call Log capture is on (`SALES_INTELLIGENCE_CAPTURE_CALL_LOG`) and Call Log
 * Sync drives (`SALES_INTELLIGENCE_CALL_LOG_SYNC=on`); `shadow` only counts and stays with the
 * reconcile. No new environment flag.
 */
export const ISYNC_LANE_TIMEZONE = "America/New_York";
/** [07:45, 20:30) New York — RINGCENTRAL-CAPTURE §4.2 / §7 capture window (not desk policy). */
export const ISYNC_LANE_START_MINUTE = 7 * 60 + 45;
export const ISYNC_LANE_END_MINUTE = 20 * 60 + 30;
/** The 5-minute reconcile's cron is `3-59/5`; on those minutes it carries ISync itself. */
export const RECONCILE_CRON_MINUTE_MOD5 = 3;
/** Requests one lane run may send (one ISync, plus follow pages while full, or an FSync fallback). */
export const ISYNC_LANE_PAGE_BUDGET = 3;
/** Longest wait for a Heavy slot before the lane yields to the next minute. */
export const ISYNC_LANE_GATE_WAIT_MS = 10_000;
/** The lane's lease is short; a stuck run frees the reconcile within a minute. */
export const ISYNC_LANE_LEASE_TTL_MS = 60_000;
export const ISYNC_LANE_OWNER_PREFIX = "csi-call-log-isync:";

export type IsyncLaneSkipReason =
  | "disabled"
  | "sync_not_on"
  | "outside_staffed_hours"
  | "reconcile_minute"
  | "lease_held"
  | "token_missing";

/** Pure: whether this minute belongs to the lane. DST-safe (New York wall clock through `Intl`). */
export function isyncLaneMinute(now: Date): { run: true } | { run: false; reason: "outside_staffed_hours" | "reconcile_minute" } {
  const minute = minuteOfDay(now.getTime(), ISYNC_LANE_TIMEZONE);
  if (minute < ISYNC_LANE_START_MINUTE || minute >= ISYNC_LANE_END_MINUTE) return { run: false, reason: "outside_staffed_hours" };
  if (now.getUTCMinutes() % 5 === RECONCILE_CRON_MINUTE_MOD5) return { run: false, reason: "reconcile_minute" };
  return { run: true };
}

/** Pure: whether a stored token can drive an ISync now (the lane never bootstraps one). */
export function storedTokenUsable(state: StoredCallLogSync | undefined, now: Date): boolean {
  if (!state?.token || !state.sync_time) return false;
  return now.getTime() - state.sync_time.getTime() <= CALL_LOG_SYNC_TOKEN_MAX_AGE_MS;
}

export type IsyncLaneState = {
  call_log_sync?: StoredCallLogSync;
  quarantined_records?: QuarantinedRecord[] | null;
  record_failures?: RecordFailure[] | null;
};

export type IsyncLaneWrite = {
  call_log_sync: NonNullable<StoredCallLogSync> | null;
  quarantined_records: QuarantinedRecord[];
  record_failures: RecordFailure[];
  isync_lane: {
    last_run_at: Date;
    last_success_at: Date | null;
    last_error_code: string | null;
    last_records: number;
    last_applied: number;
  };
};

/** State + lease seam; the default is the reconcile's Mongo document and lease. */
export type IsyncLaneStore = {
  acquire(owner: string, ttlMs: number, now: Date): Promise<LeaseToken | null>;
  renew(token: LeaseToken, ttlMs: number, now: Date): Promise<LeaseToken | null>;
  load(): Promise<IsyncLaneState>;
  /** Fenced write that also releases the lease; false when the lease was lost. */
  write(token: LeaseToken, update: IsyncLaneWrite, now: Date): Promise<boolean>;
  release(token: LeaseToken, now: Date): Promise<void>;
};

export function mongoIsyncLaneStore(): IsyncLaneStore {
  const leases = new MongoLeaseStore(syncStateLeaseModel());
  const Model = getSalesIntelligenceSyncStateModel;
  return {
    acquire: (owner, ttlMs, now) => leases.acquire({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE, owner, ttl_ms: ttlMs, now }),
    renew: (token, ttlMs, now) => leases.renew({ token, ttl_ms: ttlMs, now }),
    load: async () =>
      ((await Model().findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }).lean()) ?? {}) as IsyncLaneState,
    write: async (token, update, now) => {
      const written = await Model().updateOne(
        { scope: CALL_LOG_ALL_DIRECTIONS_SCOPE, lease_owner: token.owner, lease_epoch: token.epoch, leased_until: { $gt: now } },
        {
          $set: {
            ...(update.call_log_sync ? { call_log_sync: update.call_log_sync } : {}),
            quarantined_records: update.quarantined_records,
            record_failures: update.record_failures,
            isync_lane: update.isync_lane,
            lease_owner: null,
            leased_until: now,
          },
        },
      );
      return written.modifiedCount === 1;
    },
    release: async (token, now) => {
      await leases.release({ token, now });
    },
  };
}

export type IsyncLaneSummary = {
  ran_at: string;
  skipped: boolean;
  skip_reason: IsyncLaneSkipReason | null;
  sync_type: "FSync" | "ISync" | null;
  requests: number;
  records: number;
  changed: number;
  applied: number;
  failures: number;
  quarantined: number;
  token_stored: boolean;
  expired: boolean;
  woken: number;
  error_code: SyncStepErrorCode | "lease_lost" | "state_write_failed" | null;
  runtime_ms: number;
};

export type IsyncLaneDeps = {
  now: () => Date;
  flagOn: () => boolean;
  config: Pick<ReconcileConfig, "syncMode" | "perPage" | "settleHorizonMinutes" | "quarantineAfter">;
  fetchSync: CallLogSyncFetcher;
  apply: typeof applyInteractionObservation;
  directory: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  unchanged?: Parameters<typeof createCallLogApplier>[0]["unchanged"];
  configuredAccountId: string | null;
  owner: string;
  store: IsyncLaneStore;
  wake: (touched: TouchedInteraction[]) => Promise<unknown>;
};

export async function runCallLogIsyncLaneOnce(overrides: Partial<IsyncLaneDeps> = {}): Promise<IsyncLaneSummary> {
  const deps: IsyncLaneDeps = {
    now: () => new Date(),
    flagOn: () => csiFlag("CAPTURE_CALL_LOG"),
    config: overrides.config ?? callLogReconcileConfig(),
    fetchSync: (input) => fetchCallLogSync(input, { priority: "high", maxWaitMs: ISYNC_LANE_GATE_WAIT_MS }),
    apply: applyInteractionObservation,
    directory: loadDirectoryLookup,
    configuredAccountId: overrides.configuredAccountId === undefined ? configuredRingCentralAccountId() : overrides.configuredAccountId,
    owner: `${ISYNC_LANE_OWNER_PREFIX}${randomBytes(8).toString("hex")}`,
    store: overrides.store ?? mongoIsyncLaneStore(),
    wake: wakeOutreachForTouchedCalls,
    ...overrides,
  };
  const startedAt = deps.now();
  const summary: IsyncLaneSummary = {
    ran_at: startedAt.toISOString(),
    skipped: false,
    skip_reason: null,
    sync_type: null,
    requests: 0,
    records: 0,
    changed: 0,
    applied: 0,
    failures: 0,
    quarantined: 0,
    token_stored: false,
    expired: false,
    woken: 0,
    error_code: null,
    runtime_ms: 0,
  };
  const skip = (reason: IsyncLaneSkipReason) => {
    summary.skipped = true;
    summary.skip_reason = reason;
    summary.runtime_ms = Math.max(0, deps.now().getTime() - startedAt.getTime());
    return summary;
  };
  if (!deps.flagOn()) return skip("disabled");
  if (deps.config.syncMode !== "on") return skip("sync_not_on");
  const minute = isyncLaneMinute(startedAt);
  if (!minute.run) return skip(minute.reason);

  const token = await deps.store.acquire(deps.owner, ISYNC_LANE_LEASE_TTL_MS, startedAt);
  if (!token) return skip("lease_held");
  let lease: LeaseToken = token;
  const ownerHash = createHash("sha256").update(deps.owner).digest("hex").slice(0, 12);

  try {
    const state = await deps.store.load();
    if (!storedTokenUsable(state.call_log_sync, startedAt)) {
      // FSync bootstrap belongs to the window reconcile.
      await deps.store.release(lease, deps.now());
      return skip("token_missing");
    }
    const book = new QuarantineBook(state.quarantined_records, state.record_failures, {
      ...DEFAULT_QUARANTINE_LIMITS,
      quarantineAfter: deps.config.quarantineAfter,
      transientQuarantineAfter: deps.config.quarantineAfter * 2,
    });
    const renew = async () => {
      const renewed = await deps.store.renew(lease, ISYNC_LANE_LEASE_TTL_MS, deps.now());
      if (!renewed) throw new IsyncLaneLeaseLost();
      lease = renewed;
    };
    const applier = createCallLogApplier({
      now: deps.now,
      apply: deps.apply,
      directory: deps.directory,
      resolveRoute: deps.resolveRoute,
      configuredAccountId: deps.configuredAccountId,
      settleHorizonMinutes: deps.config.settleHorizonMinutes,
      book,
      // One renewal per batch is enough for a 60-s lease and a handful of records.
      renew: async () => undefined,
      requestId: randomBytes(12).toString("hex"),
      ownerHash,
      logPrefix: "sales_intelligence.call_log_isync_lane",
      unchanged: deps.unchanged,
    });
    const step = await runCallLogSyncStep({
      mode: "on",
      state: state.call_log_sync ?? null,
      now: startedAt,
      fsyncFrom: new Date(startedAt.getTime() - deps.config.settleHorizonMinutes * 60_000),
      recordCount: deps.config.perPage,
      budget: ISYNC_LANE_PAGE_BUDGET,
      fetchSync: deps.fetchSync,
      countChanged: applier.countChanged,
      apply: async (records) => {
        await renew();
        const counts = emptyBatchCounts();
        await applier.applyBatch(records, counts);
        const touched = applier.touched();
        applier.clearTouched();
        if (touched.length) {
          summary.woken += touched.length;
          await deps.wake(touched);
        }
        return { ...counts, changed: records.length - counts.noops, settled: counts.error_code === null };
      },
    });
    Object.assign(summary, {
      sync_type: step.sync_type,
      requests: step.requests,
      records: step.records,
      changed: step.changed,
      applied: step.applied,
      failures: step.failures,
      quarantined: step.quarantined,
      token_stored: step.token_stored,
      expired: step.expired,
      error_code: step.error_code,
    });
    const finishedAt = deps.now();
    const quarantine = book.snapshot();
    const written = await deps.store.write(
      lease,
      {
        call_log_sync: step.next,
        quarantined_records: quarantine.quarantined_records,
        record_failures: quarantine.record_failures,
        isync_lane: {
          last_run_at: startedAt,
          last_success_at: step.token_stored ? finishedAt : null,
          last_error_code: step.error_code,
          last_records: step.records,
          last_applied: step.applied,
        },
      },
      finishedAt,
    );
    if (!written) throw new IsyncLaneLeaseLost();
    summary.runtime_ms = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    logger[step.error_code ? "warn" : "info"]({
      msg: "sales_intelligence.call_log_isync_lane.completed",
      leaseOwnerHash: ownerHash,
      syncType: step.sync_type,
      requests: step.requests,
      records: step.records,
      applied: step.applied,
      failures: step.failures,
      tokenStored: step.token_stored,
      expired: step.expired,
      errorCode: step.error_code,
      runtimeMs: summary.runtime_ms,
    });
    return summary;
  } catch (error) {
    summary.runtime_ms = Math.max(0, deps.now().getTime() - startedAt.getTime());
    if (error instanceof IsyncLaneLeaseLost) {
      summary.error_code = "lease_lost";
      logger.warn({ msg: "sales_intelligence.call_log_isync_lane.lease_lost", leaseOwnerHash: ownerHash });
      return summary;
    }
    summary.error_code = "state_write_failed";
    logger.error({
      msg: "sales_intelligence.call_log_isync_lane.failed",
      leaseOwnerHash: ownerHash,
      errorName: error instanceof Error ? error.name : "Error",
    });
    try {
      await deps.store.release(lease, deps.now());
    } catch {
      /* lease expiry is the recovery path */
    }
    return summary;
  }
}

class IsyncLaneLeaseLost extends Error {
  constructor() {
    super("Call Log ISync lane lease lost");
    this.name = "IsyncLaneLeaseLost";
  }
}
