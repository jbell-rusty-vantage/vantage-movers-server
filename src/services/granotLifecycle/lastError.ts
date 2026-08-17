const SAFE_ERROR_CODES = new Set([
  "dependency_failure",
  "transaction_failure",
  "unknown_outcome",
  "processor_error",
  "processor_contract",
]);

const FORBIDDEN_MESSAGE_PATTERNS = [
  /payload/i,
  /authorization/i,
  /cookie/i,
  /x-api-secret/i,
  /phone/i,
  /email/i,
  /address/i,
  /job[_\s-]?no/i,
  /source[_\s-]?label/i,
  /stack/i,
  /mongodb:\/\//i,
  /at \S+\s+\(/,
  /header/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
];

export const LAST_ERROR_MESSAGE_MAX = 500;

export type SanitizedLastError = {
  code: string;
  message: string;
  failed_at: Date;
};

export function sanitizeLastError(
  error: unknown,
  now: Date,
  fallbackCode = "processor_error",
): SanitizedLastError {
  const extracted = extractErrorCode(error);
  const code = SAFE_ERROR_CODES.has(extracted) ? extracted : fallbackCode;
  return {
    code,
    message: sanitizeErrorMessage(error),
    failed_at: now,
  };
}

export function classifyTechnicalFailureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (SAFE_ERROR_CODES.has(code)) {
      return code;
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/transienttransactionerror|transactionnumber|writeconflict/i.test(message)) {
    return "transaction_failure";
  }
  if (/transaction/i.test(message)) {
    return "transaction_failure";
  }
  return "dependency_failure";
}

function extractErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }
  return classifyTechnicalFailureCode(error);
}

function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error) && typeof error !== "string") {
    return "Technical processing failure";
  }
  const raw = (error instanceof Error ? error.message : error).trim();
  if (!raw || raw.length > LAST_ERROR_MESSAGE_MAX) {
    return "Technical processing failure";
  }
  if (FORBIDDEN_MESSAGE_PATTERNS.some((pattern) => pattern.test(raw))) {
    return "Technical processing failure";
  }
  return raw.slice(0, LAST_ERROR_MESSAGE_MAX);
}
