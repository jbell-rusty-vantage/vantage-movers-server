import { AppError } from "./errors/AppError";
import { ERROR_CODES } from "./errors/errorCodes";

/**
 * Legacy service-layer error used by the v1 service facade and every
 * domain service folder it re-exports from.
 *
 * Now extends `AppError` (refactor plan 10) so the route layer can map
 * any service-thrown `AppError` (including subclasses like
 * `NotFoundError`/`ConflictError`) to an HTTP response with one
 * `instanceof AppError` check. The original two-arg constructor
 * (`message`, `statusCode = 400`) is preserved -- every existing
 * `throw new V1ServiceError("...", 404)` call site keeps producing the
 * same HTTP status and message it did before.
 *
 * New code should prefer the typed subclasses in `./errors` (e.g.
 * `NotFoundError`, `ConflictError`, `ValidationError`) so that logs and
 * future client surfaces can rely on a stable `code`.
 */
export class V1ServiceError extends AppError {
  constructor(message: string, statusCode = 400) {
    super(message, {
      statusCode,
      code: pickCodeForStatus(statusCode),
    });
    this.name = "V1ServiceError";
  }
}

function pickCodeForStatus(statusCode: number): ReturnType<typeof codeFromStatus> {
  return codeFromStatus(statusCode);
}

function codeFromStatus(statusCode: number) {
  if (statusCode === 401) return ERROR_CODES.UNAUTHORIZED;
  if (statusCode === 404) return ERROR_CODES.NOT_FOUND;
  if (statusCode === 409) return ERROR_CODES.CONFLICT;
  if (statusCode >= 500) return ERROR_CODES.INTERNAL;
  return ERROR_CODES.BAD_REQUEST;
}
