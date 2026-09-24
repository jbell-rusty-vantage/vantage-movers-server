import { randomBytes } from "node:crypto";
import { logger } from "../../logger";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore } from "../durableWork/leases";
import type { LeaseToken } from "../durableWork/types";
import { recordOperationalEvent } from "../observability";
import {
  accountIdFromProviderPath,
  configuredRingCentralAccountId,
  ProviderAccountError,
  resolveProviderAccountId,
} from "./accountIdentity";
import {
  fetchDetailedCallLogPage,
  isProviderThrottle,
  type CallLogPageFetcher,
} from "./callLogClient";
import { failureLogFields } from "./callLogQuarantine";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import { applyInteractionObservation, defaultRouteResolver } from "./persistInteraction";
import { identityFromCallLogRecord, type CallLogRecordInput } from "./interactionProjection";
import {
  CALL_LOG_ALL_DIRECTIONS_SCOPE,
  callLogReconcileConfig,
  maskOwner,
  syncStateLeaseModel,
  type ReconcileConfig,
  type ReconcileErrorCode,
} from "./reconcileCallLog";
import type { RouteResolver } from "./types";

/**
 * CC-06: nightly authoritative Call Log sweep and measured completeness.
 *
 * Re-reads `[now − lookback (36 h), now − settle horizon]` with full paging
 * and **no skip**: every record goes through `applyInteractionObservation`,
 * where an unchanged one is a semantic no-op. Before applying, each record is
 * compared with its stored row exactly as `scripts/dev_ops/diff-call-log-vs-interactions.ts`
 * does (MISSING: no row; STALE: provider modified later, or result, duration
 * or a recording differs), so `missing_before` / `stale_before` measure what
 * the live reconcile left wrong rather than assume it was complete.
 *
 * Takes the reconcile lease (scope `call_log_all_directions`) so it never
 * overlaps a run, and never writes the reconcile cursor, gaps or quarantine.
 * Its own figures live on scope `call_log_sweep`.
 */
export const CALL_LOG_SWEEP_SCOPE = "call_log_sweep";

export type SweepSummary = {
  ran_at: string;
  skipped: boolean;
  skip_reason: "disabled" | "lease_held" | null;
  lease_owner_hash: string | null;
  from: string | null;
  to: string | null;
  pages: number;
  provider_records: number;
  /** Provider records whose stored row already held the latest version before the sweep. */
  stored_in_latest_version: number;
  applied_changes: number;
  noops: number;
  failures: number;
  missing_before: number;
  stale_before: number;
  provisional_after_horizon: number;
  quarantined: number;
  consecutive_drift_runs: number;
  complete: boolean;
  error_code: ReconcileErrorCode | null;
  request_id: string | null;
  runtime_ms: number;
};

export type SweepDependencies = {
  now: () => Date;
  fetchPage: CallLogPageFetcher;
  apply: typeof applyInteractionObservation;
  directory: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  configuredAccountId: string | null;
  recordEvent: typeof recordOperationalEvent;
  owner: string;
  config: ReconcileConfig;
  requireFlag: boolean;
  /** Page ceiling for the sweep window (default 40 × 250 records). */
  maxPages: number;
};

type StoredRow = {
  _id: unknown;
  telephony_session_id?: string | null;
  call_log_ids?: string[];
  merged_into_id?: unknown;
  provider_last_modified_at?: Date | null;
  provider_result?: string | null;
  duration_seconds?: number | null;
  recordings?: Array<{ provider_recording_id?: string }>;
};

export type ProviderDrift = {
  kind: "missing" | "stale" | "current";
  newer: boolean;
  result_differs: boolean;
  duration_differs: boolean;
  recording_missing: boolean;
};

/**
 * The diff script's classification, pure. `canonical` is the stored row the
 * record resolves to (after following one merge), or null when none exists.
 */
export function classifyProviderRecord(record: CallLogRecordInput, canonical: StoredRow | null): ProviderDrift {
  if (!canonical) {
    return { kind: "missing", newer: false, result_differs: false, duration_differs: false, recording_missing: false };
  }
  const providerModified = typeof record.lastModifiedTime === "string" ? new Date(record.lastModifiedTime) : null;
  const storedModified = canonical.provider_last_modified_at ?? null;
  const newer = Boolean(providerModified && (!storedModified || providerModified > storedModified));
  const result_differs = (record.result ?? null) !== (canonical.provider_result ?? null);
  const duration_differs = typeof record.duration === "number" && record.duration !== canonical.duration_seconds;
  const stored = new Set((canonical.recordings ?? []).map((r) => r.provider_recording_id));
  const recording_missing = recordingIdsOf(record).some((id) => !stored.has(id));
  const stale = newer || result_differs || duration_differs || recording_missing;
  return { kind: stale ? "stale" : "current", newer, result_differs, duration_differs, recording_missing };
}

function recordingIdsOf(record: CallLogRecordInput): string[] {
  const legs = Array.isArray(record.legs) ? (record.legs as Array<{ recording?: unknown }>) : [];
  return [record.recording, ...legs.map((leg) => leg.recording)]
    .filter((r): r is { id: string } => !!r && typeof (r as { id?: unknown }).id === "string")
    .map((r) => r.id);
}

/** Stored canonical row per record, looked up the way the diff script does, in batched reads. */
async function storedRowsFor(
  records: readonly CallLogRecordInput[],
  accountId: string,
): Promise<Map<CallLogRecordInput, StoredRow | null>> {
  const collection = getCallInteractionModel().collection;
  const projection = {
    telephony_session_id: 1,
    call_log_ids: 1,
    merged_into_id: 1,
    provider_last_modified_at: 1,
    provider_result: 1,
    duration_seconds: 1,
    "recordings.provider_recording_id": 1,
  };
  const identities = records.map((record) => {
    try {
      return identityFromCallLogRecord(record);
    } catch {
      return null;
    }
  });
  const sessions = [...new Set(identities.flatMap((i) => (i?.telephony_session_id ? [i.telephony_session_id] : [])))];
  const logIds = [...new Set(identities.flatMap((i) => i?.call_log_ids ?? []))];
  const rows: StoredRow[] = [];
  const chunk = 500;
  for (let i = 0; i < Math.max(sessions.length, logIds.length); i += chunk) {
    const or: Record<string, unknown>[] = [];
    const s = sessions.slice(i, i + chunk);
    const l = logIds.slice(i, i + chunk);
    if (s.length) or.push({ telephony_session_id: { $in: s } });
    if (l.length) or.push({ call_log_ids: { $in: l } });
    if (!or.length) continue;
    rows.push(
      ...((await collection
        .find({ provider: "ringcentral", provider_account_id: accountId, $or: or }, { projection })
        .toArray()) as unknown as StoredRow[]),
    );
  }
  const bySession = new Map<string, StoredRow>();
  const byLogId = new Map<string, StoredRow>();
  for (const row of rows) {
    if (row.telephony_session_id && !bySession.has(row.telephony_session_id)) bySession.set(row.telephony_session_id, row);
    for (const id of row.call_log_ids ?? []) if (!byLogId.has(id)) byLogId.set(id, row);
  }
  const targets = new Map<string, StoredRow>();
  const ids = rows.filter((row) => row.merged_into_id).map((row) => row.merged_into_id);
  if (ids.length) {
    for (const row of (await collection.find({ _id: { $in: ids as never[] } }, { projection }).toArray()) as unknown as StoredRow[]) {
      targets.set(String(row._id), row);
    }
  }
  const out = new Map<CallLogRecordInput, StoredRow | null>();
  records.forEach((record, index) => {
    const identity = identities[index];
    let stored: StoredRow | null = null;
    if (identity?.telephony_session_id) stored = bySession.get(identity.telephony_session_id) ?? null;
    for (const id of identity?.call_log_ids ?? []) stored ??= byLogId.get(id) ?? null;
    const canonical = stored?.merged_into_id ? targets.get(String(stored.merged_into_id)) ?? null : stored;
    out.set(record, canonical);
  });
  return out;
}

export async function runCallLogSweepOnce(overrides: Partial<SweepDependencies> = {}): Promise<SweepSummary> {
  const config = overrides.config ?? callLogReconcileConfig();
  const deps: SweepDependencies = {
    now: () => new Date(),
    fetchPage: fetchDetailedCallLogPage,
    apply: applyInteractionObservation,
    directory: loadDirectoryLookup,
    configuredAccountId: configuredRingCentralAccountId(),
    recordEvent: recordOperationalEvent,
    owner: `csi-call-log-sweep:${randomBytes(8).toString("hex")}`,
    config,
    requireFlag: true,
    maxPages: Math.max(40, config.maxPages),
    ...overrides,
  };
  const startedAt = deps.now();
  const from = new Date(startedAt.getTime() - deps.config.sweepLookbackHours * 3_600_000);
  const to = new Date(startedAt.getTime() - deps.config.settleHorizonMinutes * 60_000);
  const summary: SweepSummary = {
    ran_at: startedAt.toISOString(),
    skipped: false,
    skip_reason: null,
    lease_owner_hash: null,
    from: from.toISOString(),
    to: to.toISOString(),
    pages: 0,
    provider_records: 0,
    stored_in_latest_version: 0,
    applied_changes: 0,
    noops: 0,
    failures: 0,
    missing_before: 0,
    stale_before: 0,
    provisional_after_horizon: 0,
    quarantined: 0,
    consecutive_drift_runs: 0,
    complete: false,
    error_code: null,
    request_id: null,
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
  const token = await leases.acquire({
    scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
    owner: deps.owner,
    ttl_ms: deps.config.leaseTtlMs,
    now: startedAt,
  });
  if (!token) {
    summary.skipped = true;
    summary.skip_reason = "lease_held";
    await deps.recordEvent(event("lease_contended", "info", summary.ran_at, { leaseOwnerHash: ownerHash }));
    return summary;
  }
  summary.lease_owner_hash = ownerHash;
  let lease: LeaseToken = token;
  let lastRenewAt = startedAt.getTime();
  const renewInterval = Math.max(1, Math.floor(deps.config.leaseTtlMs / 3));
  const renew = async () => {
    const at = deps.now().getTime();
    if (at - lastRenewAt < renewInterval) return;
    const renewed = await leases.renew({ token: lease, ttl_ms: deps.config.leaseTtlMs, now: deps.now() });
    if (!renewed) throw new SweepLeaseLostError();
    lease = renewed;
    lastRenewAt = at;
  };
  const runRequestId = randomBytes(12).toString("hex");
  summary.request_id = runRequestId;

  try {
    const collected: CallLogRecordInput[] = [];
    let fetchedAll = false;
    while (summary.pages < deps.maxPages) {
      await renew();
      let page: unknown[];
      try {
        page = await deps.fetchPage({ from, to, page: summary.pages + 1, perPage: deps.config.perPage });
      } catch (error) {
        summary.error_code = isProviderThrottle(error) ? "provider_throttled" : "provider_request_failed";
        break;
      }
      summary.pages += 1;
      collected.push(...page.filter(isRecord));
      if (page.length < deps.config.perPage) {
        fetchedAll = true;
        break;
      }
    }
    if (!fetchedAll && !summary.error_code) summary.error_code = "page_limit";
    summary.provider_records = collected.length;

    if (collected.length) {
      let accountId: string;
      try {
        accountId = resolveProviderAccountId(
          collected.map((r) => accountIdFromProviderPath(typeof r.uri === "string" ? r.uri : null)),
          deps.configuredAccountId,
        );
      } catch (error) {
        summary.error_code = error instanceof ProviderAccountError ? error.code : "unknown_error";
        accountId = "";
      }
      if (accountId) {
        const directory = await deps.directory(accountId);
        const resolveRoute = deps.resolveRoute ?? (await defaultRouteResolver());
        const before = await storedRowsFor(collected, accountId);
        for (const record of collected) {
          const drift = classifyProviderRecord(record, before.get(record) ?? null);
          if (drift.kind === "missing") summary.missing_before += 1;
          else if (drift.kind === "stale") summary.stale_before += 1;
          else summary.stored_in_latest_version += 1;
        }
        const ordered = [...collected].sort((a, b) => startMs(a) - startMs(b));
        for (const record of ordered) {
          await renew();
          try {
            const applied = await deps.apply(
              accountId,
              { kind: "call_log", record, proof_ref: `call_log:${typeof record.id === "string" ? record.id : "unknown"}`, source: "call_log_reconcile" },
              // INTEGRATION: pass `settleHorizonMinutes: deps.config.settleHorizonMinutes` (CC-04).
              { now: deps.now, directory, resolveRoute, request_id: runRequestId },
            );
            if (applied.noop) summary.noops += 1;
            else summary.applied_changes += 1;
          } catch (error) {
            summary.failures += 1;
            summary.error_code ??= "projection_failed";
            logger.warn({ msg: "sales_intelligence.call_log_sweep.record_failed", leaseOwnerHash: ownerHash, ...failureLogFields(error) });
          }
        }
      }
    }
    summary.complete = fetchedAll && summary.error_code === null;

    const [provisional, reconcileRow, previous] = await Promise.all([
      getCallInteractionModel().collection.countDocuments({
        call_log_state: "provisional",
        merged_into_id: null,
        started_at: { $gte: from, $lte: to },
      }),
      Model.findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }, { quarantined_records: 1 }).lean(),
      Model.findOne({ scope: CALL_LOG_SWEEP_SCOPE }, { consecutive_drift_runs: 1 }).lean(),
    ]);
    summary.provisional_after_horizon = provisional;
    summary.quarantined = (reconcileRow as { quarantined_records?: unknown[] } | null)?.quarantined_records?.length ?? 0;
    const drift = summary.missing_before + summary.stale_before > 0;
    const priorDrift = (previous as { consecutive_drift_runs?: number } | null)?.consecutive_drift_runs ?? 0;
    // Only a complete sweep measures completeness; an interrupted one keeps the streak as it was.
    summary.consecutive_drift_runs = summary.complete ? (drift ? priorDrift + 1 : 0) : priorDrift;

    // Hand the lease back before writing our own row; a fenced release that
    // fails means a reconcile run already took over, which is harmless here.
    await renew();
    const finishedAt = deps.now();
    summary.runtime_ms = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    await Model.updateOne(
      { scope: CALL_LOG_SWEEP_SCOPE },
      {
        $set: {
          consecutive_drift_runs: summary.consecutive_drift_runs,
          ...(summary.complete ? { consecutive_failures: 0 } : {}),
          last_run: {
            started_at: startedAt,
            finished_at: finishedAt,
            runtime_ms: summary.runtime_ms,
            pages: summary.pages,
            records: summary.provider_records,
            upserts: summary.applied_changes,
            throttled_count: summary.error_code === "provider_throttled" ? 1 : 0,
            error_code: summary.error_code,
            from,
            to,
            provider_records: summary.provider_records,
            stored_in_latest_version: summary.stored_in_latest_version,
            applied_changes: summary.applied_changes,
            missing_before: summary.missing_before,
            stale_before: summary.stale_before,
            provisional_after_horizon: summary.provisional_after_horizon,
            quarantined: summary.quarantined,
            failures: summary.failures,
          },
        },
        ...(summary.complete ? {} : { $inc: { consecutive_failures: 1 } }),
      },
      { upsert: true },
    );
    await leases.release({ token: lease, now: finishedAt }).catch(() => undefined);

    const details = {
      leaseOwnerHash: ownerHash,
      from: summary.from,
      to: summary.to,
      providerRecords: summary.provider_records,
      storedInLatestVersion: summary.stored_in_latest_version,
      appliedChanges: summary.applied_changes,
      missingBefore: summary.missing_before,
      staleBefore: summary.stale_before,
      provisionalAfterHorizon: summary.provisional_after_horizon,
      quarantined: summary.quarantined,
      failures: summary.failures,
      consecutiveDriftRuns: summary.consecutive_drift_runs,
      errorCode: summary.error_code,
      runtimeMs: summary.runtime_ms,
    };
    if (summary.complete && drift) {
      // Two consecutive nights with drift → notification (D7).
      await deps.recordEvent(
        event("sweep_found_drift", "warn", summary.ran_at, details, summary.consecutive_drift_runs >= 2),
      );
    }
    await deps.recordEvent(event(summary.complete ? "completed" : "failed", summary.complete ? "info" : "warn", summary.ran_at, details));
    return summary;
  } catch (error) {
    summary.runtime_ms = Math.max(0, deps.now().getTime() - startedAt.getTime());
    summary.error_code = error instanceof SweepLeaseLostError ? "lease_lost" : "state_write_failed";
    logger.error({ msg: "sales_intelligence.call_log_sweep.failed", leaseOwnerHash: ownerHash, ...failureLogFields(error) });
    await leases.release({ token: lease, now: deps.now() }).catch(() => undefined);
    await deps.recordEvent(event("failed", "error", summary.ran_at, { leaseOwnerHash: ownerHash, errorCode: summary.error_code }));
    return summary;
  }
}

class SweepLeaseLostError extends Error {
  constructor() {
    super("CSI Call Log sweep lease lost");
    this.name = "SweepLeaseLostError";
  }
}

function event(
  kind: "completed" | "failed" | "lease_contended" | "sweep_found_drift",
  level: "info" | "warn" | "error",
  runId: string,
  details: Record<string, unknown>,
  notify = kind === "failed" && level === "error",
) {
  return {
    level,
    eventKey: `sales_intelligence.call_log_sweep.${kind}`,
    category: "ringcentral" as const,
    workflow: "sales_intelligence",
    summary: `Nightly Call Log sweep ${kind.replace(/_/g, " ")}.`,
    runId,
    details,
    notificationCandidate: notify,
    reportable: false,
    piiPolicy: "none" as const,
  };
}

function isRecord(value: unknown): value is CallLogRecordInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function startMs(record: CallLogRecordInput): number {
  const start = typeof record.startTime === "string" ? new Date(record.startTime).getTime() : Number.NaN;
  return Number.isNaN(start) ? Number.POSITIVE_INFINITY : start;
}
