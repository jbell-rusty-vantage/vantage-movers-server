import type {
  ProviderFailureClass,
  ProviderRetryPolicy,
  RetryDecision,
} from "./types";

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const STRUCTURAL_CODES = new Set([
  "CHECKSUM_MISMATCH",
  "INVALID_SCHEMA",
  "CAPACITY_EXCEEDED",
  "STRUCTURAL_FAILURE",
]);

export function classifyGoogleFailure(error: unknown): ProviderFailureClass {
  const status = providerStatus(error);
  const code = errorCode(error);

  if (status === 429) return "retryable_rate_limit";
  if (status === 408 || (status !== undefined && status >= 500)) {
    return "retryable_transient";
  }
  if (TRANSIENT_NETWORK_CODES.has(code)) return "retryable_transient";
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 404) return "not_found";
  if (
    STRUCTURAL_CODES.has(code) ||
    errorName(error) === "ChecksumMismatchError"
  ) {
    return "structural";
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return "invalid_request";
  }
  return "unknown";
}

export function decideProviderRetry(input: {
  failure_class: ProviderFailureClass;
  attempt: number;
  retry_after_ms?: number;
  now: Date;
  deadline: Date;
  policy: ProviderRetryPolicy;
}): RetryDecision {
  const { failure_class: failureClass, policy } = input;
  if (
    failureClass !== "retryable_rate_limit" &&
    failureClass !== "retryable_transient"
  ) {
    return { action: "fail", failure_class: failureClass };
  }
  if (
    input.attempt >= policy.max_attempts ||
    input.now.getTime() - policy.started_at.getTime() >= policy.max_elapsed_ms
  ) {
    return { action: "fail", failure_class: failureClass };
  }

  const retryAfter =
    input.retry_after_ms !== undefined &&
    Number.isFinite(input.retry_after_ms) &&
    input.retry_after_ms >= 0
      ? input.retry_after_ms
      : undefined;
  const exponential = Math.min(
    policy.max_delay_ms,
    policy.base_delay_ms * 2 ** Math.max(0, input.attempt - 1),
  );
  const random = Math.min(1, Math.max(0, (policy.random ?? Math.random)()));
  const delay = Math.min(
    policy.max_delay_ms,
    retryAfter ?? Math.floor(exponential * random),
  );
  const retryAt = input.now.getTime() + delay;
  const totalLimit =
    policy.started_at.getTime() + policy.max_elapsed_ms;

  if (retryAt >= input.deadline.getTime() || retryAt >= totalLimit) {
    return {
      action: "defer",
      not_before: new Date(
        input.now.getTime() + Math.max(delay, policy.defer_delay_ms),
      ),
      failure_class: failureClass,
    };
  }
  return {
    action: "retry",
    delay_ms: delay,
    failure_class: failureClass,
  };
}

export function providerStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const direct = numericStatus(error.status) ?? numericStatus(error.statusCode);
  if (direct !== undefined) return direct;
  return isRecord(error.response)
    ? numericStatus(error.response.status)
    : undefined;
}

function numericStatus(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{3}$/.test(value)
        ? Number(value)
        : undefined;
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function errorCode(error: unknown): string {
  if (!isRecord(error)) return "";
  const code = error.code;
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function errorName(error: unknown): string {
  return isRecord(error) && typeof error.name === "string" ? error.name : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
