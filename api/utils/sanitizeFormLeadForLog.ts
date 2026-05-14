const PREVIEW_MAX = 120;

function truncate(value: string): string {
  if (value.length <= PREVIEW_MAX) {
    return value;
  }
  return `${value.slice(0, PREVIEW_MAX)}…`;
}

/** Masks local part; keeps domain for webhook debugging without logging a full address. */
export function maskEmailForLog(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) {
    return "[redacted]";
  }
  const domain = trimmed.slice(at + 1);
  const local = trimmed.slice(0, at);
  const prefix = local.length > 0 ? `${local[0]}***` : "***";
  return `${prefix}@${domain}`;
}

export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) {
    return "[redacted]";
  }
  return `***${digits.slice(-4)}`;
}

function sanitizeScalar(key: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== "string") {
    return "[unsupported]";
  }

  const lower = key.toLowerCase();
  if (lower === "email" || lower.endsWith("_email")) {
    return maskEmailForLog(value);
  }
  if (lower === "phone_number" || lower === "phone" || lower.endsWith("_phone")) {
    return maskPhoneForLog(value);
  }

  return truncate(value);
}

/**
 * Shallow preview of a webhook/body object for structured logs (no secrets, no full PII).
 */
export function sanitizeFormLeadBodyPreview(body: unknown): Record<string, unknown> | null {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { _type: Array.isArray(body) ? "array" : typeof body };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null && !(value instanceof Date)) {
      out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
      continue;
    }
    out[key] = sanitizeScalar(key, value);
  }
  return out;
}
