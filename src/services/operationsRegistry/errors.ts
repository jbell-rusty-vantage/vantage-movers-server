import { AppError, type AppErrorOptions } from "../errors/AppError";
import { ERROR_CODES } from "../errors/errorCodes";
import {
  REGISTRY_ERROR_CODES,
  type RegistryErrorCode,
  type RegistryRemediation,
} from "../errors/registryErrorCodes";

type RegistryErrorOptions = Omit<AppErrorOptions, "code"> & {
  registryCode: RegistryErrorCode;
  remediation?: RegistryRemediation;
};

function httpStatusForRegistryCode(code: RegistryErrorCode): number {
  switch (code) {
    case REGISTRY_ERROR_CODES.NOT_FOUND:
      return 404;
    case REGISTRY_ERROR_CODES.STALE_REVISION:
    case REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT:
    case REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER:
    case REGISTRY_ERROR_CODES.AMBIGUOUS_RESOLUTION:
    case REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE:
      return 409;
    case REGISTRY_ERROR_CODES.FORBIDDEN:
    case REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_INVALID:
    case REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED:
    case REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING:
      return 403;
    case REGISTRY_ERROR_CODES.IMMUTABLE_FIELD:
    case REGISTRY_ERROR_CODES.CPL_SCHEDULE_GAP:
    case REGISTRY_ERROR_CODES.CPL_SCHEDULE_OVERLAP:
    case REGISTRY_ERROR_CODES.CPL_MISSING_RATE:
    case REGISTRY_ERROR_CODES.RINGCENTRAL_ROUTE_UNVALIDATED:
    case REGISTRY_ERROR_CODES.RINGCENTRAL_ROUTE_INVALID:
      return 400;
    case REGISTRY_ERROR_CODES.RINGCENTRAL_VALIDATION_UNAVAILABLE:
      return 503;
    default:
      return 400;
  }
}

function appErrorCodeForRegistryCode(code: RegistryErrorCode) {
  switch (code) {
    case REGISTRY_ERROR_CODES.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case REGISTRY_ERROR_CODES.STALE_REVISION:
    case REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT:
    case REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER:
    case REGISTRY_ERROR_CODES.AMBIGUOUS_RESOLUTION:
    case REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE:
      return ERROR_CODES.CONFLICT;
    case REGISTRY_ERROR_CODES.FORBIDDEN:
    case REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_INVALID:
    case REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED:
    case REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING:
      return ERROR_CODES.UNAUTHORIZED;
    case REGISTRY_ERROR_CODES.RINGCENTRAL_VALIDATION_UNAVAILABLE:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return ERROR_CODES.VALIDATION;
  }
}

/**
 * Typed registry domain error with stable client-facing `registryCode` and
 * optional remediation guidance.
 */
export class RegistryError extends AppError {
  public readonly registryCode: RegistryErrorCode;
  public readonly remediation?: RegistryRemediation;

  constructor(message: string, options: RegistryErrorOptions) {
    super(message, {
      ...options,
      code: appErrorCodeForRegistryCode(options.registryCode),
      statusCode: options.statusCode ?? httpStatusForRegistryCode(options.registryCode),
    });
    this.name = "RegistryError";
    this.registryCode = options.registryCode;
    this.remediation = options.remediation;
  }

  toHttpBody(): {
    ok: false;
    error: string;
    registry_code: RegistryErrorCode;
    remediation?: RegistryRemediation;
  } {
    return {
      ok: false,
      error: this.message,
      registry_code: this.registryCode,
      ...(this.remediation ? { remediation: this.remediation } : {}),
    };
  }
}

export function isRegistryError(error: unknown): error is RegistryError {
  return error instanceof RegistryError;
}
