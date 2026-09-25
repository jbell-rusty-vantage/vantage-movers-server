import { ringCentralRequest, RingCentralApiError } from "../ringcentral/client";

/**
 * All-direction Detailed Call Log page fetch. Deliberately separate from the
 * qualified-call sync's inbound-only helper (03 §3 allows this ~30-line
 * duplication); it shares the same JWT token store and request adapter, so a
 * 429 in either worker is the same provider throttle.
 */
export type CallLogPageInput = {
  from: Date;
  to: Date;
  page: number;
  perPage: number;
};

export type CallLogPageFetcher = (input: CallLogPageInput) => Promise<unknown[]>;

export async function fetchDetailedCallLogPage(input: CallLogPageInput): Promise<unknown[]> {
  const query = new URLSearchParams({
    dateFrom: input.from.toISOString(),
    dateTo: input.to.toISOString(),
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

export function isProviderThrottle(error: unknown): boolean {
  return error instanceof RingCentralApiError && error.status === 429;
}

/**
 * Retry-After is honored when the error carries it (`retryAfterMs`). The shared
 * client sets it from `Retry-After` / `X-Rate-Limit-Window` on a provider 429,
 * and from the remaining wait when the shared rate gate refused the send
 * (`rateLimitGate.ts`); otherwise the documented ten-minute default applies.
 */
export function throttleRetryAfterMs(error: unknown, fallbackMs = 10 * 60_000): number {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return providerSuppliedRetryAfter(error) ? (value as number) : fallbackMs;
}

/** True only when the error actually carried a usable `retryAfterMs`; otherwise the wait is the documented default. */
export function providerSuppliedRetryAfter(error: unknown): boolean {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * One Call Log record re-read by id (`GET /account/~/call-log/{id}?view=Detailed`).
 * Returns null when the provider no longer knows the id (404). Used for
 * quarantine retries and straggler settles, one request each.
 */
export type CallLogRecordFetcher = (id: string) => Promise<unknown | null>;

export async function fetchDetailedCallLogRecord(id: string): Promise<unknown | null> {
  try {
    return await ringCentralRequest(
      "GET",
      `/restapi/v1.0/account/~/call-log/${encodeURIComponent(id)}?view=Detailed`,
    );
  } catch (error) {
    if (error instanceof RingCentralApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Account Call Log Sync (`GET /account/~/call-log-sync`). `FSync` bootstraps
 * from a start date and returns a `syncToken`; `ISync` returns records
 * *modified* since that token regardless of their start time. The token is
 * provider state, not a secret, but it is kept out of logs and summaries.
 */
export type CallLogSyncInput =
  | { syncType: "FSync"; dateFrom: Date; recordCount: number }
  | { syncType: "ISync"; syncToken: string };

export type CallLogSyncPage = {
  records: unknown[];
  syncType: "FSync" | "ISync" | null;
  syncToken: string | null;
  syncTime: Date | null;
};

export type CallLogSyncFetcher = (input: CallLogSyncInput) => Promise<CallLogSyncPage>;

export async function fetchCallLogSync(input: CallLogSyncInput): Promise<CallLogSyncPage> {
  const query = new URLSearchParams(
    input.syncType === "FSync"
      ? {
          syncType: "FSync",
          view: "Detailed",
          recordCount: String(input.recordCount),
          dateFrom: input.dateFrom.toISOString(),
        }
      : { syncType: "ISync", syncToken: input.syncToken, view: "Detailed" },
  );
  const payload = await ringCentralRequest(
    "GET",
    `/restapi/v1.0/account/~/call-log-sync?${query.toString()}`,
  );
  return parseCallLogSyncPayload(payload);
}

export function parseCallLogSyncPayload(payload: unknown): CallLogSyncPage {
  const body = (payload ?? {}) as { records?: unknown; syncInfo?: Record<string, unknown> };
  const info = body.syncInfo ?? {};
  const syncType = info.syncType === "FSync" || info.syncType === "ISync" ? info.syncType : null;
  const token = typeof info.syncToken === "string" && info.syncToken.trim() ? info.syncToken : null;
  const time = typeof info.syncTime === "string" ? new Date(info.syncTime) : null;
  return {
    records: Array.isArray(body.records) ? body.records : [],
    syncType,
    syncToken: token,
    syncTime: time && !Number.isNaN(time.getTime()) ? time : null,
  };
}

/**
 * RingCentral answers an expired or unknown `syncToken` with a 400 (or a
 * `CLG-*` error code). Either means "start over with FSync", not an outage.
 */
export function isSyncTokenExpired(error: unknown): boolean {
  if (!(error instanceof RingCentralApiError)) return false;
  if (error.status === 400) return true;
  const code = (error.responseBody as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" && code.startsWith("CLG-");
}
