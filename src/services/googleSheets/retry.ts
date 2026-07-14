import { logger } from "../../logger";
import { formatGoogleApiError } from "./diagnostics";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 32_000;

const RETRYABLE_STATUS = new Set([429, 503]);
const RETRYABLE_REASONS = new Set([
  "ratelimitexceeded",
  "userratelimitexceeded",
  "quotaexceeded",
  "backenderror",
]);

/**
 * Runs a Google Sheets API call with exponential backoff retries on transient
 * rate-limit / quota errors (HTTP 429, and 503 backend blips).
 *
 * The Sheets API enforces a per-minute write-request quota per user; a burst of
 * lead syncs can momentarily exceed it and return 429. Without retry the row is
 * left stale until the next manual edit, which is exactly the source-sheet
 * "did not update" symptom. Retrying with backoff lets the quota window reset
 * and the write to land on its own.
 */
export async function withSheetsRetry<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > MAX_RETRIES || !isRetryableSheetsError(error)) {
        throw error;
      }
      const delayMs = computeBackoffDelayMs(error, attempt);
      const details = formatGoogleApiError(error);
      logger.warn({
        msg: "sheets.retry.backoff",
        operation,
        attempt,
        maxRetries: MAX_RETRIES,
        delayMs,
        googleStatus: details.status ?? null,
        googleReasons: details.reasons,
      });
      await sleep(delayMs);
    }
  }
}

export function isRetryableSheetsError(error: unknown): boolean {
  const details = formatGoogleApiError(error);
  const status = typeof details.status === "number" ? details.status : Number(details.code);
  if (RETRYABLE_STATUS.has(status)) {
    return true;
  }

  if (details.reasons.some((reason) => RETRYABLE_REASONS.has(reason.toLowerCase()))) {
    return true;
  }

  return details.message.toLowerCase().includes("quota exceeded");
}

function computeBackoffDelayMs(error: unknown, attempt: number): number {
  const retryAfterMs = parseRetryAfterMs(error);
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, MAX_DELAY_MS);
  }

  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * BASE_DELAY_MS);
  return exponential + jitter;
}

function parseRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const response = (error as { response?: { headers?: Record<string, unknown> } }).response;
  const header = response?.headers?.["retry-after"];
  if (header === undefined || header === null) {
    return undefined;
  }
  const seconds = Number(Array.isArray(header) ? header[0] : header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
