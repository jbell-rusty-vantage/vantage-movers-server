/**
 * Pure purge rules: the exact Mongo filters each manifest cleanup selects, the closed-filter check for
 * `delete_filter`, the backup-directory guard and the deployed-commit check. `purge.ts` executes them; the
 * unit tests pin them.
 */
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Document, Filter } from "mongodb";
import { type BackupEntry, idKey, verifyBackupFile, verifyBlobBackupFile } from "./backup";
import { SERVER_ROOT, WORKSPACE_ROOT } from "./env";
import { type Cleanup, type ManifestTargets, canonicalJson } from "./manifest";
import {
  ADMIN_DROP_COLLECTIONS,
  ADMIN_NEVER_DROP,
  CLEANUP_SCOPES,
  type CleanupScope,
  CLEANUP_STATUS,
  HISTORICAL_DATABASE,
  MAIN_DROP_COLLECTIONS,
  NEVER_DROP,
} from "../policy";

/** Pre-slimming server commit; a deployed commit must descend from it and must no longer carry retired models. */
export const BASELINE_COMMIT = "6a374fab";
export const RETIRED_MARKER_PATHS = [
  "src/models/historical/index.ts",
  "src/models/OperationalEvent.ts",
  "src/models/LeadConversation.ts",
  "src/models/salesIntelligence/attentionArtifact.ts",
  "src/models/salesIntelligence/assessment.ts",
] as const;
export const NON_TERMINAL_JOB_STATUSES = ["pending", "retry", "paused"] as const;
/** `retired` is written by the server's retired-stage fence (`retireLegacyCsiJobs`, reason `stage_retired`). */
export const TERMINAL_JOB_STATUSES = ["completed", "dead_letter", "retired"] as const;

export class PurgeAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeAbort";
  }
}

/**
 * Differences between a manifest's scope and the current `policy.ts`. The manifest is generated from the policy, but it
 * is a JSON file that is hashed, not signed, so purge re-derives the allowed scope from the policy every time:
 *   - drop collections and absent targets: exactly the policy's MAIN_/ADMIN_DROP_COLLECTIONS, each once, in its own
 *     database (nothing outside the allowlist, nothing missing);
 *   - drop databases: only the historical database;
 *   - protected: exactly NEVER_DROP + ADMIN_NEVER_DROP, so step (g) checks all of them;
 *   - cleanups: every id of CLEANUP_SCOPES exactly once, with the policy's status, kind, collection and exact scope
 *     (fields, stages, reason, key field, filter); `delete_exact` key values may be a subset of the policy list (scopes
 *     absent at observation), never another value.
 * A manifest generated before a policy change must be regenerated: `purge.ts --apply` aborts on any of these and the
 * dry run counts them as problems.
 */
export function manifestPolicyDrift(targets: Pick<ManifestTargets, "main_database" | "admin_auth_database" | "drop_collections" | "absent_targets" | "drop_databases" | "protected" | "cleanups">): string[] {
  const problems: string[] = [];
  const mainDb = targets.main_database;
  const adminDb = targets.admin_auth_database;
  const allowed = new Map<string, string>([
    ...Object.keys(MAIN_DROP_COLLECTIONS).map((name) => [`${mainDb}.${name}`, name] as const),
    ...Object.keys(ADMIN_DROP_COLLECTIONS).map((name) => [`${adminDb}.${name}`, name] as const),
  ]);
  const seen = new Map<string, number>();
  for (const t of [...targets.drop_collections, ...targets.absent_targets]) {
    const key = `${t.db}.${t.name}`;
    if (!allowed.has(key)) problems.push(`drop target ${key} is not in policy.ts MAIN_/ADMIN_DROP_COLLECTIONS`);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const key of allowed.keys()) {
    const n = seen.get(key) ?? 0;
    if (n === 0) problems.push(`policy drop target ${key} is neither dropped nor recorded absent by the manifest`);
    if (n > 1) problems.push(`drop target ${key} appears ${n} times in the manifest`);
  }
  for (const db of targets.drop_databases) if (db.name !== HISTORICAL_DATABASE) problems.push(`database drop ${db.name} is not policy.ts HISTORICAL_DATABASE`);
  const protectedNames = (db: string) => targets.protected.filter((p) => p.db === db).map((p) => p.name);
  if (canonicalSet(protectedNames(mainDb)) !== canonicalSet(NEVER_DROP)) problems.push("protected main namespaces differ from policy.ts NEVER_DROP");
  if (canonicalSet(protectedNames(adminDb)) !== canonicalSet(ADMIN_NEVER_DROP)) problems.push("protected Admin namespaces differ from policy.ts ADMIN_NEVER_DROP");
  if (targets.protected.some((p) => p.db !== mainDb && p.db !== adminDb)) problems.push("a protected namespace is outside the main/Admin databases");
  problems.push(...cleanupPolicyDrift(targets.cleanups, mainDb));
  return problems;
}

function cleanupPolicyDrift(cleanups: readonly Cleanup[], mainDb: string): string[] {
  const problems: string[] = [];
  const statuses = CLEANUP_STATUS as Record<string, string>;
  const scopes: Record<string, CleanupScope> = CLEANUP_SCOPES;
  const sameSet = (a: readonly string[], b: readonly string[]) => canonicalSet(a) === canonicalSet(b);
  for (const id of Object.keys(scopes)) {
    const n = cleanups.filter((c) => c.id === id).length;
    if (n !== 1) problems.push(`policy cleanup ${id} appears ${n} times in the manifest (expected once)`);
  }
  for (const cleanup of cleanups) {
    const expected = statuses[cleanup.id];
    const scope = scopes[cleanup.id];
    if (!expected || !scope) {
      problems.push(`cleanup ${cleanup.id} is not in policy.ts CLEANUP_STATUS/CLEANUP_SCOPES`);
      continue;
    }
    if (cleanup.status !== expected) problems.push(`cleanup ${cleanup.id} is ${cleanup.status} in the manifest but ${expected} in policy.ts`);
    if (cleanup.db !== mainDb) problems.push(`cleanup ${cleanup.id} runs on ${cleanup.db}, not the main database`);
    if (cleanup.kind !== scope.kind || cleanup.collection !== scope.collection) {
      problems.push(`cleanup ${cleanup.id} is ${cleanup.kind} on ${cleanup.collection} in the manifest but ${scope.kind} on ${scope.collection} in policy.ts`);
      continue;
    }
    if (cleanup.kind === "unset_fields" && scope.kind === "unset_fields") {
      for (const field of cleanup.fields) if (!(scope.fields as readonly string[]).includes(field)) problems.push(`cleanup ${cleanup.id} unsets ${field}, which policy.ts does not list as dead`);
      if (!sameSet(cleanup.fields, scope.fields)) problems.push(`cleanup ${cleanup.id} fields differ from policy.ts`);
    }
    if (cleanup.kind === "retire_jobs" && scope.kind === "retire_jobs") {
      if (!sameSet(cleanup.stages, scope.stages)) problems.push(`cleanup ${cleanup.id} stages differ from policy.ts LEGACY_JOB_STAGES`);
      if (cleanup.reason !== scope.reason) problems.push(`cleanup ${cleanup.id} reason differs from policy.ts`);
    }
    if (cleanup.kind === "delete_exact" && scope.kind === "delete_exact") {
      if (cleanup.key_field !== scope.key_field) problems.push(`cleanup ${cleanup.id} key field ${cleanup.key_field} differs from policy.ts ${scope.key_field}`);
      for (const value of cleanup.key_values) if (!(scope.key_values as readonly string[]).includes(value)) problems.push(`cleanup ${cleanup.id} deletes ${cleanup.key_field}=${value}, which policy.ts does not list`);
    }
    if (cleanup.kind === "delete_filter" && scope.kind === "delete_filter" && canonicalJson(normalizeFilter(cleanup.filter)) !== canonicalJson(normalizeFilter(scope.filter))) {
      problems.push(`cleanup ${cleanup.id} filter differs from policy.ts (event kinds or actor kinds)`);
    }
  }
  return problems;
}

/** `$in` lists compared as sets. */
function normalizeFilter(filter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filter).map(([k, v]) => {
      const list = (v as { $in?: unknown } | null)?.$in;
      return [k, Array.isArray(list) ? { $in: [...new Set(list.map(String))].sort() } : v];
    }),
  );
}

function canonicalSet(values: readonly string[]): string {
  return JSON.stringify([...new Set(values)].sort());
}

/**
 * `unset_fields` paths: plain dotted names, or one all-elements `$[]` segment (`recordings.$[].lead_conversation_id`).
 * Never `$`, `$[<id>]`, a trailing `$[]` or two `$[]` segments.
 */
const UNSET_PATH = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*(\.\$\[\]\.[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*)?$/;
export function assertUnsetPath(path: string): void {
  if (!UNSET_PATH.test(path)) throw new PurgeAbort(`unset path ${path} is not a plain dotted path with at most one inner $[]`);
}

/**
 * The query selecting documents on which `$unset` of `path` changes something. For an all-elements path the array must
 * be an array (so `$[]` cannot fail on an embedded document) and some element must carry the field.
 */
export function unsetPathFilter(path: string): Filter<Document> {
  assertUnsetPath(path);
  const at = path.indexOf(".$[].");
  if (at < 0) return { [path]: { $exists: true } };
  const array = path.slice(0, at);
  return { [array]: { $type: "array" }, [`${array}.${path.slice(at + 5)}`]: { $exists: true } };
}

/** A `delete_filter` may only use equality on scalars or a non-empty `$in` of scalars, so it cannot match broadly. */
export function assertClosedFilter(filter: Record<string, unknown>): void {
  const scalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
  if (!Object.keys(filter).length) throw new PurgeAbort("delete_filter is empty");
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("$")) throw new PurgeAbort(`delete_filter uses top-level operator ${key}`);
    if (scalar(value)) continue;
    const ops = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
    const values = ops[0]?.[1];
    const ok = ops.length === 1 && ops[0]![0] === "$in" && Array.isArray(values) && values.length > 0 && values.every(scalar);
    if (!ok) throw new PurgeAbort(`delete_filter field ${key} is not an equality or a non-empty scalar $in`);
  }
}

/** Every document a cleanup touches (and backs up). For `retire_jobs`: every row of the legacy stages. */
export function cleanupFilter(cleanup: Cleanup): Filter<Document> {
  switch (cleanup.kind) {
    case "unset_fields":
      if (!cleanup.fields.length) throw new PurgeAbort(`${cleanup.id} has no fields`);
      return { $or: cleanup.fields.map(unsetPathFilter) };
    case "retire_jobs":
      if (!cleanup.stages.length) throw new PurgeAbort(`${cleanup.id} has no stages`);
      return { stage: { $in: cleanup.stages } };
    case "delete_exact":
      return { [cleanup.key_field]: { $in: cleanup.key_values } };
    case "delete_filter":
      assertClosedFilter(cleanup.filter);
      return cleanup.filter as Filter<Document>;
  }
}

export const liveLeaseFilter = (stages: readonly string[], now: Date): Filter<Document> => ({
  stage: { $in: [...stages] },
  status: "leased",
  leased_until: { $gt: now },
});

/** Legacy rows still able to run: pending/retry/paused, or leased with an expired (or missing) lease. */
export const terminalizeFilter = (stages: readonly string[], now: Date): Filter<Document> => ({
  stage: { $in: [...stages] },
  $or: [{ status: { $in: [...NON_TERMINAL_JOB_STATUSES] } }, { status: "leased", $or: [{ leased_until: null }, { leased_until: { $lte: now } }] }],
});

export const terminalJobsFilter = (stages: readonly string[]): Filter<Document> => ({
  stage: { $in: [...stages] },
  status: { $in: [...TERMINAL_JOB_STATUSES] },
});

/** The backup directory must be absolute and outside the workspace (so a backup is never committed). */
export function assertBackupDir(dir: string | undefined, roots: readonly string[] = [WORKSPACE_ROOT, SERVER_ROOT]): string {
  if (!dir || !isAbsolute(dir)) throw new PurgeAbort("--backup-dir must be an absolute path");
  const resolved = resolve(dir);
  for (const root of roots) {
    const rel = relative(root, resolved);
    if (!rel.startsWith("..") && !isAbsolute(rel)) throw new PurgeAbort(`--backup-dir ${resolved} is inside ${root}`);
  }
  return resolved;
}

export type GitProbe = (args: string[]) => boolean;
const gitProbe: GitProbe = (args) => {
  try {
    execFileSync("git", args, { cwd: SERVER_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Problems with the recorded deployed server commit: it must be known, descend from the baseline and lack retired models. */
export function deploymentProblems(commit: string | null, probe: GitProbe = gitProbe): string[] {
  if (!commit) return ["no deployed server commit is recorded (sales_intelligence_sync_state scope 'deployment')"];
  if (!probe(["cat-file", "-e", `${commit}^{commit}`])) return [`deployed commit ${commit} is unknown locally; fetch it first`];
  const problems: string[] = [];
  if (!probe(["merge-base", "--is-ancestor", BASELINE_COMMIT, commit])) problems.push(`deployed commit ${commit} does not descend from the slimming baseline ${BASELINE_COMMIT}`);
  for (const path of RETIRED_MARKER_PATHS)
    if (probe(["cat-file", "-e", `${commit}:${path}`])) problems.push(`deployed commit ${commit} still contains ${path}: the slim server is not deployed`);
  return problems;
}

/**
 * Every object under the Blob prefix must be a manifest key. An unlisted object means a writer is still uploading
 * conversation media (an old server is live) or the manifest is stale: step (a) and step (g) both abort on it.
 */
export function unlistedBlobProblems(listed: readonly { pathname: string }[], manifestKeys: readonly string[], prefix: string): string[] {
  const manifestSet = new Set(manifestKeys);
  const unlisted = listed.filter((o) => o.pathname.startsWith(prefix) && !manifestSet.has(o.pathname)).map((o) => o.pathname);
  if (!unlisted.length) return [];
  return [
    `${unlisted.length} object(s) under ${prefix} are not in the manifest (e.g. ${unlisted.slice(0, 3).join(", ")}): a writer is still uploading or the manifest is stale`,
  ];
}

/**
 * Step (d) plan from a fresh listing taken immediately before the delete: the exact manifest keys still present, and a
 * problem for every object under the prefix that the manifest does not list (the run aborts before deleting anything).
 * Nothing outside the manifest key list is ever returned for deletion, whether or not the audio was backed up
 * (`--skip-blob-backup` changes only step (b)).
 */
export function blobDeletePlan(
  listed: readonly { pathname: string }[],
  manifestKeys: readonly string[],
  prefix: string,
): { toDelete: string[]; alreadyAbsent: number; problems: string[] } {
  const problems = [...unlistedBlobProblems(listed, manifestKeys, prefix)];
  const outside = manifestKeys.filter((k) => !k.startsWith(prefix));
  if (outside.length) problems.push(`${outside.length} manifest Blob key(s) are outside ${prefix}`);
  const present = new Set(listed.map((o) => o.pathname));
  const toDelete = manifestKeys.filter((k) => k.startsWith(prefix) && present.has(k));
  return { toDelete, alreadyAbsent: manifestKeys.length - toDelete.length, problems };
}

/** The ids of `ids` that no backup of this cleanup holds yet; they must be backed up before any mutation touches them. */
export function idsMissingFromBackup(ids: readonly unknown[], backedUp: ReadonlySet<string>): unknown[] {
  return ids.filter((id) => !backedUp.has(idKey(id)));
}

export type BackupLedger = { backup_done: boolean; backups: readonly BackupEntry[] };

/**
 * Resume only: every backup this run recorded (Mongo files: count + sha256 re-read; Blob files: size + sha256 on
 * disk) must still verify before any further mutation. Returns one problem per failing file.
 */
export async function runBackupProblems(
  ledger: BackupLedger,
  runDir: string,
  blobFiles: ReadonlyArray<{ key: string; bytes: number; sha256: string }>,
  verify: (file: string, expected: { documents: number; sha256: string }) => Promise<void> = verifyBackupFile,
  verifyBlob: (file: string, expected: { listedSize: number; streamedSha256?: string }) => Promise<unknown> = verifyBlobBackupFile,
): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of ledger.backups) {
    try {
      await verify(join(runDir, entry.file), entry);
    } catch (error) {
      problems.push(`backup ${entry.file} does not verify (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  for (const file of blobFiles) {
    try {
      await verifyBlob(join(runDir, "blob", file.key), { listedSize: file.bytes, streamedSha256: file.sha256 });
    } catch (error) {
      problems.push(`blob backup ${file.key} does not verify (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return problems;
}

/**
 * Null when this run recorded a full (unfiltered) backup of `namespace` whose document count the manifest accepts
 * and whose file still verifies on disk (count + sha256); otherwise the reason it does not. A drop target that is
 * already absent on resume counts as dropped only when this returns null.
 */
export async function verifiedFullBackupProblem(
  ledger: BackupLedger,
  runDir: string,
  namespace: string,
  countAccepted: (documents: number) => boolean,
  verify: (file: string, expected: { documents: number; sha256: string }) => Promise<void> = verifyBackupFile,
): Promise<string | null> {
  if (!ledger.backup_done) return `${namespace}: this run's backups are not complete`;
  const entry = ledger.backups.find((b) => b.namespace === namespace && Object.keys(b.filter ?? {}).length === 0);
  if (!entry) return `${namespace}: no full backup recorded by this run`;
  if (!countAccepted(entry.documents)) return `${namespace}: backup holds ${entry.documents} documents, which the manifest does not accept`;
  try {
    await verify(join(runDir, entry.file), entry);
  } catch (error) {
    return `${namespace}: backup does not verify (${error instanceof Error ? error.message : String(error)})`;
  }
  return null;
}
