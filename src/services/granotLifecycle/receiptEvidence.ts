import { createHash } from "node:crypto";
import { canonicalJson } from "../durableWork/checksum";

export const FORBIDDEN_CREDENTIAL_KEY_CANONICALS = [
  "x-api-secret",
  "authorization",
  "cookie",
  "set-cookie",
] as const;

export type ForbiddenCredentialKeyCanonical =
  (typeof FORBIDDEN_CREDENTIAL_KEY_CANONICALS)[number];

export type RemovedCredentialKeyCounts = Record<
  ForbiddenCredentialKeyCanonical,
  number
>;

const CANONICAL_BY_NORMALIZED_KEY = new Map<
  string,
  ForbiddenCredentialKeyCanonical
>(
  FORBIDDEN_CREDENTIAL_KEY_CANONICALS.map((canonical) => [
    normalizeCredentialKey(canonical),
    canonical,
  ]),
);

export function normalizeCredentialKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveForbiddenCredentialKey(
  key: string,
): ForbiddenCredentialKeyCanonical | undefined {
  return CANONICAL_BY_NORMALIZED_KEY.get(normalizeCredentialKey(key));
}

export function emptyRemovedCredentialKeyCounts(): RemovedCredentialKeyCounts {
  return {
    "x-api-secret": 0,
    authorization: 0,
    cookie: 0,
    "set-cookie": 0,
  };
}

export function mergeRemovedCredentialKeyCounts(
  ...countsList: readonly RemovedCredentialKeyCounts[]
): RemovedCredentialKeyCounts {
  const merged = emptyRemovedCredentialKeyCounts();
  for (const counts of countsList) {
    for (const key of FORBIDDEN_CREDENTIAL_KEY_CANONICALS) {
      merged[key] += counts[key];
    }
  }
  return merged;
}

export function redactCredentialKeys(value: unknown): {
  value: unknown;
  removed_key_counts: RemovedCredentialKeyCounts;
} {
  const removed_key_counts = emptyRemovedCredentialKeyCounts();
  return {
    value: redactValue(value, removed_key_counts),
    removed_key_counts,
  };
}

export function hashCredentialRedactedPayload(payload: unknown): {
  redacted_payload: unknown;
  payload_sha256: string;
  removed_key_counts: RemovedCredentialKeyCounts;
} {
  const redacted = redactCredentialKeys(payload);
  const payload_sha256 = createHash("sha256")
    .update(canonicalJson(redacted.value), "utf8")
    .digest("hex");
  return {
    redacted_payload: redacted.value,
    payload_sha256,
    removed_key_counts: redacted.removed_key_counts,
  };
}

export function classifyPayloadKind(
  payload: unknown,
): "object" | "array" | "null" | "primitive" {
  if (payload === null) return "null";
  if (Array.isArray(payload)) return "array";
  if (typeof payload === "object") return "object";
  return "primitive";
}

function redactValue(
  value: unknown,
  removed_key_counts: RemovedCredentialKeyCounts,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, removed_key_counts));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const forbidden = resolveForbiddenCredentialKey(key);
    if (forbidden) {
      removed_key_counts[forbidden] += 1;
      continue;
    }
    redacted[key] = redactValue(entry, removed_key_counts);
  }
  return redacted;
}
