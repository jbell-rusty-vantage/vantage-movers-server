const SECRET_KEY_PATTERN =
  /secret|token|password|authorization|api[_-]?key|credential|private[_-]?key|signing/i;

function redactSecretKeys(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 3) {
      return `[array:${value.length}]`;
    }
    return value.map((item) => redactSecretKeys(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 3) {
      return "[object]";
    }
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactSecretKeys(raw, depth + 1);
      }
    }
    return out;
  }
  return "[unsupported]";
}

/**
 * Bounds a redacted snapshot so audit writes never become expensive or store
 * raw request bodies: depth 4, strings 500 characters, arrays 20 items,
 * objects 50 keys. Large objects become `"[object]"`, large arrays
 * `"[array:n]"` and unsupported values `"[unsupported]"`. A result still over
 * the byte budget is replaced by a truncation marker with its top-level keys.
 * (Moved from the retired OperationalEvents sanitizer; the budget is the fixed
 * former default instead of an environment variable.)
 */
const MAX_SERIALIZED_BYTES = 16384;
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

function safeByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function boundSnapshot(details: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeValue(details, 0) as Record<string, unknown>;
  const serialized = safeByteLength(sanitized);
  if (serialized <= MAX_SERIALIZED_BYTES) {
    return sanitized;
  }
  return {
    _truncated: true,
    _approx_bytes: serialized,
    _keys: Object.keys(sanitized).slice(0, MAX_ARRAY_ITEMS),
  };
}

/**
 * Redacts credentials/tokens and bounds registry audit snapshots before
 * persistence or API serialization.
 */
export function sanitizeRegistrySnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!snapshot) {
    return null;
  }
  const redacted = redactSecretKeys(snapshot, 0);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    return {};
  }
  return boundSnapshot(redacted as Record<string, unknown>);
}

export function sanitizeRegistryMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return sanitizeRegistrySnapshot(metadata ?? {}) ?? {};
}
