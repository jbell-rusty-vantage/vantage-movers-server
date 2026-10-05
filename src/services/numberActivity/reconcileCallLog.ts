import { createHash, randomBytes } from "node:crypto";
import { logger } from "../../logger";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore, type MongoLeaseModel } from "../durableWork/leases";
import type { LeaseToken } from "../durableWork/types";
import {
  accountIdFromProviderPath,
  configuredRingCentralAccountId,
  ProviderAccountError,
  resolveProviderAccountId,
} from "./accountIdentity";
import {
  fetchCallLogSync,
  fetchDetailedCallLogPage,
  fetchDetailedCallLogRecord,
  isProviderThrottle,
  providerSuppliedRetryAfter,
  throttleRetryAfterMs,
  type CallLogPageFetcher,
  type CallLogRecordFetcher,
  type CallLogSyncFetcher,
} from "./callLogClient";
import { settleProvisionalFromStore } from "./settleProvisional";
import {
  DEFAULT_QUARANTINE_LIMITS,
  failureLogFields,
  isTransientQuarantineCode,
  QuarantineBook,
  type QuarantinedRecord,
  type QuarantineErrorCode,
  type RecordFailure,
} from "./callLogQuarantine";
import {
  parseCallLogSyncMode,
  runCallLogSyncStep,
  type CallLogSyncMode,
  type StoredCallLogSync,
  type SyncStepResult,
} from "./callLogSyncDriver";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import {
  applyInteractionObservation,
  defaultRouteResolver,
  InteractionPersistenceError,
} from "./persistInteraction";
import type { CallLogRecordInput } from "./interactionProjection";
import { getCallInteractionModel } from "../../models/CallInteraction";
import type { RouteResolver } from "./types";
import { RingCentralApiError } from "../ringcentral/client";
import {
  createCallLogApplier,
  emptyBatchCounts,
  startOf,
  str,
  type TouchedInteraction,
} from "./callLogApplier";
import { wakeOutreachForTouchedCalls } from "../salesOutreach/capture/contactChangeWake";

export { unchangedRecords } from "./callLogApplier";

function isProviderPermissionDenied(error: unknown): boolean {
  return error instanceof RingCentralApiError && (error.status === 401 || error.status === 403);
}

/**
 * Authoritative all-direction Detailed Call Log reconciliation.
 *
 * Dedicated CSI cursor (`sales_intelligence_sync_state`, scope
 * `call_log_all_directions`) and fenced five-minute lease. The qualified-call
 * sync (`ringcentral_call_log_sync_state`, `key: "account"`) is untouched.
 *
 * A Call Log record is observed, not final: RingCentral publishes a queue
 * call while it is still ringing out and rewrites the same record when it
 * ends. Every run therefore re-reads a trailing settle horizon, re-reads
 * provisional rows that have left it, and (behind a flag) follows account
 * Call Log Sync, which reports records by modification rather than start.
 *
 * Coverage honesty: the cursor and `known_complete_through` advance only when
 * every page of the rolling window was fetched and every record projected or
 * quarantined. Any interruption (throttle, provider error, page budget,
 * projection failure, account resolution) leaves the cursor where it was and
 * records a bounded gap `{from, to, reason}`. Later runs repair gaps
 * oldest-first with leftover page budget; a gap closes only when its window
 * completes.
 */
export const CALL_LOG_ALL_DIRECTIONS_SCOPE = "call_log_all_directions";

export type ReconcileConfig = {
  rollingLookbackMinutes: number;
  /** Ceiling on how far back the incremental (cursor) part of a window reaches; the rest is gap repair. */
  safetyLookbackMinutes: number;
  overlapMinutes: number;
  maxPages: number;
  perPage: number;
  finalizationLagMinutes: number;
  leaseTtlMs: number;
  /**
   * CC-03: every run re-reads at least this far back, so a record that
   * RingCentral rewrites after its start is fetched again until it has been
   * quiet this long. Must exceed the longest expected call.
   */
  settleHorizonMinutes: number;
  /** CC-01: consecutive failures before a record is quarantined. */
  quarantineAfter: number;
  /** CC-01: targeted re-reads of due quarantined records per run. */
  quarantineRetriesPerRun: number;
  /** Provisional rows older than the horizon re-read by id per run. */
  stragglerReadsPerRun: number;
  /** CC-05: account Call Log Sync driver. */
  syncMode: CallLogSyncMode;
  /** CC-06: nightly sweep reach. */
  sweepLookbackHours: number;
};

export function callLogReconcileConfig(): ReconcileConfig {
  const int = (name: string, fallback: number, min: number) => {
    const raw = process.env[`SALES_INTELLIGENCE_${name}`]?.trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
  };
  return {
    // Cold-start reach and the outer bound on a repaired gap. Same rationale
    // as the qualified-call sync; it is no longer the size of every window.
    rollingLookbackMinutes: Math.max(720, int("CALL_LOG_ROLLING_LOOKBACK_MINUTES", 720, 1)),
    safetyLookbackMinutes: int("CALL_LOG_SAFETY_LOOKBACK_MINUTES", 90, 1),
    overlapMinutes: int("CALL_LOG_OVERLAP_MINUTES", 15, 0),
    maxPages: int("CALL_LOG_MAX_PAGES", 20, 1),
    perPage: 250,
    finalizationLagMinutes: 15,
    leaseTtlMs: 300_000,
    // Floor 60: below that a normal long call would leave the horizon mid-call.
    settleHorizonMinutes: Math.max(60, int("CALL_LOG_SETTLE_HORIZON_MINUTES", 240, 1)),
    quarantineAfter: int("CALL_LOG_QUARANTINE_AFTER", DEFAULT_QUARANTINE_LIMITS.quarantineAfter, 1),
    quarantineRetriesPerRun: int("CALL_LOG_QUARANTINE_RETRIES_PER_RUN", 5, 0),
    stragglerReadsPerRun: 10,
    syncMode: parseCallLogSyncMode(process.env.SALES_INTELLIGENCE_CALL_LOG_SYNC),
    sweepLookbackHours: int("CALL_LOG_SWEEP_LOOKBACK_HOURS", 36, 1),
  };
}

export type ReconcileErrorCode =
  | "provider_throttled"
  | "provider_permission_denied"
  | "provider_request_failed"
  | "page_limit"
  | "projection_failed"
  | "account_unresolved"
  | "account_mismatch"
  | "lease_lost"
  | "state_write_failed"
  | "unknown_error";

export type WindowResult = {
  kind: "rolling" | "gap_repair";
  from: Date;
  to: Date;
  pages: number;
  records: number;
  upserts: number;
  noops: number;
  failures: number;
  /** Records held for their backoff or quarantined by this run; they never make a window incomplete. */
  quarantined: number;
  complete: boolean;
  /** For `page_limit`: records older than this instant were not fetched. */
  incomplete_before: Date | null;
  error_code: ReconcileErrorCode | null;
};

export type ReconcileSyncSummary = Pick<
  SyncStepResult,
  "mode" | "sync_type" | "requests" | "records" | "changed" | "applied" | "failures" | "quarantined" | "expired" | "token_stored" | "error_code"
>;

export type ReconcileSummary = {
  ran_at: string;
  skipped: boolean;
  skip_reason: "disabled" | "lease_held" | null;
  lease_owner_hash: string | null;
  window_from: string | null;
  window_to: string | null;
  windows: WindowResult[];
  pages: number;
  records: number;
  upserts: number;
  noops: number;
  failures: number;
  /** Quarantined records after this run (CC-01). */
  quarantined: number;
  /** By-id re-reads of due quarantined records this run. */
  quarantine_retries: number;
  /** By-id re-reads of provisional rows older than the settle horizon this run. */
  straggler_reads: number;
  /** Provisional rows past the horizon settled from their stored projection this run. */
  settled_from_store: number;
  /** Account Call Log Sync step; null when `SALES_INTELLIGENCE_CALL_LOG_SYNC` is off. */
  sync: ReconcileSyncSummary | null;
  throttled_count: number;
  /** Wait applied after a 429. See `throttle_retry_after_observed` for whether the provider supplied it. */
  throttle_retry_after_ms: number | null;
  /** False when the shared client exposed no Retry-After and the documented default was used. */
  throttle_retry_after_observed: boolean;
  /** 24-hex id stamped as audit actor `request_id` on every row this run wrote. */
  request_id: string | null;
  cursor_advanced: boolean;
  known_complete_through: string | null;
  gaps_after: number;
  error_code: ReconcileErrorCode | null;
  runtime_ms: number;
};

export type ReconcileDependencies = {
  now: () => Date;
  fetchPage: CallLogPageFetcher;
  /** One record by id (quarantine retries and straggler settles). */
  fetchRecord: CallLogRecordFetcher;
  /** Account Call Log Sync (CC-05); used only when `config.syncMode` is not `off`. */
  fetchSync: CallLogSyncFetcher;
  apply: typeof applyInteractionObservation;
  directory: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  configuredAccountId: string | null;
  owner: string;
  config: ReconcileConfig;
  requireFlag: boolean;
  /**
   * RINGCENTRAL-CAPTURE §4.5: wakes the Sales Outreach Desk for the `call_interactions` rows a
   * batch changed, after that batch committed. Best effort; never throws.
   */
  wake: (touched: TouchedInteraction[]) => Promise<unknown>;
  /** How long a run waits for a lease held by a short holder (the minute ISync lane) before skipping. */
  leaseWaitMs: number;
  sleep: (ms: number) => Promise<void>;
};

type StoredGap = { from: Date; to: Date; reason: string; opened_at: Date };
type StoredState = {
  cursor?: {
    last_sync_from?: Date | null;
    last_sync_to?: Date | null;
    provider_modified_watermark?: Date | null;
  } | null;
  known_complete_through?: Date | null;
  gaps?: StoredGap[];
  consecutive_failures?: number;
  quarantined_records?: QuarantinedRecord[] | null;
  record_failures?: RecordFailure[] | null;
  call_log_sync?: StoredCallLogSync;
};

class LeaseLostError extends Error {
  constructor() {
    super("CSI Call Log reconcile lease lost");
    this.name = "LeaseLostError";
  }
}

export function maskOwner(owner: string): string {
  return createHash("sha256").update(owner).digest("hex").slice(0, 12);
}

/** Provisional rows settled from the store per run, and the extra quiet time before the straggler re-read is bypassed. */
const STORE_SETTLES_PER_RUN = 50;
const STORE_SETTLE_GRACE_MINUTES = 60;

/** Quarantine older than this raises `quarantine_stale` (CC-01). */
const QUARANTINE_STALE_MS = 2 * 3_600_000;

type ApplyOutcome =
  | { ok: true; noop: boolean }
  | { ok: false; quarantined: boolean; code: QuarantineErrorCode };

export async function runCallLogReconcileOnce(
  overrides: Partial<ReconcileDependencies> = {},
): Promise<ReconcileSummary> {
  const deps: ReconcileDependencies = {
    now: () => new Date(),
    fetchPage: fetchDetailedCallLogPage,
    fetchRecord: fetchDetailedCallLogRecord,
    fetchSync: fetchCallLogSync,
    apply: applyInteractionObservation,
    directory: loadDirectoryLookup,
    configuredAccountId: configuredRingCentralAccountId(),
    owner: `csi-call-log:${randomBytes(8).toString("hex")}`,
    config: callLogReconcileConfig(),
    requireFlag: true,
    wake: wakeOutreachForTouchedCalls,
    leaseWaitMs: RECONCILE_LEASE_WAIT_MS,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };
  const startedAt = deps.now();
  const summary: ReconcileSummary = {
    ran_at: startedAt.toISOString(),
    skipped: false,
    skip_reason: null,
    lease_owner_hash: null,
    window_from: null,
    window_to: null,
    windows: [],
    pages: 0,
    records: 0,
    upserts: 0,
    noops: 0,
    failures: 0,
    quarantined: 0,
    quarantine_retries: 0,
    straggler_reads: 0,
    settled_from_store: 0,
    sync: null,
    throttled_count: 0,
    throttle_retry_after_ms: null,
    throttle_retry_after_observed: false,
    request_id: null,
    cursor_advanced: false,
    known_complete_through: null,
    gaps_after: 0,
    error_code: null,
    runtime_ms: 0,
  };
  if (deps.requireFlag && !csiFlag("CAPTURE_CALL_LOG")) {
    summary.skipped = true;
    summary.skip_reason = "disabled";
    return summary;
  }

  const Model = getSalesIntelligenceSyncStateModel();
  const leases = new MongoLeaseStore(syncStateLeaseModel());
  const ownerHash = maskOwner(deps.owner);
  const token = await acquireWithWait(leases, {
    scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
    owner: deps.owner,
    ttl_ms: deps.config.leaseTtlMs,
    now: deps.now,
    waitMs: deps.leaseWaitMs,
    sleep: deps.sleep,
  });
  if (!token) {
    summary.skipped = true;
    summary.skip_reason = "lease_held";
    summary.runtime_ms = elapsed(startedAt, deps.now());
    event("lease_contended", "info", summary.ran_at, { leaseOwnerHash: ownerHash });
    return summary;
  }
  summary.lease_owner_hash = ownerHash;
  let lease: LeaseToken = token;

  const state = ((await Model.findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }).lean()) ??
    {}) as StoredState;
  const windowTo = startedAt;

  // Renew on a clock, not per record. A fenced `findOneAndUpdate` for every
  // Call Log row in the window was N round trips that proved nothing the
  // previous renewal had not already proved (14 §4).
  let lastRenewAt = startedAt.getTime();
  const renewInterval = Math.max(1, Math.floor(deps.config.leaseTtlMs / 3));
  const renew = async (force = false) => {
    const at = deps.now().getTime();
    if (!force && at - lastRenewAt < renewInterval) return;
    const renewed = await leases.renew({ token: lease, ttl_ms: deps.config.leaseTtlMs, now: deps.now() });
    if (!renewed) throw new LeaseLostError();
    lease = renewed;
    lastRenewAt = at;
  };

  let pageBudget = deps.config.maxPages;
  // One request id per reconcile run so every audit row it writes ties back
  // to this run (surfaced in the summary for operators).
  const runRequestId = randomBytes(12).toString("hex");
  summary.request_id = runRequestId;
  const book = new QuarantineBook(state.quarantined_records, state.record_failures, {
    ...DEFAULT_QUARANTINE_LIMITS,
    quarantineAfter: deps.config.quarantineAfter,
    transientQuarantineAfter: deps.config.quarantineAfter * 2,
  });
  /**
   * Call Log ids the provider cannot answer for (404, deterministic failure):
   * their provisional rows are settled from the store past the horizon.
   */
  const settleFromStore = new Set<string>();
  const applier = createCallLogApplier({
    now: deps.now,
    apply: deps.apply,
    directory: deps.directory,
    resolveRoute: deps.resolveRoute,
    configuredAccountId: deps.configuredAccountId,
    settleHorizonMinutes: deps.config.settleHorizonMinutes,
    book,
    renew: () => renew(),
    requestId: runRequestId,
    ownerHash,
    logPrefix: "sales_intelligence.call_log_reconcile",
    onNewlyQuarantined: (code, errorName) =>
      event("record_quarantined", "warn", summary.ran_at, {
        leaseOwnerHash: ownerHash,
        errorCode: code,
        errorName,
        quarantineAfter: deps.config.quarantineAfter,
      }),
  });
  const { attempted, ensureContext, applyOne, applyBatch } = applier;

  const noteThrottle = (error: unknown) => {
    summary.throttled_count += 1;
    summary.throttle_retry_after_ms = throttleRetryAfterMs(error);
    summary.throttle_retry_after_observed = providerSuppliedRetryAfter(error);
  };

  /** Desk wake for the rows this run changed so far (after their own transactions committed). */
  const wakeTouched = async () => {
    const touched = applier.touched();
    applier.clearTouched();
    if (touched.length) await deps.wake(touched);
  };

  const runWindow = async (kind: WindowResult["kind"], from: Date, to: Date): Promise<WindowResult> => {
    const result: WindowResult = {
      kind,
      from,
      to,
      pages: 0,
      records: 0,
      upserts: 0,
      noops: 0,
      failures: 0,
      quarantined: 0,
      complete: false,
      incomplete_before: null,
      error_code: null,
    };
    const collected: CallLogRecordInput[] = [];
    let fetchedAll = false;
    while (pageBudget > 0) {
      await renew();
      let page: unknown[];
      try {
        page = await deps.fetchPage({ from, to, page: result.pages + 1, perPage: deps.config.perPage });
      } catch (error) {
        if (isProviderThrottle(error)) {
          noteThrottle(error);
          result.error_code = "provider_throttled";
        } else {
          result.error_code = "provider_request_failed";
        }
        break;
      }
      result.pages += 1;
      pageBudget -= 1;
      const rows = page.filter(isRecord);
      collected.push(...rows);
      result.records += rows.length;
      if (page.length < deps.config.perPage) {
        fetchedAll = true;
        break;
      }
    }
    if (!fetchedAll && !result.error_code) {
      result.error_code = "page_limit";
      result.incomplete_before = earliestStart(collected);
    }
    if (collected.length) await applyBatch(collected, result);
    // Failures of quarantined records are recorded, retried by id, and never
    // hold the window; any other failure leaves `error_code` set.
    result.complete = fetchedAll && result.error_code === null;
    return result;
  };

  /** One by-id read and apply; `false` ends the by-id passes (throttle or budget). */
  const rereadById = async (
    id: string,
    hint: { telephony_session_id: string | null; start_time: Date | null },
  ): Promise<boolean> => {
    if (pageBudget <= 0 || summary.throttled_count > 0) return false;
    await renew();
    pageBudget -= 1;
    attempted.add(id);
    const fail = (code: QuarantineErrorCode, errorName: string) =>
      book.recordFailure({ call_log_id: id, ...hint, error_code: code, error_name: errorName }, deps.now());
    let fetched: unknown;
    try {
      fetched = await deps.fetchRecord(id);
    } catch (error) {
      if (isProviderThrottle(error)) {
        noteThrottle(error);
        return false;
      }
      logger.warn({ msg: "sales_intelligence.call_log_reconcile.reread_failed", leaseOwnerHash: ownerHash, ...failureLogFields(error) });
      fail("provider_request_failed", failureLogFields(error).errorName);
      return true;
    }
    if (!isRecord(fetched)) {
      fail("provider_not_found", "NotFound");
      settleFromStore.add(id);
      return true;
    }
    const contextError = await ensureContext([fetched]);
    if (contextError) {
      fail(contextError === "account_mismatch" ? "account_mismatch" : "projection_failed", "ProviderAccountError");
      return true;
    }
    const outcome = await applyOne(fetched);
    if (outcome.ok && !outcome.noop) summary.upserts += 1;
    if (!outcome.ok && !isTransientQuarantineCode(outcome.code)) settleFromStore.add(id);
    return true;
  };

  try {
    // CC-05: Call Log Sync first, so a successful `on` step can narrow the
    // start-time window to the safety net.
    let syncStep: SyncStepResult | null = null;
    if (deps.config.syncMode !== "off") {
      const lastTo = state.cursor?.last_sync_to ?? null;
      const horizonStart = new Date(windowTo.getTime() - deps.config.settleHorizonMinutes * 60_000);
      await renew();
      syncStep = await runCallLogSyncStep({
        mode: deps.config.syncMode,
        state: state.call_log_sync ?? null,
        now: windowTo,
        fsyncFrom: lastTo && lastTo < horizonStart ? lastTo : horizonStart,
        recordCount: deps.config.perPage,
        budget: pageBudget,
        fetchSync: deps.fetchSync,
        countChanged: applier.countChanged,
        apply: async (records) => {
          const counts = emptyBatchCounts();
          await applyBatch(records, counts);
          // RINGCENTRAL-CAPTURE §4.5: wake the desk once this ISync batch has committed.
          await wakeTouched();
          return {
            ...counts,
            changed: records.length - counts.noops,
            settled: counts.error_code === null,
          };
        },
      });
      pageBudget -= syncStep.requests;
      if (syncStep.error_code === "provider_throttled") {
        summary.throttled_count += 1;
        summary.throttle_retry_after_ms = syncStep.throttle_retry_after_ms;
        summary.throttle_retry_after_observed = syncStep.throttle_retry_after_observed;
      }
      summary.sync = {
        mode: syncStep.mode,
        sync_type: syncStep.sync_type,
        requests: syncStep.requests,
        records: syncStep.records,
        changed: syncStep.changed,
        applied: syncStep.applied,
        failures: syncStep.failures,
        quarantined: syncStep.quarantined,
        expired: syncStep.expired,
        token_stored: syncStep.token_stored,
        error_code: syncStep.error_code,
      };
      if (syncStep.expired) {
        event("sync_token_expired", "warn", summary.ran_at, { leaseOwnerHash: ownerHash });
      }
    }
    // With a stored `on` token the window is only a net for what ISync does
    // not report; otherwise it must cover the whole settle horizon itself.
    const syncDriving = deps.config.syncMode === "on" && syncStep?.token_stored === true;
    const horizonMinutes = syncDriving ? deps.config.safetyLookbackMinutes : deps.config.settleHorizonMinutes;
    const plan = resolveWindowPlan(windowTo, state, deps.config, horizonMinutes);
    const windowFrom = plan.from;
    summary.window_from = windowFrom.toISOString();
    summary.window_to = windowTo.toISOString();
    event("started", "info", summary.ran_at, {
      leaseOwnerHash: ownerHash,
      windowFrom: summary.window_from,
      windowTo: summary.window_to,
      openGaps: state.gaps?.length ?? 0,
      quarantined: book.quarantinedCount,
    });

    // A throttle during the sync step ends the run before the window.
    const rolling =
      summary.throttled_count > 0
        ? { ...emptyWindow("rolling", windowFrom, windowTo), error_code: "provider_throttled" as const }
        : await runWindow("rolling", windowFrom, windowTo);
    summary.windows.push(rolling);
    const stopProvider =
      summary.throttled_count > 0 ||
      rolling.error_code === "account_unresolved" ||
      rolling.error_code === "account_mismatch";

    // CC-01: due quarantined records, one by-id read each.
    if (!stopProvider) {
      for (const entry of book.due(deps.now(), deps.config.quarantineRetriesPerRun, attempted)) {
        if (!(await rereadById(entry.call_log_id, entry))) break;
        summary.quarantine_retries += 1;
      }
    }

    // Stragglers: provisional rows whose start has left the horizon are no
    // longer in any window; re-read each by id so it can settle.
    if (!stopProvider && deps.config.stragglerReadsPerRun > 0) {
      const settleBefore = new Date(windowTo.getTime() - deps.config.settleHorizonMinutes * 60_000);
      for (const row of await provisionalStragglers(settleBefore, deps.config.stragglerReadsPerRun, book, attempted)) {
        if (!(await rereadById(row.call_log_id, row))) break;
        summary.straggler_reads += 1;
      }
    }

    // A provisional row the provider cannot settle (404, deterministic failure,
    // quarantine), or one the straggler pass has not reached an hour past the
    // horizon, settles from its stored projection. No provider traffic.
    const fromStore = await settleProvisionalFromStore({
      now: deps.now,
      settleHorizonMinutes: deps.config.settleHorizonMinutes,
      limit: STORE_SETTLES_PER_RUN,
      graceMinutes: STORE_SETTLE_GRACE_MINUTES,
      priorityCallLogIds: [...settleFromStore, ...book.quarantinedIds()],
      request_id: runRequestId,
      apply: deps.apply,
      beforeEach: () => renew(),
    });
    summary.settled_from_store = fromStore.settled;
    // A settled row is final: its provider record no longer needs retrying.
    for (const id of fromStore.settled_call_log_ids) book.recordSuccess(id);

    // Oldest gaps first, only with leftover budget and only when not already inside the rolling window.
    const openGaps = [...(state.gaps ?? [])]
      .filter((gap) => !(gap.from >= windowFrom && gap.to <= windowTo))
      .sort((a, b) => a.from.getTime() - b.from.getTime());
    for (const gap of openGaps) {
      // A throttle anywhere in this run (including a previous gap repair) ends
      // the run; the provider asked us to back off, not to try the next window.
      if (pageBudget <= 0 || stopProvider || summary.throttled_count > 0) break;
      summary.windows.push(await runWindow("gap_repair", gap.from, gap.to));
    }

    for (const w of summary.windows) {
      summary.pages += w.pages;
      summary.records += w.records;
      summary.upserts += w.upserts;
      summary.noops += w.noops;
      summary.failures += w.failures;
    }
    if (syncStep) {
      summary.pages += syncStep.requests;
      summary.records += syncStep.records;
      summary.upserts += syncStep.applied;
      summary.failures += syncStep.failures;
    }
    summary.pages += summary.quarantine_retries + summary.straggler_reads;

    const finishedAt = deps.now();
    // R3: a provisional row inside the horizon means that range is not final,
    // and with ISync driving, nothing past the provider's sync time is known.
    let completeThroughCap = await oldestProvisionalStart(
      new Date(windowTo.getTime() - deps.config.settleHorizonMinutes * 60_000),
    );
    if (syncDriving && syncStep?.sync_time) {
      const syncCap = new Date(syncStep.sync_time.getTime() - deps.config.finalizationLagMinutes * 60_000);
      if (!completeThroughCap || syncCap < completeThroughCap) completeThroughCap = syncCap;
    }
    const next = nextState(state, summary.windows, windowTo, finishedAt, deps.config, plan.skipped, {
      completeThroughCap,
      overflow: book.overflow,
    });
    // The provider-modified watermark is diagnostic only (the skip compares
    // each record with its own row), but it must never advance past evidence
    // this run did not fully observe.
    const everyWindowComplete = summary.windows.every((w) => w.complete);
    const priorWatermark = state.cursor?.provider_modified_watermark ?? null;
    const observedWatermark = applier.providerWatermark();
    const nextWatermark = everyWindowComplete
      ? observedWatermark && (!priorWatermark || observedWatermark > priorWatermark)
        ? observedWatermark
        : priorWatermark
      : priorWatermark;
    const quarantine = book.snapshot();
    summary.quarantined = quarantine.quarantined_records.length;
    summary.cursor_advanced = next.cursor_advanced;
    summary.known_complete_through = next.known_complete_through?.toISOString() ?? null;
    summary.gaps_after = next.gaps.length;
    summary.error_code = rolling.complete ? null : rolling.error_code;
    summary.runtime_ms = elapsed(startedAt, finishedAt);
    const consecutiveFailures = rolling.complete ? 0 : (state.consecutive_failures ?? 0) + 1;

    const written = await Model.updateOne(
      {
        scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
        lease_owner: lease.owner,
        lease_epoch: lease.epoch,
        leased_until: { $gt: finishedAt },
      },
      {
        $set: {
          cursor: {
            last_sync_from: next.cursor_advanced ? windowFrom : state.cursor?.last_sync_from ?? null,
            last_sync_to: next.cursor_advanced ? windowTo : state.cursor?.last_sync_to ?? null,
            provider_modified_watermark: nextWatermark,
            entity_change_applied_at: null,
            entity_change_id: null,
          },
          known_complete_through: next.known_complete_through,
          gaps: next.gaps,
          consecutive_failures: consecutiveFailures,
          quarantined_records: quarantine.quarantined_records,
          record_failures: quarantine.record_failures,
          ...(syncStep?.next ? { call_log_sync: syncStep.next } : {}),
          last_run: {
            started_at: startedAt,
            finished_at: finishedAt,
            runtime_ms: summary.runtime_ms,
            pages: summary.pages,
            records: summary.records,
            upserts: summary.upserts,
            throttled_count: summary.throttled_count,
            error_code: summary.error_code,
            quarantined: summary.quarantined,
            quarantine_retries: summary.quarantine_retries,
            straggler_reads: summary.straggler_reads,
            settled_from_store: summary.settled_from_store,
            ...(syncStep
              ? {
                  sync_mode: syncStep.mode,
                  sync_type: syncStep.sync_type,
                  sync_records: syncStep.records,
                  sync_changed: syncStep.changed,
                  sync_applied: syncStep.applied,
                  sync_token_stored: syncStep.token_stored,
                  sync_error_code: syncStep.error_code,
                }
              : {}),
          },
          lease_owner: null,
          leased_until: finishedAt,
        },
      },
    );
    if (written.modifiedCount !== 1) throw new LeaseLostError();
    // Window and repair applies wake the desk too (the ISync batches already woke theirs).
    await wakeTouched();

    for (const opened of next.opened) {
      event("gap_opened", "warn", summary.ran_at, {
        leaseOwnerHash: ownerHash,
        from: opened.from.toISOString(),
        to: opened.to.toISOString(),
        reason: opened.reason,
      });
    }
    for (const closed of next.closed) {
      event("gap_closed", "info", summary.ran_at, {
        leaseOwnerHash: ownerHash,
        from: closed.from.toISOString(),
        to: closed.to.toISOString(),
      });
    }
    const oldestQuarantine = book.oldestFirstFailedAt();
    if (oldestQuarantine && finishedAt.getTime() - oldestQuarantine.getTime() > QUARANTINE_STALE_MS) {
      event("quarantine_stale", "warn", summary.ran_at, {
        leaseOwnerHash: ownerHash,
        quarantined: summary.quarantined,
        oldestFirstFailedAt: oldestQuarantine.toISOString(),
      });
    }
    // D10: three consecutive failed runs (15 min) escalate the log to `error`,
    // so platform alerting can page on it.
    const failedLevel = consecutiveFailures >= 3 ? "error" : "warn";
    event(rolling.complete ? "completed" : "failed", rolling.complete ? "info" : failedLevel, summary.ran_at, {
      leaseOwnerHash: ownerHash,
      windowFrom: summary.window_from,
      windowTo: summary.window_to,
      pages: summary.pages,
      records: summary.records,
      upserts: summary.upserts,
      noops: summary.noops,
      failures: summary.failures,
      quarantined: summary.quarantined,
      quarantineRetries: summary.quarantine_retries,
      stragglerReads: summary.straggler_reads,
      settledFromStore: summary.settled_from_store,
      syncMode: summary.sync?.mode ?? "off",
      syncRecords: summary.sync?.records ?? null,
      syncChanged: summary.sync?.changed ?? null,
      syncErrorCode: summary.sync?.error_code ?? null,
      throttledCount: summary.throttled_count,
      cursorAdvanced: summary.cursor_advanced,
      knownCompleteThrough: summary.known_complete_through,
      gapsAfter: summary.gaps_after,
      consecutiveFailures,
      errorCode: summary.error_code,
      runtimeMs: summary.runtime_ms,
    });
    return summary;
  } catch (error) {
    summary.runtime_ms = elapsed(startedAt, deps.now());
    if (error instanceof LeaseLostError) {
      summary.error_code = "lease_lost";
      summary.cursor_advanced = false;
      summary.known_complete_through = null;
      summary.gaps_after = state.gaps?.length ?? 0;
      logger.warn({ msg: "sales_intelligence.call_log_reconcile.lease_lost", leaseOwnerHash: ownerHash });
      event("failed", "warn", summary.ran_at, { leaseOwnerHash: ownerHash, errorCode: "lease_lost" });
      return summary;
    }
    summary.error_code = "state_write_failed";
    logger.error({
      msg: "sales_intelligence.call_log_reconcile.failed",
      leaseOwnerHash: ownerHash,
      ...failureLogFields(error),
    });
    // Best-effort fenced release; the state and cursor stay untouched.
    try {
      await leases.release({ token: lease, now: deps.now() });
    } catch {
      /* lease expiry is the recovery path */
    }
    event("failed", "error", summary.ran_at, { leaseOwnerHash: ownerHash, errorCode: summary.error_code });
    return summary;
  }
}

function emptyWindow(kind: WindowResult["kind"], from: Date, to: Date): WindowResult {
  return {
    kind,
    from,
    to,
    pages: 0,
    records: 0,
    upserts: 0,
    noops: 0,
    failures: 0,
    quarantined: 0,
    complete: false,
    incomplete_before: null,
    error_code: null,
  };
}

/**
 * The start-time window, plus the range the cursor part deliberately did not reach.
 *
 * `incremental_from = max(cursor.last_sync_to − overlap, now − safety)` is a
 * watermark: a stale cursor is never silently skipped — whatever the clamp
 * left behind is returned as `skipped` and opened as a `watermark_clamp` gap,
 * repaired oldest-first with the leftover page budget (14 §4).
 *
 * `from = min(incremental_from, now − settle horizon)` (CC-03). RingCentral
 * filters on **start** time and publishes a queue call mid-call, then
 * rewrites the same record when it ends; without the horizon a call longer
 * than ~20 minutes was fetched only as its mid-call snapshot, or never. A
 * first run has no cursor and no gaps, so it uses the full cold-start lookback.
 */
export function resolveWindowPlan(
  windowTo: Date,
  state: StoredState,
  config: ReconcileConfig,
  horizonMinutes: number = config.settleHorizonMinutes,
): { from: Date; incremental_from: Date; skipped: { from: Date; to: Date } | null } {
  const horizonStart = new Date(windowTo.getTime() - horizonMinutes * 60_000);
  const earlier = (a: Date, b: Date) => (a < b ? a : b);
  const lastTo = state.cursor?.last_sync_to ?? null;
  if (!lastTo) {
    const coldStart = new Date(windowTo.getTime() - config.rollingLookbackMinutes * 60_000);
    return { from: earlier(coldStart, horizonStart), incremental_from: coldStart, skipped: null };
  }
  const cursorStart = new Date(lastTo.getTime() - config.overlapMinutes * 60_000);
  const safetyStart = new Date(windowTo.getTime() - config.safetyLookbackMinutes * 60_000);
  if (cursorStart >= safetyStart) {
    return { from: earlier(cursorStart, horizonStart), incremental_from: cursorStart, skipped: null };
  }
  return {
    from: earlier(safetyStart, horizonStart),
    incremental_from: safetyStart,
    skipped: { from: cursorStart, to: safetyStart },
  };
}

/** Start of the window. See `resolveWindowPlan` for the skipped range. */
export function resolveWindowStart(windowTo: Date, state: StoredState, config: ReconcileConfig): Date {
  return resolveWindowPlan(windowTo, state, config).from;
}

export function nextState(
  state: StoredState,
  windows: WindowResult[],
  windowTo: Date,
  now: Date,
  config: ReconcileConfig,
  /** Range the watermark clamp did not reach this run; recorded, never skipped. */
  skipped: { from: Date; to: Date } | null = null,
  options: {
    /** `known_complete_through` never passes this (oldest provisional start, ISync time). */
    completeThroughCap?: Date | null;
    /** Start ranges of quarantine entries evicted past the bound. */
    overflow?: ReadonlyArray<{ from: Date; to: Date }>;
  } = {},
): {
  cursor_advanced: boolean;
  known_complete_through: Date | null;
  gaps: StoredGap[];
  opened: StoredGap[];
  closed: StoredGap[];
} {
  let gaps: StoredGap[] = [...(state.gaps ?? [])];
  const opened: StoredGap[] = [];
  const closed: StoredGap[] = [];
  let known = state.known_complete_through ?? null;
  let cursorAdvanced = false;

  // A bounded incremental window is honest only if what it left behind is
  // recorded as a gap. Gap repair then covers it oldest-first with the
  // leftover page budget, which is the mechanism that already exists for
  // catching up (14 §4).
  if (skipped && skipped.from < skipped.to) {
    const existing = gaps.find(
      (g) => g.reason === "watermark_clamp" && g.from <= skipped.to && g.to >= skipped.from,
    );
    if (existing) {
      existing.from = existing.from < skipped.from ? existing.from : skipped.from;
      existing.to = existing.to > skipped.to ? existing.to : skipped.to;
    } else {
      const gap = { from: skipped.from, to: skipped.to, reason: "watermark_clamp", opened_at: now };
      gaps.push(gap);
      opened.push(gap);
    }
  }

  for (const w of windows) {
    if (w.complete) {
      const covered = gaps.filter((g) => g.from >= w.from && g.to <= w.to);
      closed.push(...covered);
      gaps = gaps.filter((g) => !covered.includes(g));
      if (w.kind === "rolling") {
        cursorAdvanced = true;
        let candidate = new Date(windowTo.getTime() - config.finalizationLagMinutes * 60_000);
        // `known` never moves backwards. A provisional row older than it (a
        // snapshot first stored after `known` passed its start) therefore
        // cannot lower it, but holds it where it is until the row settles.
        const cap = options.completeThroughCap ?? null;
        if (cap && cap < candidate) candidate = cap;
        if (!known || candidate > known) known = candidate;
      }
      continue;
    }
    const reason = w.error_code ?? "unknown_error";
    const from = w.from;
    const to = w.error_code === "page_limit" && w.incomplete_before ? w.incomplete_before : w.to;
    if (w.kind === "gap_repair") {
      // Keep the gap; narrow it if the newest part was fetched completely.
      gaps = gaps.map((g) =>
        g.from.getTime() === w.from.getTime() && g.to.getTime() === w.to.getTime()
          ? { ...g, to, reason }
          : g,
      );
      continue;
    }
    const overlapping = gaps.find((g) => g.reason === reason && g.from <= to && g.to >= from);
    if (overlapping) {
      overlapping.from = overlapping.from < from ? overlapping.from : from;
      overlapping.to = overlapping.to > to ? overlapping.to : to;
    } else {
      const gap = { from, to, reason, opened_at: now };
      gaps.push(gap);
      opened.push(gap);
    }
  }
  for (const range of options.overflow ?? []) {
    const gap = { from: range.from, to: range.to, reason: "quarantine_overflow", opened_at: now };
    gaps.push(gap);
    opened.push(gap);
  }
  gaps.sort((a, b) => a.from.getTime() - b.from.getTime());
  // Bounded 50: coalesce the two oldest instead of dropping evidence.
  while (gaps.length > 50) {
    const [a, b, ...rest] = gaps;
    gaps = [
      { from: a!.from, to: a!.to > b!.to ? a!.to : b!.to, reason: "coalesced", opened_at: a!.opened_at },
      ...rest,
    ];
  }
  return { cursor_advanced: cursorAdvanced, known_complete_through: known, gaps, opened, closed };
}

type ReconcileEventKind =
  | "started"
  | "completed"
  | "failed"
  | "lease_contended"
  | "gap_opened"
  | "gap_closed"
  | "record_quarantined"
  | "quarantine_stale"
  | "sync_token_expired";

/** Structured log of one reconcile run event (`sales_intelligence.call_log_reconcile.<kind>`). */
function event(
  kind: ReconcileEventKind,
  level: "info" | "warn" | "error",
  runId: string,
  details: Record<string, unknown>,
): void {
  logger[level]({ msg: `sales_intelligence.call_log_reconcile.${kind}`, runId, ...details });
}

function elapsed(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

function isRecord(value: unknown): value is CallLogRecordInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Oldest canonical provisional row that started at or after `since` (bounds `known_complete_through`). */
async function oldestProvisionalStart(since: Date): Promise<Date | null> {
  const row = (await getCallInteractionModel()
    .collection.find(
      { call_log_state: "provisional", started_at: { $gte: since }, merged_into_id: null },
      { projection: { started_at: 1 } },
    )
    .sort({ started_at: 1 })
    .limit(1)
    .next()) as { started_at?: Date | null } | null;
  return row?.started_at instanceof Date ? row.started_at : null;
}

/**
 * Canonical provisional rows whose start is older than the settle horizon,
 * oldest first. No start-time window reaches them any more, so each is
 * re-read by its first Call Log id. Quarantined ids and ids this run already
 * applied are skipped.
 */
async function provisionalStragglers(
  settleBefore: Date,
  limit: number,
  book: QuarantineBook,
  attempted: ReadonlySet<string>,
): Promise<Array<{ call_log_id: string; telephony_session_id: string | null; start_time: Date | null }>> {
  const rows = (await getCallInteractionModel()
    .collection.find(
      { call_log_state: "provisional", started_at: { $lt: settleBefore }, merged_into_id: null },
      { projection: { call_log_ids: 1, telephony_session_id: 1, started_at: 1 } },
    )
    .sort({ started_at: 1 })
    .limit(limit + 50)
    .toArray()) as Array<{ call_log_ids?: string[]; telephony_session_id?: string | null; started_at?: Date | null }>;
  const out: Array<{ call_log_id: string; telephony_session_id: string | null; start_time: Date | null }> = [];
  for (const row of rows) {
    const id = row.call_log_ids?.[0];
    if (!id || book.isQuarantined(id) || attempted.has(id)) continue;
    out.push({ call_log_id: id, telephony_session_id: row.telephony_session_id ?? null, start_time: row.started_at ?? null });
    if (out.length >= limit) break;
  }
  return out;
}

function earliestStart(records: CallLogRecordInput[]): Date | null {
  let out: Date | null = null;
  for (const record of records) {
    const start = startOf(record);
    if (start && (!out || start < out)) out = start;
  }
  return out;
}

export const RETENTION_LEASE_SCOPE = "retention";

/**
 * The minute ISync lane holds the reconcile lease for a few seconds. A reconcile run that finds the
 * lease held polls this long before reporting `lease_held`, so one overlapping minute-lane run never
 * costs a whole 5-minute window.
 */
export const RECONCILE_LEASE_WAIT_MS = 20_000;
const LEASE_POLL_MS = 2_000;

/** Acquires the lease, polling up to `waitMs` while another holder has it. `null` when still held. */
export async function acquireWithWait(
  leases: Pick<MongoLeaseStore, "acquire">,
  input: { scope: string; owner: string; ttl_ms: number; now: () => Date; waitMs: number; sleep: (ms: number) => Promise<void> },
): Promise<LeaseToken | null> {
  const started = input.now().getTime();
  for (;;) {
    const token = await leases.acquire({ scope: input.scope, owner: input.owner, ttl_ms: input.ttl_ms, now: input.now() });
    if (token) return token;
    const waited = input.now().getTime() - started;
    if (waited + LEASE_POLL_MS > input.waitMs) return null;
    await input.sleep(LEASE_POLL_MS);
  }
}

export function syncStateLeaseModel(): MongoLeaseModel {
  const Model = getSalesIntelligenceSyncStateModel();
  return {
    findOneAndUpdate: (filter, update, options) =>
      Model.findOneAndUpdate(filter, update, { ...options, lean: true }) as never,
    updateOne: (filter, update) => Model.updateOne(filter, update),
    findOne: (filter) => Model.findOne(filter).lean() as never,
  };
}

/** Live reconcile outranks window work. Peek only — never acquire the live lease from backfill. */
export async function callLogReconcileLeaseHeld(now: Date): Promise<boolean> {
  const row = await getSalesIntelligenceSyncStateModel()
    .findOne({
      scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
      lease_owner: { $nin: [null, ""] },
      leased_until: { $gt: now },
    })
    .lean();
  return Boolean(row);
}

export type BackfillPageResult = {
  records: number;
  upserts: number;
  noops: number;
  last_page: boolean;
  contact_number_ids: string[];
  throttled: boolean;
  retry_after_ms: number | null;
  retry_after_observed: boolean;
  error_code: ReconcileErrorCode | null;
};

/** One Call Log page for a historical window. Source is `"backfill"`. Does not claim or write the live cursor. */
export async function projectCallLogBackfillPage(input: {
  from: Date;
  to: Date;
  page: number;
  perPage?: number;
  request_id: string;
  now?: () => Date;
  fetchPage?: CallLogPageFetcher;
  apply?: typeof applyInteractionObservation;
  directory?: (accountId: string) => Promise<DirectoryLookup>;
  configuredAccountId?: string | null;
  resolveRoute?: RouteResolver;
}): Promise<BackfillPageResult> {
  const now = input.now ?? (() => new Date());
  const fetchPage = input.fetchPage ?? fetchDetailedCallLogPage;
  const apply = input.apply ?? applyInteractionObservation;
  const directoryFn = input.directory ?? loadDirectoryLookup;
  const perPage = input.perPage ?? 250;
  const result: BackfillPageResult = {
    records: 0,
    upserts: 0,
    noops: 0,
    last_page: false,
    contact_number_ids: [],
    throttled: false,
    retry_after_ms: null,
    retry_after_observed: false,
    error_code: null,
  };
  let page: unknown[];
  try {
    page = await fetchPage({ from: input.from, to: input.to, page: input.page, perPage });
  } catch (error) {
    if (isProviderThrottle(error)) {
      result.throttled = true;
      result.retry_after_ms = throttleRetryAfterMs(error);
      result.retry_after_observed = providerSuppliedRetryAfter(error);
      result.error_code = "provider_throttled";
      return result;
    }
    if (isProviderPermissionDenied(error)) {
      result.error_code = "provider_permission_denied";
      return result;
    }
    result.error_code = "provider_request_failed";
    return result;
  }
  const rows = page.filter(isRecord);
  if (rows.length !== page.length) {
    result.error_code = "projection_failed";
    return result;
  }
  result.records = rows.length;
  result.last_page = page.length < perPage;
  if (!rows.length) return result;
  let accountId: string;
  try {
    accountId = resolveProviderAccountId(
      rows.map((r) => accountIdFromProviderPath(str(r.uri))),
      input.configuredAccountId ?? configuredRingCentralAccountId(),
    );
  } catch (error) {
    result.error_code = error instanceof ProviderAccountError ? error.code : "unknown_error";
    return result;
  }
  let directory: DirectoryLookup;
  let resolveRoute: RouteResolver;
  try {
    directory = await directoryFn(accountId);
    resolveRoute = input.resolveRoute ?? (await defaultRouteResolver());
  } catch {
    result.error_code = "projection_failed";
    return result;
  }
  const ordered = [...rows].sort(
    (a, b) => (startOf(a)?.getTime() ?? Number.POSITIVE_INFINITY) - (startOf(b)?.getTime() ?? Number.POSITIVE_INFINITY),
  );
  const numbers = new Set<string>();
  for (const record of ordered) {
    try {
      const applied = await apply(
        accountId,
        { kind: "call_log", record, proof_ref: `call_log:${str(record.id) ?? "unknown"}`, source: "backfill" },
        { now, directory, resolveRoute, request_id: input.request_id, settleHorizonMinutes: callLogReconcileConfig().settleHorizonMinutes },
      );
      if (applied.noop) result.noops += 1;
      else result.upserts += 1;
      if (applied.contact_number_id) numbers.add(applied.contact_number_id);
    } catch (error) {
      result.error_code =
        error instanceof InteractionPersistenceError && error.code === "account_mismatch"
          ? "account_mismatch"
          : "projection_failed";
      logger.warn({
        msg: "sales_intelligence.call_log_backfill.record_failed",
        errorName: error instanceof Error ? error.name : "Error",
      });
      result.contact_number_ids = [...numbers];
      return result;
    }
  }
  result.contact_number_ids = [...numbers];
  return result;
}
