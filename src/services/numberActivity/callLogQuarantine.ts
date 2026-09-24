import { InteractionPersistenceError } from "./persistInteraction";

/**
 * CC-01 failure isolation for the Call Log reconcile.
 *
 * One record that keeps failing must never hold the window, the cursor and
 * `known_complete_through` for everyone else: on 2026-09-23 a single Contact
 * Number froze all capture for two and a half hours. A failing record is
 * counted in `record_failures`; at `quarantineAfter` consecutive failures it
 * moves to `quarantined_records`, the window completes without it, and it is
 * retried by id on a doubling backoff (60 min → 12 h). Success anywhere
 * removes it from both lists.
 *
 * Pure bookkeeping over the stored arrays; the reconcile owns the I/O and
 * writes `snapshot()` back under its fenced lease.
 */
export type QuarantineErrorCode =
  | "projection_failed"
  | "account_mismatch"
  | "retry_exhausted"
  | "persist_failed"
  | "provider_not_found"
  | "provider_request_failed";

export type QuarantinedRecord = {
  call_log_id: string;
  telephony_session_id: string | null;
  start_time: Date | null;
  error_code: string;
  error_name: string;
  failures: number;
  first_failed_at: Date;
  last_failed_at: Date;
  next_retry_at: Date;
};

export type RecordFailure = { call_log_id: string; failures: number; last_error_code: string };

export type QuarantineLimits = {
  /** Consecutive failures before quarantine for a deterministic error. */
  quarantineAfter: number;
  /**
   * The same for a transient error (`persist_failed`, `retry_exhausted`,
   * `provider_request_failed`): a write conflict or a provider hiccup
   * deserves more attempts in the window before it is set aside.
   */
  transientQuarantineAfter: number;
  baseDelayMinutes: number;
  maxDelayMinutes: number;
  maxQuarantined: number;
  maxRecordFailures: number;
};

export const DEFAULT_QUARANTINE_LIMITS: QuarantineLimits = {
  quarantineAfter: 3,
  transientQuarantineAfter: 6,
  baseDelayMinutes: 60,
  maxDelayMinutes: 720,
  maxQuarantined: 200,
  maxRecordFailures: 500,
};

export type FailureInput = {
  call_log_id: string;
  telephony_session_id: string | null;
  start_time: Date | null;
  error_code: QuarantineErrorCode;
  error_name: string;
};

export type FailureOutcome = "counted" | "quarantined" | "newly_quarantined";

const TRANSIENT_CODES: ReadonlySet<string> = new Set(["persist_failed", "retry_exhausted", "provider_request_failed"]);

/** Deterministic failures repeat on every attempt; transient ones may not. */
export function isTransientQuarantineCode(code: string): boolean {
  return TRANSIENT_CODES.has(code);
}

/** Classification written on the quarantine entry (no provider content). */
export function quarantineErrorCode(error: unknown): QuarantineErrorCode {
  if (error instanceof InteractionPersistenceError) {
    if (error.code === "account_mismatch") return "account_mismatch";
    if (error.code === "retry_exhausted") return "retry_exhausted";
    return "projection_failed";
  }
  // Mongo/Mongoose rejections (StrictModeError, ValidationError, WriteConflict
  // after retries) are persistence failures, not projection bugs.
  return "persist_failed";
}

/** `errorName` plus the first 200 characters of the message: schema paths and codes, no PII. */
export function failureLogFields(error: unknown): { errorName: string; errorMessage: string } {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return { errorName: name, errorMessage: message.slice(0, 200) };
}

export class QuarantineBook {
  private readonly quarantined = new Map<string, QuarantinedRecord>();
  private readonly failures = new Map<string, RecordFailure>();
  /** Start-time ranges of entries evicted past the bound; the caller opens them as `quarantine_overflow` gaps. */
  readonly overflow: Array<{ from: Date; to: Date }> = [];
  private dirty = false;

  constructor(
    quarantined: readonly QuarantinedRecord[] | null | undefined,
    failures: readonly RecordFailure[] | null | undefined,
    private readonly limits: QuarantineLimits = DEFAULT_QUARANTINE_LIMITS,
  ) {
    for (const entry of quarantined ?? []) this.quarantined.set(entry.call_log_id, { ...entry });
    for (const entry of failures ?? []) this.failures.set(entry.call_log_id, { ...entry });
  }

  get changed(): boolean {
    return this.dirty;
  }

  get quarantinedCount(): number {
    return this.quarantined.size;
  }

  isQuarantined(id: string): boolean {
    return this.quarantined.has(id);
  }

  /** A quarantined record is only attempted again once its backoff has passed. */
  isHeld(id: string, now: Date): boolean {
    const entry = this.quarantined.get(id);
    return Boolean(entry && entry.next_retry_at > now);
  }

  /** Due entries, soonest first, not already attempted this run. */
  due(now: Date, limit: number, exclude: ReadonlySet<string>): QuarantinedRecord[] {
    if (limit <= 0) return [];
    return [...this.quarantined.values()]
      .filter((e) => e.next_retry_at <= now && !exclude.has(e.call_log_id))
      .sort((a, b) => a.next_retry_at.getTime() - b.next_retry_at.getTime())
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  quarantinedIds(): string[] {
    return [...this.quarantined.keys()];
  }

  oldestFirstFailedAt(): Date | null {
    let out: Date | null = null;
    for (const entry of this.quarantined.values()) {
      if (!out || entry.first_failed_at < out) out = entry.first_failed_at;
    }
    return out;
  }

  recordSuccess(id: string): "released" | "cleared" | null {
    if (this.quarantined.delete(id)) {
      this.failures.delete(id);
      this.dirty = true;
      return "released";
    }
    if (this.failures.delete(id)) {
      this.dirty = true;
      return "cleared";
    }
    return null;
  }

  recordFailure(input: FailureInput, now: Date): FailureOutcome {
    this.dirty = true;
    const held = this.quarantined.get(input.call_log_id);
    if (held) {
      // Each failed retry doubles the previous delay, capped at 12 h.
      const previousDelay = Math.max(this.baseDelayMs(), held.next_retry_at.getTime() - held.last_failed_at.getTime());
      held.failures += 1;
      held.error_code = input.error_code;
      held.error_name = input.error_name;
      held.last_failed_at = now;
      held.next_retry_at = new Date(now.getTime() + Math.min(this.limits.maxDelayMinutes * 60_000, previousDelay * 2));
      return "quarantined";
    }
    const previous = this.failures.get(input.call_log_id);
    const failures = (previous?.failures ?? 0) + 1;
    const threshold = isTransientQuarantineCode(input.error_code)
      ? Math.max(this.limits.quarantineAfter, this.limits.transientQuarantineAfter)
      : this.limits.quarantineAfter;
    if (failures < threshold) {
      // Re-insert so Map order stays oldest-touched first for eviction.
      this.failures.delete(input.call_log_id);
      this.failures.set(input.call_log_id, {
        call_log_id: input.call_log_id,
        failures,
        last_error_code: input.error_code,
      });
      while (this.failures.size > this.limits.maxRecordFailures) {
        const oldest = this.failures.keys().next().value as string;
        this.failures.delete(oldest);
      }
      return "counted";
    }
    this.failures.delete(input.call_log_id);
    this.quarantined.set(input.call_log_id, {
      call_log_id: input.call_log_id,
      telephony_session_id: input.telephony_session_id,
      start_time: input.start_time,
      error_code: input.error_code,
      error_name: input.error_name,
      failures,
      first_failed_at: now,
      last_failed_at: now,
      next_retry_at: new Date(now.getTime() + this.baseDelayMs()),
    });
    while (this.quarantined.size > this.limits.maxQuarantined) this.evictOldest();
    return "newly_quarantined";
  }

  snapshot(): { quarantined_records: QuarantinedRecord[]; record_failures: RecordFailure[] } {
    return {
      quarantined_records: [...this.quarantined.values()].sort(
        (a, b) => a.first_failed_at.getTime() - b.first_failed_at.getTime(),
      ),
      record_failures: [...this.failures.values()],
    };
  }

  /** First retry 60 min after quarantine. */
  private baseDelayMs(): number {
    return Math.min(this.limits.baseDelayMinutes, this.limits.maxDelayMinutes) * 60_000;
  }

  private evictOldest(): void {
    let oldest: QuarantinedRecord | null = null;
    for (const entry of this.quarantined.values()) {
      if (!oldest || entry.first_failed_at < oldest.first_failed_at) oldest = entry;
    }
    if (!oldest) return;
    this.quarantined.delete(oldest.call_log_id);
    // Evidence is never dropped: the evicted record's start becomes a gap the
    // window repair re-reads, where it fails and is counted afresh.
    const from = oldest.start_time ?? oldest.first_failed_at;
    this.overflow.push({ from, to: new Date(from.getTime() + 60_000) });
  }
}
