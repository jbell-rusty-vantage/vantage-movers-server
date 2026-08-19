import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";
import { ringCentralRequest, RingCentralApiError } from "./client";
import { vetRingCentralCallLogRecord } from "./call-log-vetting";
import {
  loadRingCentralRouteSnapshot,
  recordRingCentralRouteObservation,
} from "../operationsRegistry";
import {
  acquireCallLogSyncLease,
  assertCallLogSyncStateSingletonIndex,
  createCallLogSyncLeaseOwner,
  maskLeaseOwner,
  recordCallLogSyncError,
  recordCallLogSyncSuccess,
  releaseCallLogSyncLease,
  renewCallLogSyncLease,
  RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS,
  type RingCentralCallLogSyncErrorCode,
  type RingCentralCallLogSyncStateDocument,
} from "./call-log-sync-state.store";
import {
  getRingCentralCallLogSyncLookbackMinutes,
  getRingCentralCallLogSyncOverlapMinutes,
  getRingCentralCallLogSyncRollingLookbackMinutes,
} from "./ringcentral-config";
import {
  ingestRingCentralQualifiedCall,
  type RingCentralIngestAction,
  type RingCentralQualifiedCall,
} from "./ringcentral-call-lead-ingest.service";
import {
  incrementRingCentralAdoptionsTotal,
  incrementRingCentralCallLogLeaseContentionTotal,
  recordRingCentralCallLogRuntimeMs,
} from "./ringcentral-metrics";

/**
 * Scheduled Call Log sync (the cron half of the hybrid strategy).
 *
 * A cron request is only a trigger. Mongo state elects the single winner: each
 * invocation atomically claims the `key: "account"` five-minute lease before
 * doing any provider, route-observation, ingest, or state work. A losing
 * invocation records bounded contention and returns without side effects; it
 * is not an error and never becomes an HTTP 500.
 *
 * The winner reads the high-water-mark cursor it observed at claim time and
 * fetches detailed inbound Call Log records for a conservative rolling window.
 * On normal runs the start is the earlier of `[lastSyncTo - overlap]` and
 * `[now - rollingLookback]`; on first run it uses `[now - lookback]`, still
 * honoring the rolling floor. This guards against very long calls and
 * RingCentral finalization lag: a record whose `startTime` has already fallen
 * behind the short overlap can still be seen on a later run after it appears
 * in Call Log. Because ingest is idempotent by `telephonySessionId` /
 * `callLogId`, repeated scans safely skip already processed calls — so the
 * 12-hour floor stays locked and does not shrink with the cron cadence.
 *
 * The lease is renewed before the long pagination/ingest phase and while work
 * remains. Every renewal and terminal write is fenced by the owning lease, so
 * a stale owner can neither finalize nor clear a successor's state. The cursor
 * advances only in the fenced update that follows a complete successful run:
 * pagination, vetting, route observation, adoption/conflict persistence,
 * normal ingest, ledger persistence, and lease ownership must all have
 * succeeded. Any failure, throttle, or lease loss leaves the window intact so
 * the next run retries the same range.
 */
const PER_PAGE = 250;
const MAX_PAGES = 20;

/** Renew well before the five-minute lease expires. */
const RENEW_INTERVAL_MS = 2 * 60 * 1000;

export type RingCentralCallLogSyncSummary = {
  ranAt: string;
  windowFrom: string;
  windowTo: string;
  /** Short opaque digest of the lease owner. Never the owner value itself. */
  leaseOwnerHash: string | null;
  leaseAcquired: boolean;
  leaseRecovered: boolean;
  leaseLost: boolean;
  skipped: boolean;
  skipReason: "lease_held" | null;
  runtimeMs: number;
  fetchedRecords: number;
  candidateRecords: number;
  qualifiedRecords: number;
  ingestActions: Record<RingCentralIngestAction, number>;
  adoptedRecords: number;
  adoptionConflicts: number;
  throttledResponses: number;
  leadsCreated: number;
  duplicatesFlagged: number;
  cursorAdvanced: boolean;
  /** Bounded failure codes only — never provider or caller content. */
  errors: RingCentralCallLogSyncErrorCode[];
};

export type RingCentralCallLogSyncDependencies = {
  now: () => Date;
  createOwner: typeof createCallLogSyncLeaseOwner;
  assertSingletonIndex: typeof assertCallLogSyncStateSingletonIndex;
  acquireLease: typeof acquireCallLogSyncLease;
  renewLease: typeof renewCallLogSyncLease;
  recordSuccess: typeof recordCallLogSyncSuccess;
  recordError: typeof recordCallLogSyncError;
  releaseLease: typeof releaseCallLogSyncLease;
  loadRouteSnapshot: typeof loadRingCentralRouteSnapshot;
  recordRouteObservation: typeof recordRingCentralRouteObservation;
  vetRecord: typeof vetRingCentralCallLogRecord;
  fetchCallLogPage: (input: {
    from: Date;
    to: Date;
    page: number;
    perPage: number;
  }) => Promise<unknown[]>;
  ingestCall: typeof ingestRingCentralQualifiedCall;
  recordEvent: typeof recordOperationalEvent;
  leaseDurationMs: number;
  renewIntervalMs: number;
  maxPages: number;
  perPage: number;
};

const defaultDependencies: RingCentralCallLogSyncDependencies = {
  now: () => new Date(),
  createOwner: createCallLogSyncLeaseOwner,
  assertSingletonIndex: assertCallLogSyncStateSingletonIndex,
  acquireLease: acquireCallLogSyncLease,
  renewLease: renewCallLogSyncLease,
  recordSuccess: recordCallLogSyncSuccess,
  recordError: recordCallLogSyncError,
  releaseLease: releaseCallLogSyncLease,
  loadRouteSnapshot: loadRingCentralRouteSnapshot,
  recordRouteObservation: recordRingCentralRouteObservation,
  vetRecord: vetRingCentralCallLogRecord,
  fetchCallLogPage: fetchDetailedInboundCallLogPage,
  ingestCall: ingestRingCentralQualifiedCall,
  recordEvent: recordOperationalEvent,
  leaseDurationMs: RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS,
  renewIntervalMs: RENEW_INTERVAL_MS,
  maxPages: MAX_PAGES,
  perPage: PER_PAGE,
};

/** Raised when the owner fence no longer matches; never surfaced to callers. */
class RingCentralCallLogLeaseLostError extends Error {
  constructor() {
    super("RingCentral Call Log lease was lost.");
    this.name = "RingCentralCallLogLeaseLostError";
  }
}

type RunStage =
  | "route_snapshot"
  | "provider_fetch"
  | "ingest"
  | "state_write"
  | "lease";

export async function runRingCentralCallLogSync(
  startedAt: Date = new Date(),
  dependencies: Partial<RingCentralCallLogSyncDependencies> = {},
): Promise<RingCentralCallLogSyncSummary> {
  const deps = { ...defaultDependencies, ...dependencies };
  const runStartedAt = dependencies.now ? deps.now() : startedAt;

  const summary: RingCentralCallLogSyncSummary = {
    ranAt: runStartedAt.toISOString(),
    windowFrom: runStartedAt.toISOString(),
    windowTo: runStartedAt.toISOString(),
    leaseOwnerHash: null,
    leaseAcquired: false,
    leaseRecovered: false,
    leaseLost: false,
    skipped: false,
    skipReason: null,
    runtimeMs: 0,
    fetchedRecords: 0,
    candidateRecords: 0,
    qualifiedRecords: 0,
    ingestActions: {
      lead_created: 0,
      lead_created_duplicate: 0,
      lead_adopted: 0,
      lead_adopted_duplicate: 0,
      shadow_recorded: 0,
      dry_run: 0,
      skipped_already_processed: 0,
    },
    adoptedRecords: 0,
    adoptionConflicts: 0,
    throttledResponses: 0,
    leadsCreated: 0,
    duplicatesFlagged: 0,
    cursorAdvanced: false,
    errors: [],
  };

  await deps.assertSingletonIndex();

  const owner = deps.createOwner();
  const ownerHash = maskLeaseOwner(owner);
  const claim = await deps.acquireLease({
    owner,
    now: runStartedAt,
    leaseDurationMs: deps.leaseDurationMs,
  });

  if (!claim.acquired) {
    incrementRingCentralCallLogLeaseContentionTotal();
    summary.skipped = true;
    summary.skipReason = "lease_held";
    summary.runtimeMs = elapsedMs(runStartedAt, deps.now());
    logger.info({
      msg: "ringcentral.call_log_sync.lease_contended",
      leaseOwnerHash: ownerHash,
    });
    await deps.recordEvent({
      level: "info",
      eventKey: "ringcentral.call_log_sync.lease_contended",
      category: "ringcentral",
      workflow: "ringcentral_call_log_sync",
      summary: "RingCentral Call Log sync skipped: another run holds the lease.",
      runId: summary.ranAt,
      details: {
        leaseOwnerHash: ownerHash,
        reason: "lease_held",
      },
      notificationCandidate: false,
      reportable: false,
    });
    return summary;
  }

  summary.leaseAcquired = true;
  summary.leaseRecovered = claim.recovered;
  summary.leaseOwnerHash = ownerHash;

  // The winner alone defines the window: `windowTo` after acquisition, and
  // `windowFrom` from the state that same winner observed.
  const windowTo = claim.leaseAcquiredAt;
  const windowFrom = resolveWindowStart(windowTo, claim.state);
  summary.windowFrom = windowFrom.toISOString();
  summary.windowTo = windowTo.toISOString();

  let leaseExpiresAt = claim.leasedUntil;
  let lastRenewedAt = claim.leaseAcquiredAt;
  let stage: RunStage = "route_snapshot";

  await deps.recordEvent({
    level: "info",
    eventKey: "ringcentral.call_log_sync.started",
    category: "ringcentral",
    workflow: "ringcentral_call_log_sync",
    summary: "RingCentral Call Log sync started.",
    runId: summary.ranAt,
    details: {
      leaseOwnerHash: ownerHash,
      windowFrom: summary.windowFrom,
      windowTo: summary.windowTo,
      leasedUntil: leaseExpiresAt.toISOString(),
      recoveredExpiredLease: claim.recovered,
    },
    notificationCandidate: false,
    reportable: false,
  });

  if (claim.recovered) {
    logger.warn({
      msg: "ringcentral.call_log_sync.lease_recovered",
      leaseOwnerHash: ownerHash,
    });
    await deps.recordEvent({
      level: "warn",
      eventKey: "ringcentral.call_log_sync.lease_recovered",
      category: "ringcentral",
      workflow: "ringcentral_call_log_sync",
      summary: "RingCentral Call Log sync recovered an expired lease.",
      runId: summary.ranAt,
      details: { leaseOwnerHash: ownerHash },
      notificationCandidate: false,
      reportable: false,
    });
  }

  /** Fenced renewal; throws lease-lost so no further work or write happens. */
  async function renewIfDue(force = false): Promise<void> {
    const now = deps.now();
    if (
      !force &&
      now.getTime() - lastRenewedAt.getTime() < deps.renewIntervalMs
    ) {
      return;
    }
    stage = "lease";
    const renewal = await deps.renewLease({
      owner,
      now,
      leaseDurationMs: deps.leaseDurationMs,
    });
    if (!renewal.renewed) {
      throw new RingCentralCallLogLeaseLostError();
    }
    leaseExpiresAt = renewal.leasedUntil ?? leaseExpiresAt;
    lastRenewedAt = now;
  }

  try {
    stage = "route_snapshot";
    const routeSnapshot = await deps.loadRouteSnapshot();

    // Renew before the potentially long provider pagination/ingest phase.
    await renewIfDue(true);

    for (let page = 1; page <= deps.maxPages; page += 1) {
      stage = "provider_fetch";
      const pageRecords = await fetchPageCountingThrottles(
        deps,
        summary,
        windowFrom,
        windowTo,
        page,
      );
      summary.fetchedRecords += pageRecords.length;

      for (const record of pageRecords) {
        await renewIfDue();
        stage = "ingest";
        await processRecord(deps, summary, record, routeSnapshot, windowTo);
      }

      if (pageRecords.length < deps.perPage) {
        break;
      }
      await renewIfDue();
    }

    stage = "state_write";
    const completedAt = deps.now();
    summary.runtimeMs = elapsedMs(runStartedAt, completedAt);
    const advanced = await deps.recordSuccess({
      owner,
      syncFrom: windowFrom,
      syncTo: windowTo,
      processedCount: summary.fetchedRecords,
      qualifiedCount: summary.qualifiedRecords,
      leadActionCount: summary.leadsCreated,
      telemetry: {
        runtimeMs: summary.runtimeMs,
        adoptedCount: summary.adoptedRecords,
        adoptionConflictCount: summary.adoptionConflicts,
        throttledCount: summary.throttledResponses,
      },
      now: completedAt,
    });

    if (!advanced) {
      // The fence was lost between the last renewal and finalization: the
      // cursor stays exactly where the previous successful run left it.
      throw new RingCentralCallLogLeaseLostError();
    }

    summary.cursorAdvanced = true;
    recordRingCentralCallLogRuntimeMs(summary.runtimeMs);

    logger.info({ msg: "ringcentral.call_log_sync.completed", ...summary });

    await deps.recordEvent({
      level: "info",
      eventKey: "ringcentral.call_log_sync.completed",
      category: "ringcentral",
      workflow: "ringcentral_call_log_sync",
      summary: "RingCentral Call Log sync completed.",
      runId: summary.ranAt,
      durationMs: summary.runtimeMs,
      details: {
        leaseOwnerHash: ownerHash,
        windowFrom: summary.windowFrom,
        windowTo: summary.windowTo,
        runtimeMs: summary.runtimeMs,
        fetchedRecords: summary.fetchedRecords,
        candidateRecords: summary.candidateRecords,
        qualifiedRecords: summary.qualifiedRecords,
        adoptedRecords: summary.adoptedRecords,
        adoptionConflicts: summary.adoptionConflicts,
        throttledResponses: summary.throttledResponses,
        leadsCreated: summary.leadsCreated,
        duplicatesFlagged: summary.duplicatesFlagged,
        cursorAdvanced: true,
        ingestActions: summary.ingestActions,
      },
      // A clean run resolves any open Call Log sync failure incident.
      autoResolveKey: `ringcentral.call_log_sync.failed:${resolveEnvironmentName()}`,
    });

    return summary;
  } catch (error) {
    const leaseLost = error instanceof RingCentralCallLogLeaseLostError;
    const errorCode = leaseLost ? "lease_lost" : classifyStageError(stage, error);
    summary.leaseLost = leaseLost;
    summary.errors.push(errorCode);
    summary.runtimeMs = elapsedMs(runStartedAt, deps.now());
    recordRingCentralCallLogRuntimeMs(summary.runtimeMs);

    if (leaseLost) {
      // No terminal write as the former owner: a successor may already own the
      // state. Committed Unit 20 effects stay valid and are idempotent on the
      // next rescan of the same window.
      logger.warn({
        msg: "ringcentral.call_log_sync.lease_lost",
        leaseOwnerHash: ownerHash,
        stage,
      });
      await deps.recordEvent({
        level: "warn",
        eventKey: "ringcentral.call_log_sync.lease_lost",
        category: "ringcentral",
        workflow: "ringcentral_call_log_sync",
        summary: "RingCentral Call Log sync lost its lease before finalizing.",
        runId: summary.ranAt,
        durationMs: summary.runtimeMs,
        details: {
          leaseOwnerHash: ownerHash,
          stage,
          errorCode,
          cursorAdvanced: false,
        },
        notificationCandidate: false,
        reportable: false,
      });
      return summary;
    }

    // One fenced terminal error/release attempt. If it loses the fence, only a
    // PII-safe lease-lost event is recorded.
    let fenced = false;
    try {
      fenced = await deps.recordError({
        owner,
        errorCode,
        telemetry: {
          runtimeMs: summary.runtimeMs,
          adoptedCount: summary.adoptedRecords,
          adoptionConflictCount: summary.adoptionConflicts,
          throttledCount: summary.throttledResponses,
        },
        now: deps.now(),
      });
    } catch (stateError) {
      logger.error({
        msg: "ringcentral.call_log_sync.state_write_failed",
        leaseOwnerHash: ownerHash,
        errorName: stateError instanceof Error ? stateError.name : "Error",
      });
    }

    if (!fenced) {
      summary.leaseLost = true;
      logger.warn({
        msg: "ringcentral.call_log_sync.lease_lost",
        leaseOwnerHash: ownerHash,
        stage,
      });
      await deps.recordEvent({
        level: "warn",
        eventKey: "ringcentral.call_log_sync.lease_lost",
        category: "ringcentral",
        workflow: "ringcentral_call_log_sync",
        summary:
          "RingCentral Call Log sync could not finalize: the lease fence no longer matched.",
        runId: summary.ranAt,
        durationMs: summary.runtimeMs,
        details: {
          leaseOwnerHash: ownerHash,
          stage,
          errorCode,
          cursorAdvanced: false,
        },
        notificationCandidate: false,
        reportable: false,
      });
      return summary;
    }

    logger.error({
      msg: "ringcentral.call_log_sync.failed",
      leaseOwnerHash: ownerHash,
      stage,
      errorCode,
      windowFrom: summary.windowFrom,
      windowTo: summary.windowTo,
    });

    await deps.recordEvent({
      level: "error",
      eventKey: "ringcentral.call_log_sync.failed",
      category: "ringcentral",
      workflow: "ringcentral_call_log_sync",
      summary: "RingCentral Call Log sync failed.",
      runId: summary.ranAt,
      durationMs: summary.runtimeMs,
      dedupeKey: `ringcentral.call_log_sync.failed:${resolveEnvironmentName()}`,
      details: {
        leaseOwnerHash: ownerHash,
        windowFrom: summary.windowFrom,
        windowTo: summary.windowTo,
        stage,
        errorCode,
        runtimeMs: summary.runtimeMs,
        throttledResponses: summary.throttledResponses,
        cursorAdvanced: false,
      },
      errorMessage: errorCode,
      notificationCandidate: true,
    });

    throw error;
  }
}

async function processRecord(
  deps: RingCentralCallLogSyncDependencies,
  summary: RingCentralCallLogSyncSummary,
  record: unknown,
  routeSnapshot: Awaited<ReturnType<typeof loadRingCentralRouteSnapshot>>,
  now: Date,
): Promise<void> {
  const vet = deps.vetRecord(record, routeSnapshot);
  if (vet.matchedTargetNumber) {
    summary.candidateRecords += 1;
    if (vet.routeResolution) {
      await deps.recordRouteObservation(
        vet.routeResolution.route_id,
        "call_log",
        vet.startTime ?? now,
        vet.targetName,
      );
    }
  }
  if (
    vet.rejectionReasons.length > 0 ||
    !vet.sourceCompany ||
    !vet.callerPhoneNumber ||
    !vet.routeResolution
  ) {
    return;
  }
  summary.qualifiedRecords += 1;

  const qualifiedCall: RingCentralQualifiedCall = {
    ingestionSource: "call_log_sync",
    telephonySessionId: vet.telephonySessionId,
    sessionId: vet.sessionId,
    partyId: null,
    callLogId: vet.callLogId,
    sourceCompany: vet.sourceCompany,
    sourceLabel: vet.sourceLabel,
    routeResolution: vet.routeResolution,
    callerPhoneNumber: vet.callerPhoneNumber,
    callerName: vet.callerName,
    targetPhoneNumber: vet.targetPhoneNumber ?? "",
    targetName: vet.targetName,
    answeredAt: vet.startTime,
    terminalAt:
      vet.startTime && vet.durationSeconds !== null
        ? new Date(vet.startTime.getTime() + vet.durationSeconds * 1000)
        : null,
    startTime: vet.startTime,
    durationSeconds: vet.durationSeconds ?? 0,
    qualificationReason: "call_log_inbound_target_answered_over_120s",
  };

  const result = await deps.ingestCall(qualifiedCall, now);
  summary.ingestActions[result.action] += 1;
  if (result.action === "lead_created" || result.action === "lead_created_duplicate") {
    summary.leadsCreated += 1;
  }
  if (result.action === "lead_adopted" || result.action === "lead_adopted_duplicate") {
    summary.adoptedRecords += 1;
  }
  if (result.convergenceOutcome === "conflict") {
    summary.adoptionConflicts += 1;
  }
  if (result.convergenceOutcome) {
    incrementRingCentralAdoptionsTotal(result.convergenceOutcome);
  }
  if (result.duplicate) {
    summary.duplicatesFlagged += 1;
  }
}

async function fetchPageCountingThrottles(
  deps: RingCentralCallLogSyncDependencies,
  summary: RingCentralCallLogSyncSummary,
  from: Date,
  to: Date,
  page: number,
): Promise<unknown[]> {
  try {
    return await deps.fetchCallLogPage({
      from,
      to,
      page,
      perPage: deps.perPage,
    });
  } catch (error) {
    if (isProviderThrottleError(error)) {
      // Observed only. Provider retry policy is out of this unit's scope, and
      // an unrecovered throttle is a partial run: the cursor does not move.
      summary.throttledResponses += 1;
    }
    throw error;
  }
}

function isProviderThrottleError(error: unknown): boolean {
  return error instanceof RingCentralApiError && error.status === 429;
}

function classifyStageError(
  stage: RunStage,
  error: unknown,
): RingCentralCallLogSyncErrorCode {
  if (isProviderThrottleError(error)) {
    return "provider_throttled";
  }
  switch (stage) {
    case "route_snapshot":
      return "route_snapshot_failed";
    case "provider_fetch":
      return "provider_request_failed";
    case "ingest":
      return "ingest_failed";
    // A renewal that fails technically (rather than losing its fence) is a
    // state write failure; a lost fence is reported as `lease_lost`.
    case "state_write":
    case "lease":
      return "state_write_failed";
    default:
      return "unknown_error";
  }
}

function elapsedMs(from: Date, to: Date): number {
  const elapsed = to.getTime() - from.getTime();
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed) : 0;
}

function resolveEnvironmentName(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

/**
 * Rolling-window contract (locked):
 *
 *   normal run: min(lastSyncTo - configured overlap, now - 12h rolling lookback)
 *   first run:  min(now - configured initial lookback, now - 12h rolling lookback)
 *
 * The 12-hour floor is independent of the cron cadence.
 */
export function resolveWindowStart(
  windowTo: Date,
  state: RingCentralCallLogSyncStateDocument | null,
): Date {
  const overlapMs = getRingCentralCallLogSyncOverlapMinutes() * 60 * 1000;
  const rollingLookbackMs =
    getRingCentralCallLogSyncRollingLookbackMinutes() * 60 * 1000;
  const rollingWindowStart = new Date(windowTo.getTime() - rollingLookbackMs);
  if (state?.lastSyncTo) {
    const cursorWindowStart = new Date(state.lastSyncTo.getTime() - overlapMs);
    return earlierDate(cursorWindowStart, rollingWindowStart);
  }
  const lookbackMs = getRingCentralCallLogSyncLookbackMinutes() * 60 * 1000;
  const initialWindowStart = new Date(windowTo.getTime() - lookbackMs);
  return earlierDate(initialWindowStart, rollingWindowStart);
}

function earlierDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

async function fetchDetailedInboundCallLogPage(input: {
  from: Date;
  to: Date;
  page: number;
  perPage: number;
}): Promise<unknown[]> {
  const query = new URLSearchParams({
    dateFrom: input.from.toISOString(),
    dateTo: input.to.toISOString(),
    direction: "Inbound",
    type: "Voice",
    view: "Detailed",
    perPage: String(input.perPage),
    page: String(input.page),
  });
  const payload = await ringCentralRequest(
    "GET",
    `/restapi/v1.0/account/~/call-log?${query.toString()}`,
  );
  return Array.isArray(payload?.records) ? payload.records : [];
}
