/**
 * Pure purge rules: the exact Mongo filters each manifest cleanup selects, the closed-filter check for
 * `delete_filter`, the backup-directory guard and the deployed-commit check. `purge.ts` executes them; the
 * unit tests pin them.
 */
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Document, Filter } from "mongodb";
import { type BackupEntry, verifyBackupFile } from "./backup";
import { SERVER_ROOT, WORKSPACE_ROOT } from "./env";
import type { Cleanup } from "./manifest";

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
export const TERMINAL_JOB_STATUSES = ["completed", "dead_letter"] as const;

export class PurgeAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeAbort";
  }
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
      return { $or: cleanup.fields.map((f) => ({ [f]: { $exists: true } })) };
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

export type BackupLedger = { backup_done: boolean; backups: readonly BackupEntry[] };

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
