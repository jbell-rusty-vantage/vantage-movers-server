import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Canonical JSON cannot contain non-finite numbers");
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function deterministicObjectId(namespace: string, naturalKey: string): string {
  return sha256(`${namespace}\u0000${naturalKey}`).slice(0, 24);
}

export function assertArtifactHash<T extends { manifest_hash: string }>(artifact: T): void {
  const { manifest_hash, ...body } = artifact;
  const actual = sha256(body);
  if (actual !== manifest_hash) {
    throw new Error(`Manifest hash mismatch: expected ${manifest_hash}, calculated ${actual}`);
  }
}
