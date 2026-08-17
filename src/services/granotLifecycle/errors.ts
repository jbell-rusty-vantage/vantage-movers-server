export const GRANOT_LIFECYCLE_ERROR_CODES = {
  VALIDATION_FAILED: "GRANOT_VALIDATION_FAILED",
  OWNER_REQUIRED: "GRANOT_OWNER_REQUIRED",
  ALREADY_ACTIVATED: "GRANOT_ALREADY_ACTIVATED",
  PROCESSING_DISABLED: "GRANOT_PROCESSING_DISABLED",
  DECISION_INTEGRITY: "GRANOT_DECISION_INTEGRITY_CONFLICT",
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
