import { AppError, type AppErrorOptions } from "./AppError";
import { ERROR_CODES } from "./errorCodes";

/**
 * Typed `AppError` subclasses for the common HTTP outcomes services
 * raise.
 *
 * Each subclass:
 *   - Sets a stable `code` (so log filters can target `"app.not_found"`
 *     etc. without depending on the message).
 *   - Defaults `statusCode` to the conventional HTTP status for the
 *     situation, but allows the caller to override per case.
 *
 * Callers should prefer these over throwing `new AppError(...)` directly
 * so the intent is obvious at the throw site and the right status is
 * applied in the route layer's `sendError` helper.
 */

type SubclassOptions = Omit<AppErrorOptions, "code" | "statusCode"> & {
  statusCode?: number;
};

export class BadRequestError extends AppError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.BAD_REQUEST,
      statusCode: options.statusCode ?? 400,
    });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.VALIDATION,
      statusCode: options.statusCode ?? 400,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.UNAUTHORIZED,
      statusCode: options.statusCode ?? 401,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.NOT_FOUND,
      statusCode: options.statusCode ?? 404,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.CONFLICT,
      statusCode: options.statusCode ?? 409,
    });
  }
}

export class IntegrationError extends AppError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.INTEGRATION,
      statusCode: options.statusCode ?? 502,
    });
  }
}
