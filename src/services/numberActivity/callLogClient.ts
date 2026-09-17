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
 * Retry-After is honored when a caller surfaces it (`retryAfterMs`). The shared
 * client does not expose response headers today, so the default is the
 * documented ten-minute posture rather than a guessed shorter wait.
 */
export function throttleRetryAfterMs(error: unknown, fallbackMs = 10 * 60_000): number {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallbackMs;
}
