export const GRANOT_LIFECYCLE_ERROR_CODES = {
  VALIDATION_FAILED: "GRANOT_VALIDATION_FAILED",
  OWNER_REQUIRED: "GRANOT_OWNER_REQUIRED",
  ALREADY_ACTIVATED: "GRANOT_ALREADY_ACTIVATED",
  PROCESSING_DISABLED: "GRANOT_PROCESSING_DISABLED",
  DECISION_INTEGRITY: "GRANOT_DECISION_INTEGRITY_CONFLICT",
  RECEIPT_NOT_FOUND: "GRANOT_RECEIPT_NOT_FOUND",
  CASE_NOT_FOUND: "GRANOT_CASE_NOT_FOUND",
  DISCREPANCY_NOT_FOUND: "GRANOT_DISCREPANCY_NOT_FOUND",
  REQUEUE_STATE_CONFLICT: "GRANOT_REQUEUE_STATE_CONFLICT",
  DOMAIN_REVISION_CONFLICT: "DOMAIN_REVISION_CONFLICT",
  DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT: "DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT",
  CASE_REVISION_CONFLICT: "GRANOT_CASE_REVISION_CONFLICT",
  IDENTITY_CONFLICT: "GRANOT_IDENTITY_CONFLICT",
  POLICY_BLOCKED: "GRANOT_POLICY_BLOCKED",
  OPERATION_IDEMPOTENCY_CONFLICT: "GRANOT_OPERATION_IDEMPOTENCY_CONFLICT",
  CAPTURE_UNAVAILABLE: "GRANOT_CAPTURE_UNAVAILABLE",
} as const;

export type GranotLifecycleErrorCode =
  (typeof GRANOT_LIFECYCLE_ERROR_CODES)[keyof typeof GRANOT_LIFECYCLE_ERROR_CODES];

export class GranotLifecycleError extends Error {
  readonly name = "GranotLifecycleError";

  constructor(
    message: string,
    readonly code: GranotLifecycleErrorCode,
    readonly statusCode: number,
    readonly request_id?: string,
    readonly issues?: Array<{ path?: string; message: string }>,
  ) {
    super(message);
  }

  toHttpBody(): {
    ok: false;
    code: GranotLifecycleErrorCode;
    error: string;
    request_id: string | null;
    issues?: Array<{ path?: string; message: string }>;
  } {
    return {
      ok: false,
      code: this.code,
      error: this.message,
      request_id: this.request_id ?? null,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

export function isGranotLifecycleError(
  error: unknown,
): error is GranotLifecycleError {
  return error instanceof GranotLifecycleError;
}

export class ProcessingDisabledError extends GranotLifecycleError {
  constructor() {
    super(
      "Granot lifecycle processing is disabled",
      GRANOT_LIFECYCLE_ERROR_CODES.PROCESSING_DISABLED,
      503,
    );
  }
}

export class DecisionIntegrityError extends GranotLifecycleError {
  constructor(readonly observation_id: string, readonly attempt: number) {
    super(
      "Persisted Decision does not match the current causal inputs",
      GRANOT_LIFECYCLE_ERROR_CODES.DECISION_INTEGRITY,
      409,
    );
  }
}

export class OperationIdempotencyConflictError extends GranotLifecycleError {
  constructor(request_id?: string) {
    super(
      "Same channel operation ID was reused with a different payload",
      GRANOT_LIFECYCLE_ERROR_CODES.OPERATION_IDEMPOTENCY_CONFLICT,
      409,
      request_id,
    );
  }
}

export class CaptureUnavailableError extends GranotLifecycleError {
  constructor(request_id?: string) {
    super(
      "Granot observation receipt could not be stored",
      GRANOT_LIFECYCLE_ERROR_CODES.CAPTURE_UNAVAILABLE,
      503,
      request_id,
    );
  }
}
