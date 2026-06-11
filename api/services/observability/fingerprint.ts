import { createHash } from "node:crypto";

/**
 * Computes a stable fingerprint for incident dedupe. The fingerprint is a hash
 * of the environment, event key, workflow, entity, route, and a normalized
 * error message (when applicable) so repeated identical failures collapse onto
 * a single incident.
 */
export type FingerprintInput = {
  environment: string;
  eventKey: string;
  workflow: string;
  entityType?: string | null;
  entityId?: string | null;
  route?: string | null;
  errorMessage?: string | null;
  /** Optional explicit grouping override (highest precedence). */
  dedupeKey?: string | null;
};

/**
 * Normalizes an error message so superficial differences (ids, timestamps,
 * hex blobs) do not fragment incidents.
 */
function normalizeErrorMessage(message: string | null | undefined): string {
  if (!message) {
    return "";
  }
  return message
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "0x")
    .replace(/[0-9a-f]{16,}/g, "<hex>")
    .replace(/\d{2,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function computeFingerprint(input: FingerprintInput): string {
  if (input.dedupeKey && input.dedupeKey.trim().length > 0) {
    return createHash("sha256")
      .update(`dedupe:${input.dedupeKey.trim()}`)
      .digest("hex")
      .slice(0, 32);
  }

  const parts = [
    input.environment,
    input.eventKey,
    input.workflow,
    input.entityType ?? "",
    input.entityId ?? "",
    input.route ?? "",
    normalizeErrorMessage(input.errorMessage),
  ];

  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 32);
}

/**
 * A human-readable dedupe key for debugging. Falls back to a composed string
 * when no explicit key is provided.
 */
export function buildDedupeKey(input: FingerprintInput): string {
  if (input.dedupeKey && input.dedupeKey.trim().length > 0) {
    return input.dedupeKey.trim();
  }
  const scope = input.entityId
    ? `${input.entityType ?? "entity"}:${input.entityId}`
    : input.route ?? input.workflow;
  return `${input.eventKey}:${input.environment}:${scope}`;
}
