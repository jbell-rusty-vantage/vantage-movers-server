/**
 * The machine-readable deletion manifest. `inventory.ts --write-manifest` generates it from `policy.ts` plus a
 * live read-only observation; `purge.ts` executes exactly what it lists.
 *
 * The manifest hash is the sha256 of the canonical JSON (sorted keys, no whitespace) of `targets` only, so
 * regenerating the manifest after quiescence yields a new hash whenever any namespace, UUID, count, cleanup or
 * Blob key changes. The operator passes that hash to `purge.ts --manifest-hash=`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADMIN_AUTH_DATABASE,
  ADMIN_NEVER_DROP,
  FORBIDDEN_DATABASE_DROPS,
  HISTORICAL_DATABASE,
  MAIN_DATABASE,
  NEVER_DROP,
} from "../policy";

export const MANIFEST_PATH = resolve(__dirname, "../deletion-manifest.json");
export const BLOB_KEYS_PATH = resolve(__dirname, "../conversation-blob-keys.json");

export type CollectionTarget = {
  db: string;
  name: string;
  uuid: string;
  count: number;
  size: number;
  storage_size: number;
  index_size: number;
  /** A TTL index can only lower the count, so purge accepts `live <= count` for these and `live === count` otherwise. */
  ttl: boolean;
  spec: string;
  owner: string;
  gate: string;
};

/** Count check for a drop target: equal, or not higher when a TTL index may expire documents. */
export const dropCountMatches = (target: Pick<CollectionTarget, "count" | "ttl">, live: number) =>
  target.ttl ? live <= target.count : live === target.count;

export type DatabaseTarget = {
  name: string;
  spec: string;
  gate: string;
  collections: Array<{ name: string; uuid: string; count: number }>;
  size_on_disk: number;
};

export type CleanupStatus = "final" | "pending_wave3";

export type Cleanup =
  | {
      id: string;
      kind: "unset_fields";
      db: string;
      collection: string;
      fields: string[];
      /** Documents carrying at least one field (an `$or` of `$exists`). */
      expected_matches: number;
      status: CleanupStatus;
      spec: string;
    }
  | {
      id: string;
      kind: "retire_jobs";
      db: string;
      collection: "sales_intelligence_jobs";
      stages: string[];
      /** Rows per status at observation; terminal statuses are deleted after the non-terminal ones are terminalized. */
      expected_by_status: Record<string, number>;
      reason: string;
      status: CleanupStatus;
      spec: string;
    }
  | {
      id: string;
      kind: "delete_exact";
      db: string;
      collection: string;
      /** Exact key field and values (never a prefix). */
      key_field: string;
      key_values: string[];
      expected_matches: number;
      status: CleanupStatus;
      spec: string;
    }
  | {
      id: string;
      kind: "delete_filter";
      db: string;
      collection: string;
      /** Closed equality/`$in` filter, documented in DELETION-MANIFEST.md. */
      filter: Record<string, unknown>;
      expected_matches: number;
      status: CleanupStatus;
      spec: string;
    };

export type BlobTarget = {
  prefix: string;
  keys_file: string;
  keys_sha256: string;
  count: number;
  bytes: number;
  /** Keys under the prefix that no `lead_conversations` row references; listed, never deleted by this manifest. */
  unreferenced_count: number;
};

export type ManifestTargets = {
  cluster: { fingerprint: string; replica_set: string | null };
  main_database: string;
  admin_auth_database: string;
  drop_databases: DatabaseTarget[];
  drop_collections: CollectionTarget[];
  /** Policy targets that were already absent; purge asserts they are still absent. */
  absent_targets: Array<{ db: string; name: string; spec: string }>;
  cleanups: Cleanup[];
  blob: BlobTarget | null;
  protected: Array<{ db: string; name: string; uuid: string | null; count: number }>;
};

export type Manifest = {
  version: "slimming-deletion-manifest-v1";
  generated_at: string;
  source: { server_head: string | null; server_branch: string | null; admin_head: string | null };
  manifest_hash: string;
  targets: ManifestTargets;
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export const manifestHash = (targets: ManifestTargets) => sha256(canonicalJson(targets));

/**
 * Structural invariants every manifest must satisfy before anything reads it as a plan. These hold whatever
 * the JSON file says, so an edited manifest cannot widen the scope to a protected namespace.
 */
export function assertManifestInvariants(targets: ManifestTargets): void {
  const fail = (message: string): never => {
    throw new Error(`manifest invariant violated: ${message}`);
  };
  if (targets.main_database !== MAIN_DATABASE) fail(`main database must be ${MAIN_DATABASE}`);
  if (targets.admin_auth_database !== ADMIN_AUTH_DATABASE) fail(`admin auth database must be ${ADMIN_AUTH_DATABASE}`);
  for (const db of targets.drop_databases) {
    if ((FORBIDDEN_DATABASE_DROPS as readonly string[]).includes(db.name)) fail(`database ${db.name} can never be dropped`);
    if (db.name !== HISTORICAL_DATABASE) fail(`only ${HISTORICAL_DATABASE} may be dropped as a database, got ${db.name}`);
  }
  const allowedDropDbs = new Set([MAIN_DATABASE, ADMIN_AUTH_DATABASE]);
  for (const c of targets.drop_collections) {
    if (!allowedDropDbs.has(c.db)) fail(`collection drop outside the main/admin databases: ${c.db}.${c.name}`);
    if (c.db === MAIN_DATABASE && (NEVER_DROP as readonly string[]).includes(c.name)) fail(`${c.db}.${c.name} is protected`);
    if (c.db === ADMIN_AUTH_DATABASE && (ADMIN_NEVER_DROP as readonly string[]).includes(c.name)) fail(`${c.db}.${c.name} is protected`);
    if (!/^[a-z0-9_]+$/.test(c.name) || !c.uuid) fail(`collection target ${c.db}.${c.name} lacks an exact name or UUID`);
  }
  for (const cleanup of targets.cleanups) {
    if (cleanup.db !== MAIN_DATABASE) fail(`cleanup ${cleanup.id} outside the main database`);
    if (targets.drop_collections.some((c) => c.db === cleanup.db && c.name === cleanup.collection))
      fail(`cleanup ${cleanup.id} targets a collection that is also dropped`);
  }
  if (targets.blob && targets.blob.prefix !== "conversations/") fail(`blob prefix must be conversations/`);
}

export function loadManifest(path = MANIFEST_PATH): { manifest: Manifest; computedHash: string } {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  if (manifest.version !== "slimming-deletion-manifest-v1") throw new Error(`unknown manifest version ${manifest.version}`);
  assertManifestInvariants(manifest.targets);
  const computedHash = manifestHash(manifest.targets);
  if (computedHash !== manifest.manifest_hash) throw new Error(`manifest file hash ${manifest.manifest_hash} does not match its targets (${computedHash}); regenerate it`);
  return { manifest, computedHash };
}

export function loadBlobKeys(path = BLOB_KEYS_PATH): string[] {
  return JSON.parse(readFileSync(path, "utf8")) as string[];
}
