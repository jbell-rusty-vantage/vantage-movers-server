import { getObservabilityDetailsMaxBytes } from "../../config/domain/observability";

/**
 * Bounds an arbitrary `details` object before it is written to the
 * `operational_events` collection so event writes never become expensive or
 * accidentally store raw request bodies / third-party payloads.
 *
 * Limits (per the implementation spec):
 *   - maximum depth: 4,
 *   - maximum string length: 500 characters,
 *   - maximum array items: 20,
 *   - maximum serialized size target: configurable, defaults to ~16 KB.
 *
 * Large objects become `"[object]"`, large arrays become `"[array:n]"`, and
 * unsupported values become `"[unsupported]"`.
 */

const MAX_DEPTH = 4;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH)}…`;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value as number) || typeof value === "boolean"
      ? value
      : "[unsupported]";
  }
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return truncateString(value.toString());
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return "[unsupported]";
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return `[array:${value.length}]`;
    }
    if (value.length > MAX_ARRAY_ITEMS) {
      return `[array:${value.length}]`;
    }
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      return "[object]";
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_OBJECT_KEYS) {
      return "[object]";
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      out[key] = sanitizeValue(val, depth + 1);
    }
    return out;
  }

  return "[unsupported]";
}

/**
 * Sanitizes an event `details` object. Always returns a plain object so the
 * Mongo field stays a consistent shape. If the bounded object still exceeds
 * the configured byte budget, it is replaced with a compact truncation marker
 * that preserves the original top-level keys.
 */
export function sanitizeEventDetails(
  details: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  const sanitized = sanitizeValue(details, 0) as Record<string, unknown>;

  const maxBytes = getObservabilityDetailsMaxBytes();
  const serialized = safeByteLength(sanitized);
  if (serialized <= maxBytes) {
    return sanitized;
  }

  return {
    _truncated: true,
    _approx_bytes: serialized,
    _keys: Object.keys(sanitized).slice(0, MAX_ARRAY_ITEMS),
  };
}

function safeByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
