import {
  classifyGoogleFailure,
  decideProviderRetry,
  providerStatus,
  type ProviderFailureClass,
  type ProviderRetryPolicy,
  type RetryDecision,
} from "../../durableWork";

export type SanitizedReportingProviderFailure = {
  failure_class: ProviderFailureClass;
  provider_status?: number;
  retryable: boolean;
  remediation:
    | "retry"
    | "owner_reconnect"
    | "owner_repair_destination"
    | "operator_review"
    | "capacity"
    | "non_retryable";
  summary: string;
};

const PII_LIKE =
  /@|phone|email|address|zip|name|formula|=HYPERLINK|=IMPORT|=QUERY/i;

export function sanitizeReportingProviderFailure(
  error: unknown,
): SanitizedReportingProviderFailure {
  const failureClass = classifyGoogleFailure(error);
  const status = providerStatus(error);
  const retryable =
    failureClass === "retryable_rate_limit" ||
    failureClass === "retryable_transient";
  return {
    failure_class: failureClass,
    ...(status !== undefined ? { provider_status: status } : {}),
    retryable,
    remediation: remediationFor(failureClass),
    summary: summaryFor(failureClass, status),
  };
}

export function decideReportingProviderRetry(input: {
  error: unknown;
  attempt: number;
  now: Date;
  deadline: Date;
  policy: ProviderRetryPolicy;
}): RetryDecision {
  const sanitized = sanitizeReportingProviderFailure(input.error);
  return decideProviderRetry({
    failure_class: sanitized.failure_class,
    attempt: input.attempt,
    retry_after_ms: retryAfterMs(input.error),
    now: input.now,
    deadline: input.deadline,
    policy: input.policy,
  });
}

export function assertProviderErrorIsPiiSafe(error: unknown): void {
  const sanitized = sanitizeReportingProviderFailure(error);
  if (PII_LIKE.test(sanitized.summary)) {
    throw new TypeError("Sanitized provider summary must remain PII-free.");
  }
  if (isRecord(error)) {
    for (const key of ["message", "body", "data", "values", "range"] as const) {
      const value = error[key];
      if (typeof value === "string" && looksLikeCellPayload(value)) {
        throw new TypeError(
          "Provider error payload may contain cell/PII content and must not be persisted.",
        );
      }
    }
  }
}

function remediationFor(
  failureClass: ProviderFailureClass,
): SanitizedReportingProviderFailure["remediation"] {
  switch (failureClass) {
    case "retryable_rate_limit":
    case "retryable_transient":
      return "retry";
    case "authentication":
      return "owner_reconnect";
    case "authorization":
    case "not_found":
      return "owner_repair_destination";
    case "structural":
      return "capacity";
    case "invalid_request":
      return "non_retryable";
    default:
      return "operator_review";
  }
}

function summaryFor(
  failureClass: ProviderFailureClass,
  status: number | undefined,
): string {
  const statusSuffix = status !== undefined ? ` (HTTP ${status})` : "";
  switch (failureClass) {
    case "retryable_rate_limit":
      return `Google provider rate-limited the reporting request${statusSuffix}.`;
    case "retryable_transient":
      return `Google provider returned a transient failure${statusSuffix}.`;
    case "authentication":
      return "Google OAuth authentication failed for reporting.";
    case "authorization":
      return "Google denied access for the reporting destination.";
    case "not_found":
      return "The reporting Google artifact was not found.";
    case "invalid_request":
      return `Google rejected the reporting request${statusSuffix}.`;
    case "structural":
      return "The reporting Google artifact failed a structural check.";
    default:
      return "Google reporting provider failed with an unclassified error.";
  }
}

function retryAfterMs(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const response = isRecord(error.response) ? error.response : undefined;
  const headers = isRecord(response?.headers) ? response.headers : undefined;
  const header = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (header === undefined || header === null) return undefined;
  const seconds = Number(Array.isArray(header) ? header[0] : header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function looksLikeCellPayload(value: string): boolean {
  return value.includes(",") || value.includes("\n") || value.startsWith("=");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
