import { ERROR_CODES, type ErrorCode } from "./errorCodes";

export type AppErrorOptions = {
  /** Stable, app-owned code (see `ERROR_CODES`). Defaults to `INTERNAL`. */
  code?: ErrorCode;
  /** HTTP status code clients should see. Defaults to 500. */
  statusCode?: number;
  /**
   * Verbose, internal-only message. Used in logs alongside `message`;
   * never returned to API clients. Use this to record raw external
   * error text, stack hints, or anything too detailed for callers.
   */
  internalMessage?: string;
  /** Underlying error (e.g. external API failure). */
  cause?: unknown;
  /**
   * Free-form structured metadata that is safe to write to logs.
   * Must NOT contain secrets, raw PII, or large payloads.
   */
  metadata?: Record<string, unknown>;
};

/**
 * Base class for typed service-layer errors in this codebase.
 *
 * `AppError` is the new umbrella error introduced by refactor plan 10.
 * The historical `V1ServiceError` is preserved by extending this class
 * so existing route mapping (status code + message) continues to work
 * unchanged while new domain code can throw richer, typed subclasses
 * like `NotFoundError` or `ConflictError`.
 *
 * The contract callers can rely on:
 *   - `message`     -> public, safe to surface in HTTP responses
 *   - `statusCode`  -> HTTP status for the response
 *   - `code`        -> stable string for log filters / dashboards
 *   - `internalMessage`/`cause`/`metadata` -> log-only context, never
 *     returned to API clients
 *
 * `toLog()` returns a plain object intended for `logger.warn`/`logger.error`
 * structured logs. It collapses the safe fields so a single
 * `log.warn({ msg: "...", ...err.toLog() })` call produces consistent
 * Vercel-friendly JSON without leaking `cause` accidentally (cause is
 * intentionally summarized, not spread).
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly internalMessage?: string;
  public readonly metadata?: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? ERROR_CODES.INTERNAL;
    this.statusCode = options.statusCode ?? 500;
    this.internalMessage = options.internalMessage;
    this.metadata = options.metadata;
  }

  /**
   * Returns a plain, log-safe summary of this error.
   *
   * Keys are deliberately stable so structured Vercel log filters can
   * key off `errorCode`, `statusCode`, etc.
   */
  toLog(): Record<string, unknown> {
    const cause = (this as unknown as { cause?: unknown }).cause;
    return {
      errorName: this.name,
      errorCode: this.code,
      statusCode: this.statusCode,
      message: this.message,
      ...(this.internalMessage ? { internalMessage: this.internalMessage } : {}),
      ...(this.metadata ? { metadata: this.metadata } : {}),
      ...(cause !== undefined ? { causeMessage: causeMessage(cause) } : {}),
    };
  }
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return "[unserializable cause]";
  }
}
