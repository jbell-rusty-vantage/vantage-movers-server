import { sanitizeEventDetails } from "../observability/operationalEventSanitizer";

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
  return sanitizeEventDetails(redacted as Record<string, unknown>);
}

export function sanitizeRegistryMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return sanitizeRegistrySnapshot(metadata ?? {}) ?? {};
}
