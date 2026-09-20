import { createHash, randomBytes } from "node:crypto";
import { logger } from "../../logger";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore, type MongoLeaseModel } from "../durableWork/leases";
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
  providerSuppliedRetryAfter,
  throttleRetryAfterMs,
  type CallLogPageFetcher,
} from "./callLogClient";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import {
  applyInteractionObservation,
  defaultRouteResolver,
  InteractionPersistenceError,
} from "./persistInteraction";
import type { CallLogRecordInput } from "./interactionProjection";
import type { RouteResolver } from "./types";
import { RingCentralApiError } from "../ringcentral/client";

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
 * Coverage honesty: the cursor and `known_complete_through` advance only when
 * every page of the rolling window was fetched and every record projected.
 * Any interruption (throttle, provider error, page budget, projection
 * failure, account resolution) leaves the cursor where it was and records a
 * bounded gap `{from, to, reason}`. Later runs repair gaps oldest-first with
 * leftover page budget; a gap closes only when its window completes.
 */
export const CALL_LOG_ALL_DIRECTIONS_SCOPE = "call_log_all_directions";

export type ReconcileConfig = {
  rollingLookbackMinutes: number;
  overlapMinutes: number;
  maxPages: number;
  perPage: number;
  finalizationLagMinutes: number;
  leaseTtlMs: number;
};

export function callLogReconcileConfig(): ReconcileConfig {
  const int = (name: string, fallback: number, min: number) => {
    const raw = process.env[`SALES_INTELLIGENCE_${name}`]?.trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
  };
  return {
    // Twelve-hour floor, same rationale as the qualified-call sync.
    rollingLookbackMinutes: Math.max(720, int("CALL_LOG_ROLLING_LOOKBACK_MINUTES", 720, 1)),
    overlapMinutes: int("CALL_LOG_OVERLAP_MINUTES", 15, 0),
    maxPages: int("CALL_LOG_MAX_PAGES", 20, 1),
    perPage: 250,
    finalizationLagMinutes: 15,
    leaseTtlMs: 300_000,
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
  complete: boolean;
  /** For `page_limit`: records older than this instant were not fetched. */
  incomplete_before: Date | null;
  error_code: ReconcileErrorCode | null;
};

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
  apply: typeof applyInteractionObservation;
  directory: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  configuredAccountId: string | null;
  recordEvent: typeof recordOperationalEvent;
  owner: string;
  config: ReconcileConfig;
  requireFlag: boolean;
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

export async function runCallLogReconcileOnce(
  overrides: Partial<ReconcileDependencies> = {},
): Promise<ReconcileSummary> {
  const deps: ReconcileDependencies = {
    now: () => new Date(),
    fetchPage: fetchDetailedCallLogPage,
    apply: applyInteractionObservation,
    directory: loadDirectoryLookup,
    configuredAccountId: configuredRingCentralAccountId(),
    recordEvent: recordOperationalEvent,
    owner: `csi-call-log:${randomBytes(8).toString("hex")}`,
    config: callLogReconcileConfig(),
    requireFlag: true,
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
  const leaseModel: MongoLeaseModel = {
    findOneAndUpdate: (filter, update, options) =>
      Model.findOneAndUpdate(filter, update, { ...options, lean: true }) as never,
    updateOne: (filter, update) => Model.updateOne(filter, update),
    findOne: (filter) => Model.findOne(filter).lean() as never,
  };
  const leases = new MongoLeaseStore(leaseModel);
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
    summary.runtime_ms = elapsed(startedAt, deps.now());
    await deps.recordEvent(event("lease_contended", "info", summary.ran_at, { leaseOwnerHash: ownerHash }));
    return summary;
  }
  summary.lease_owner_hash = ownerHash;
  let lease: LeaseToken = token;

  const state = ((await Model.findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }).lean()) ??
    {}) as StoredState;
  const windowTo = startedAt;
  const windowFrom = resolveWindowStart(windowTo, state, deps.config);
  summary.window_from = windowFrom.toISOString();
  summary.window_to = windowTo.toISOString();
  await deps.recordEvent(
    event("started", "info", summary.ran_at, {
      leaseOwnerHash: ownerHash,
      windowFrom: summary.window_from,
      windowTo: summary.window_to,
      openGaps: state.gaps?.length ?? 0,
    }),
  );

  const renew = async () => {
    const renewed = await leases.renew({ token: lease, ttl_ms: deps.config.leaseTtlMs, now: deps.now() });
    if (!renewed) throw new LeaseLostError();
    lease = renewed;
  };

  let pageBudget = deps.config.maxPages;
  let accountId: string | null = null;
  let directory: DirectoryLookup | null = null;
  let resolveRoute = deps.resolveRoute;
  let providerWatermark: Date | null = state.cursor?.provider_modified_watermark ?? null;
  // One request id per reconcile run so every audit row it writes ties back
  // to this run (surfaced in the summary for operators).
  const runRequestId = randomBytes(12).toString("hex");
  summary.request_id = runRequestId;

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
          summary.throttled_count += 1;
          summary.throttle_retry_after_ms = throttleRetryAfterMs(error);
          summary.throttle_retry_after_observed = providerSuppliedRetryAfter(error);
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

    if (collected.length) {
      try {
        accountId ??= resolveProviderAccountId(
          collected.map((r) => accountIdFromProviderPath(str(r.uri))),
          deps.configuredAccountId,
        );
      } catch (error) {
        result.error_code = error instanceof ProviderAccountError ? error.code : "unknown_error";
        return result;
      }
      directory ??= await deps.directory(accountId);
      resolveRoute ??= await defaultRouteResolver();
      // Oldest-first so earlier evidence lands before later callbacks.
      const ordered = [...collected].sort(
        (a, b) => (startOf(a)?.getTime() ?? Number.POSITIVE_INFINITY) - (startOf(b)?.getTime() ?? Number.POSITIVE_INFINITY),
      );
      for (const record of ordered) {
        await renew();
        try {
          const applied = await deps.apply(
            accountId,
            { kind: "call_log", record, proof_ref: `call_log:${str(record.id) ?? "unknown"}`, source: "call_log_reconcile" },
            { now: deps.now, directory, resolveRoute, request_id: runRequestId },
          );
          if (applied.noop) result.noops += 1;
          else result.upserts += 1;
          const modified = dateOf(record.lastModifiedTime);
          if (modified && (!providerWatermark || modified > providerWatermark)) providerWatermark = modified;
        } catch (error) {
          result.failures += 1;
          result.error_code ??= error instanceof InteractionPersistenceError && error.code === "account_mismatch"
            ? "account_mismatch"
            : "projection_failed";
          logger.warn({
            msg: "sales_intelligence.call_log_reconcile.record_failed",
            leaseOwnerHash: ownerHash,
            errorName: error instanceof Error ? error.name : "Error",
            errorCode: error instanceof InteractionPersistenceError ? error.code : "unknown",
          });
        }
      }
    }
    result.complete = fetchedAll && result.failures === 0 && result.error_code === null;
    return result;
  };

  try {
    const rolling = await runWindow("rolling", windowFrom, windowTo);
    summary.windows.push(rolling);
    // Oldest gaps first, only with leftover budget and only when not already inside the rolling window.
    const openGaps = [...(state.gaps ?? [])]
      .filter((gap) => !(gap.from >= windowFrom && gap.to <= windowTo))
      .sort((a, b) => a.from.getTime() - b.from.getTime());
    const skipRepair =
      rolling.error_code === "provider_throttled" ||
      rolling.error_code === "account_unresolved" ||
      rolling.error_code === "account_mismatch";
    for (const gap of openGaps) {
      // A throttle anywhere in this run (including a previous gap repair) ends
      // the run; the provider asked us to back off, not to try the next window.
      if (pageBudget <= 0 || skipRepair || summary.throttled_count > 0) break;
      summary.windows.push(await runWindow("gap_repair", gap.from, gap.to));
    }

    for (const w of summary.windows) {
      summary.pages += w.pages;
      summary.records += w.records;
      summary.upserts += w.upserts;
      summary.noops += w.noops;
      summary.failures += w.failures;
    }

    const finishedAt = deps.now();
    const next = nextState(state, summary.windows, windowTo, finishedAt, deps.config);
    // The provider-modified watermark is diagnostic today, but it must never
    // advance past evidence this run did not fully observe: a partial run
    // keeps the prior value so a future incremental reader cannot inherit a
    // silent gap.
    const everyWindowComplete = summary.windows.every((w) => w.complete);
    const nextWatermark = everyWindowComplete
      ? providerWatermark
      : state.cursor?.provider_modified_watermark ?? null;
    summary.cursor_advanced = next.cursor_advanced;
    summary.known_complete_through = next.known_complete_through?.toISOString() ?? null;
    summary.gaps_after = next.gaps.length;
    summary.error_code = rolling.complete ? null : rolling.error_code;
    summary.runtime_ms = elapsed(startedAt, finishedAt);

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
          consecutive_failures: rolling.complete ? 0 : (state.consecutive_failures ?? 0) + 1,
          last_run: {
            started_at: startedAt,
            finished_at: finishedAt,
            runtime_ms: summary.runtime_ms,
            pages: summary.pages,
            records: summary.records,
            upserts: summary.upserts,
            throttled_count: summary.throttled_count,
            error_code: summary.error_code,
          },
          lease_owner: null,
          leased_until: finishedAt,
        },
      },
    );
    if (written.modifiedCount !== 1) throw new LeaseLostError();

    for (const opened of next.opened) {
      await deps.recordEvent(
        event("gap_opened", "warn", summary.ran_at, {
          leaseOwnerHash: ownerHash,
          from: opened.from.toISOString(),
          to: opened.to.toISOString(),
          reason: opened.reason,
        }),
      );
    }
    for (const closed of next.closed) {
      await deps.recordEvent(
        event("gap_closed", "info", summary.ran_at, {
          leaseOwnerHash: ownerHash,
          from: closed.from.toISOString(),
          to: closed.to.toISOString(),
        }),
      );
    }
    await deps.recordEvent(
      event(rolling.complete ? "completed" : "failed", rolling.complete ? "info" : "warn", summary.ran_at, {
        leaseOwnerHash: ownerHash,
        windowFrom: summary.window_from,
        windowTo: summary.window_to,
        pages: summary.pages,
        records: summary.records,
        upserts: summary.upserts,
        noops: summary.noops,
        failures: summary.failures,
        throttledCount: summary.throttled_count,
        cursorAdvanced: summary.cursor_advanced,
        knownCompleteThrough: summary.known_complete_through,
        gapsAfter: summary.gaps_after,
        errorCode: summary.error_code,
        runtimeMs: summary.runtime_ms,
      }),
    );
    return summary;
  } catch (error) {
    summary.runtime_ms = elapsed(startedAt, deps.now());
    if (error instanceof LeaseLostError) {
      summary.error_code = "lease_lost";
      summary.cursor_advanced = false;
      summary.known_complete_through = null;
      summary.gaps_after = state.gaps?.length ?? 0;
      logger.warn({ msg: "sales_intelligence.call_log_reconcile.lease_lost", leaseOwnerHash: ownerHash });
      await deps.recordEvent(event("failed", "warn", summary.ran_at, { leaseOwnerHash: ownerHash, errorCode: "lease_lost" }));
      return summary;
    }
    summary.error_code = "state_write_failed";
    logger.error({
      msg: "sales_intelligence.call_log_reconcile.failed",
      leaseOwnerHash: ownerHash,
      errorName: error instanceof Error ? error.name : "Error",
    });
    // Best-effort fenced release; the state and cursor stay untouched.
    try {
      await leases.release({ token: lease, now: deps.now() });
    } catch {
      /* lease expiry is the recovery path */
    }
    await deps.recordEvent(event("failed", "error", summary.ran_at, { leaseOwnerHash: ownerHash, errorCode: summary.error_code }));
    return summary;
  }
}

/** min(cursor.last_sync_to − overlap, now − rolling lookback); first run uses the lookback alone. */
export function resolveWindowStart(windowTo: Date, state: StoredState, config: ReconcileConfig): Date {
  const rollingStart = new Date(windowTo.getTime() - config.rollingLookbackMinutes * 60_000);
  const lastTo = state.cursor?.last_sync_to ?? null;
  if (!lastTo) return rollingStart;
  const cursorStart = new Date(lastTo.getTime() - config.overlapMinutes * 60_000);
  return cursorStart <= rollingStart ? cursorStart : rollingStart;
}

export function nextState(
  state: StoredState,
  windows: WindowResult[],
  windowTo: Date,
  now: Date,
  config: ReconcileConfig,
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

  for (const w of windows) {
    if (w.complete) {
      const covered = gaps.filter((g) => g.from >= w.from && g.to <= w.to);
      closed.push(...covered);
      gaps = gaps.filter((g) => !covered.includes(g));
      if (w.kind === "rolling") {
        cursorAdvanced = true;
        const candidate = new Date(windowTo.getTime() - config.finalizationLagMinutes * 60_000);
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

function event(
  kind: "started" | "completed" | "failed" | "lease_contended" | "gap_opened" | "gap_closed",
  level: "info" | "warn" | "error",
  runId: string,
  details: Record<string, unknown>,
) {
  return {
    level,
    eventKey: `sales_intelligence.call_log_reconcile.${kind}`,
    category: "ringcentral" as const,
    workflow: "sales_intelligence",
    summary: `All-direction Call Log reconcile ${kind.replace("_", " ")}.`,
    runId,
    details,
    notificationCandidate: kind === "failed" && level === "error",
    reportable: false,
    piiPolicy: "none" as const,
  };
}

function elapsed(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

function isRecord(value: unknown): value is CallLogRecordInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dateOf(value: unknown): Date | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOf(record: CallLogRecordInput): Date | null {
  return dateOf(record.startTime);
}

function earliestStart(records: CallLogRecordInput[]): Date | null {
  let out: Date | null = null;
  for (const record of records) {
    const start = startOf(record);
    if (start && (!out || start < out)) out = start;
  }
  return out;
}

export const BACKFILL_LEASE_SCOPE = "backfill";
export const RETENTION_LEASE_SCOPE = "retention";

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
        { now, directory, resolveRoute, request_id: input.request_id },
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
