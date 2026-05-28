/**
 * Stable, app-owned error codes used by `AppError` and its subclasses.
 *
 * These codes are part of the operational/log surface of the API. They
 * are NOT part of the public HTTP response shape today (the API currently
 * returns `{ ok: false, error }`), but they are intended to become the
 * `errorCode` field in logs so operators can filter Vercel/log search by
 * a stable identifier (`"app.not_found"`) instead of a fragile message
 * string (`"Form lead not found"`).
 *
 * When adding new codes:
 *   - Keep the `domain.thing` shape lowercase with dots.
 *   - Pair the code with an HTTP `statusCode` default in `serviceErrors.ts`.
 *   - Do NOT remove or rename existing codes; consumers (log filters,
 *     dashboards, future client surfaces) may rely on the literal string.
 */
export const ERROR_CODES = {
  /** Generic 500 fallback when no more specific subclass applies. */
  INTERNAL: "app.internal",
  /** Missing or malformed input (validation-style, 400). */
  BAD_REQUEST: "app.bad_request",
  /** Input shape was valid but violates a domain rule (also 400). */
  VALIDATION: "app.validation",
  /** Caller is not authenticated/authorized (401). */
  UNAUTHORIZED: "app.unauthorized",
  /** Resource was looked up but does not exist (404). */
  NOT_FOUND: "app.not_found",
  /** Resource exists but the request conflicts with its current state (409). */
  CONFLICT: "app.conflict",
  /** An external integration (CRM, Sheets, etc.) failed (502). */
  INTEGRATION: "app.integration",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
