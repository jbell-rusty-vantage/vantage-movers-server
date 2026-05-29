/**
 * Narrow public surface for the service-layer error model.
 *
 * `AppError` is the umbrella; the named subclasses encode the common
 * HTTP outcomes services raise. `V1ServiceError` (in
 * `../v1ServiceError.ts`) extends `AppError` for backward compatibility
 * with the route layer's existing mapping.
 *
 * Route handlers should `instanceof AppError` to map any thrown service
 * error (legacy or typed) to a response.
 */

export { AppError, type AppErrorOptions } from "./AppError";
export { ERROR_CODES, type ErrorCode } from "./errorCodes";
export {
  BadRequestError,
  ConflictError,
  IntegrationError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from "./serviceErrors";
