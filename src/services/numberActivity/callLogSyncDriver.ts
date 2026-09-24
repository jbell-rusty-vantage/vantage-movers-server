import {
  isProviderThrottle,
  isSyncTokenExpired,
  providerSuppliedRetryAfter,
  throttleRetryAfterMs,
  type CallLogSyncFetcher,
  type CallLogSyncInput,
  type CallLogSyncPage,
} from "./callLogClient";
import type { CallLogRecordInput } from "./interactionProjection";

/**
 * CC-05: account Call Log Sync as the incremental driver.
 *
 * RingCentral filters `/call-log` by **start** time, so a record that changes
 * after its start has left the window is never fetched again. `ISync` returns
 * records **modified** since a durable `syncToken`, whatever their start
 * (verified in production 2026-09-23). This step runs inside the reconcile
 * lease, before the start-time window:
 *
 * - no token, or a token older than 24 h → `FSync` from
 *   `min(cursor.last_sync_to, now − settle horizon)`, then `ISync` with each
 *   returned token while a page comes back full;
 * - otherwise `ISync` with the stored token; a 400 / `CLG-*` answer is token
 *   expiry and falls back to `FSync` in the same run.
 *
 * `shadow` counts the records that would change against stored rows and
 * applies nothing (the window stays authoritative); its token chain still
 * advances so the comparison stays incremental. `on` applies every record
 * and stores the new token **only** when every record applied or was
 * quarantined, the same completeness rule as a window.
 */
export type CallLogSyncMode = "off" | "shadow" | "on";

export type StoredCallLogSync = {
  token?: string | null;
  sync_time?: Date | null;
  last_full_sync_at?: Date | null;
  consecutive_expiries?: number;
} | null;

export type SyncApplyOutcome = {
  upserts: number;
  noops: number;
  failures: number;
  quarantined: number;
  /** Every record applied or was quarantined. */
  settled: boolean;
};

export type SyncStepErrorCode = "provider_throttled" | "provider_request_failed" | "projection_failed";

export type SyncStepResult = {
  mode: "shadow" | "on";
  sync_type: "FSync" | "ISync" | null;
  requests: number;
  records: number;
  /** Shadow: records whose stored row would change. On: records not skipped as unchanged. */
  changed: number;
  applied: number;
  failures: number;
  quarantined: number;
  expired: boolean;
  token_stored: boolean;
  error_code: SyncStepErrorCode | null;
  throttle_retry_after_ms: number | null;
  throttle_retry_after_observed: boolean;
  /** Provider time the stored token reflects; null when no token was stored this run. */
  sync_time: Date | null;
  /** State to persist; null leaves the stored value untouched. */
  next: NonNullable<StoredCallLogSync> | null;
};

export const CALL_LOG_SYNC_TOKEN_MAX_AGE_MS = 24 * 3_600_000;

export async function runCallLogSyncStep(input: {
  mode: "shadow" | "on";
  state: StoredCallLogSync | undefined;
  now: Date;
  fsyncFrom: Date;
  recordCount: number;
  /** Provider requests this step may spend (shared page budget). */
  budget: number;
  fetchSync: CallLogSyncFetcher;
  /** Shadow: how many of these records would change the stored rows. */
  countChanged: (records: CallLogRecordInput[]) => Promise<number>;
  /** On: the reconcile's apply path (per-row skip, quarantine). */
  apply: (records: CallLogRecordInput[]) => Promise<SyncApplyOutcome & { changed: number }>;
}): Promise<SyncStepResult> {
  const prev = input.state ?? null;
  const result: SyncStepResult = {
    mode: input.mode,
    sync_type: null,
    requests: 0,
    records: 0,
    changed: 0,
    applied: 0,
    failures: 0,
    quarantined: 0,
    expired: false,
    token_stored: false,
    error_code: null,
    throttle_retry_after_ms: null,
    throttle_retry_after_observed: false,
    sync_time: null,
    next: null,
  };
  const expiries = prev?.consecutive_expiries ?? 0;
  const tokenAge = prev?.sync_time ? input.now.getTime() - prev.sync_time.getTime() : Number.POSITIVE_INFINITY;
  let full = !prev?.token || !(tokenAge <= CALL_LOG_SYNC_TOKEN_MAX_AGE_MS);

  const collected: CallLogRecordInput[] = [];
  // Assigned inside `fetch`; the cast keeps TS from narrowing it to null.
  let last = null as CallLogSyncPage | null;
  const fetch = async (request: CallLogSyncInput) => {
    result.requests += 1;
    const page = await input.fetchSync(request);
    collected.push(...page.records.filter(isVoiceRecord));
    last = page;
    return page;
  };

  try {
    if (!full) {
      if (input.budget <= 0) return result;
      try {
        await fetch({ syncType: "ISync", syncToken: prev!.token! });
        result.sync_type = "ISync";
      } catch (error) {
        if (!isSyncTokenExpired(error)) throw error;
        result.expired = true;
        full = true;
      }
    }
    if (full) {
      if (result.requests >= input.budget) {
        result.next = result.expired ? { ...(prev ?? {}), token: null, consecutive_expiries: expiries + 1 } : null;
        return result;
      }
      await fetch({ syncType: "FSync", dateFrom: input.fsyncFrom, recordCount: input.recordCount });
      result.sync_type = "FSync";
    }
    // A full page means more is waiting behind the returned token.
    while (
      last!.records.length >= input.recordCount &&
      last!.syncToken &&
      result.requests < input.budget
    ) {
      await fetch({ syncType: "ISync", syncToken: last!.syncToken });
    }
  } catch (error) {
    if (isProviderThrottle(error)) {
      result.error_code = "provider_throttled";
      result.throttle_retry_after_ms = throttleRetryAfterMs(error);
      result.throttle_retry_after_observed = providerSuppliedRetryAfter(error);
    } else {
      result.error_code = "provider_request_failed";
    }
    // Nothing applied from a broken chain; an expired token is dropped so the
    // next run bootstraps directly instead of spending a request on it again.
    result.next = result.expired ? { ...(prev ?? {}), token: null, consecutive_expiries: expiries + 1 } : null;
    return result;
  }

  const page = last;
  result.records = collected.length;
  if (!page?.syncToken) {
    result.error_code = "provider_request_failed";
    result.next = result.expired ? { ...(prev ?? {}), token: null, consecutive_expiries: expiries + 1 } : null;
    return result;
  }

  let storeToken: boolean;
  if (input.mode === "shadow") {
    result.changed = collected.length ? await input.countChanged(collected) : 0;
    storeToken = true;
  } else {
    const outcome = collected.length
      ? await input.apply(collected)
      : { upserts: 0, noops: 0, failures: 0, quarantined: 0, settled: true, changed: 0 };
    result.changed = outcome.changed;
    result.applied = outcome.upserts;
    result.failures = outcome.failures;
    result.quarantined = outcome.quarantined;
    storeToken = outcome.settled;
    if (!outcome.settled) result.error_code = "projection_failed";
  }

  const syncTime = page.syncTime ?? input.now;
  if (storeToken) {
    result.token_stored = true;
    result.sync_time = syncTime;
    result.next = {
      token: page.syncToken,
      sync_time: syncTime,
      last_full_sync_at: result.sync_type === "FSync" ? input.now : prev?.last_full_sync_at ?? null,
      consecutive_expiries: result.expired ? expiries + 1 : result.sync_type === "ISync" ? 0 : expiries,
    };
  } else {
    // The old token replays the same changes next run; an expired one cannot.
    result.next = result.expired ? { ...(prev ?? {}), token: null, consecutive_expiries: expiries + 1 } : null;
  }
  return result;
}

function isVoiceRecord(value: unknown): value is CallLogRecordInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  // Call Log Sync has no type filter; fax and SMS entries are not calls.
  return type === undefined || type === null || type === "Voice";
}

export function parseCallLogSyncMode(raw: string | undefined): CallLogSyncMode {
  const value = raw?.trim().toLowerCase();
  if (value === "on" || value === "true") return "on";
  if (value === "shadow") return "shadow";
  return "off";
}
