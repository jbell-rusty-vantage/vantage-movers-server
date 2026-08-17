export const TECHNICAL_RETRY_BASE_MS = 30_000;
export const TECHNICAL_RETRY_CAP_MS = 6 * 60 * 60 * 1000;
export const TECHNICAL_RETRY_JITTER_MAX = 0.25;
export const TECHNICAL_DEAD_LETTER_ATTEMPT = 10;
export const PENDING_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SYNC_POLL_DEADLINE_MS = 5_000;
export const CLAIM_BATCH_SIZE = 20;
export const CLAIM_CONCURRENCY = 4;
export const LEASE_DURATION_MS = 5 * 60 * 1000;
export const LEASE_RENEW_INTERVAL_MS = 2 * 60 * 1000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Absolute offsets from immutable `captured_at` for the business pending-match
 * clock. Index 0 is the first (immediate) attempt already due at capture.
 * After a successful `pending_match` at match_attempt N, the next due uses
 * offset N+1. There is no offset past 24 hours.
 */
export const PENDING_MATCH_OFFSETS_MS = [
  0,
  1 * MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  1 * HOUR,
  2 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
] as const;

export function technicalRetryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exp = Math.max(0, attempt - 1);
  const base = Math.min(TECHNICAL_RETRY_CAP_MS, TECHNICAL_RETRY_BASE_MS * 2 ** exp);
  const jitterRatio = clampUnitInterval(random()) * TECHNICAL_RETRY_JITTER_MAX;
  return Math.floor(base * (1 + jitterRatio));
}

export function nextPendingMatchDueAt(
  capturedAt: Date,
  matchAttemptAfterIncrement: number,
): Date | null {
  if (
    matchAttemptAfterIncrement < 0 ||
    matchAttemptAfterIncrement >= PENDING_MATCH_OFFSETS_MS.length
  ) {
    return null;
  }
  return new Date(
    capturedAt.getTime() + PENDING_MATCH_OFFSETS_MS[matchAttemptAfterIncrement],
  );
}

export function shouldCompletePendingMatch(input: {
  capturedAt: Date;
  now: Date;
  matchAttemptAfterIncrement: number;
}): boolean {
  if (input.now.getTime() >= input.capturedAt.getTime() + PENDING_MATCH_WINDOW_MS) {
    return true;
  }
  return nextPendingMatchDueAt(input.capturedAt, input.matchAttemptAfterIncrement) == null;
}

export function syncPollBackoffMs(iteration: number): number {
  const bounded = Math.max(0, Math.floor(iteration));
  return Math.min(1_000, 50 * 2 ** bounded);
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}
