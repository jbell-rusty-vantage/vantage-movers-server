/**
 * CC-00 §5.2 drift guard, operator half. Every `ops/*` entry point that can write
 * production calls `assertProductionWriterMatchesDeployment()` after connecting to Mongo.
 *
 * When the target database is production it compares the local `git rev-parse HEAD` with the
 * commit the deployed server recorded (sync-state scope `deployment`) and refuses unless
 * `--allow-schema-drift` is passed. A newer local build writing fields the deployed schema
 * rejects is what stopped capture for hours on 2026-09-23 (§2.1).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import {
  decideProductionWriter,
  readRecordedDeployment,
  type RecordedDeployment,
  type WriterDecision,
} from "../../src/services/salesIntelligence/deploymentStamp";

export const ALLOW_SCHEMA_DRIFT_FLAG = "--allow-schema-drift";
/** Operator tooling roots: `ops/` is tracked, `scripts/` is local-only (gitignored). */
const OPERATOR_DIRS = ["ops", "scripts"] as const;

export class ProductionWriterRefusal extends Error {
  constructor(readonly decision: Extract<WriterDecision, { allowed: false }>) {
    super(`production writer refused (${decision.reason}): ${decision.detail}. Deploy this commit first, run from the deployed tree, or pass ${ALLOW_SCHEMA_DRIFT_FLAG}.`);
    this.name = "ProductionWriterRefusal";
  }
}

export type GuardSeams = {
  argv?: readonly string[];
  database?: () => string;
  localHead?: () => string | null;
  dirtySourcePaths?: () => string[];
  readDeployment?: () => Promise<RecordedDeployment | null>;
  log?: (line: string) => void;
};

function git(args: string[], trim = true): string | null {
  try {
    const out = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return trim ? out.trim() : out;
  } catch {
    return null;
  }
}

export const localGitHead = () => git(["rev-parse", "HEAD"]) || null;

/** Relative imports (`./x`, `../y`) of one TypeScript source: static `from "…"`, `import "…"` and `import("…")`. */
export function relativeImports(source: string): string[] {
  const out = new Set<string>();
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) out.add(match[1]!);
  return [...out];
}
function resolveModule(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}
/**
 * V-T3 M7: every file under `ops/` or `scripts/` that the entry script reaches through relative imports (plus
 * every one Node has already loaded), repo-relative with forward slashes. `src/` is covered by `git status` itself.
 */
export function scriptImportClosure(entry: string, root: string, loaded: readonly string[] = []): string[] {
  const toolDirs = OPERATOR_DIRS.map(dir => resolve(root, dir) + sep), seen = new Set<string>(), stack = [resolve(entry), ...loaded.map(f => resolve(f))];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !toolDirs.some(dir => file.startsWith(dir)) || !/\.tsx?$/.test(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const spec of relativeImports(readFileSync(file, "utf8"))) {
      const next = resolveModule(file, spec);
      if (next) stack.push(next);
    }
  }
  return [...seen].map(file => relative(root, file).split(sep).join("/")).sort();
}
function loadedModuleFiles(): string[] {
  try { return typeof require === "function" ? Object.keys(require.cache ?? {}) : []; } catch { return []; }
}

/**
 * Uncommitted changes the deployed build cannot contain (V-T3 M7: `ops/` and `scripts/` as well as `src/`):
 * - tracked changes and untracked, non-ignored files under `src/`, `ops/` and `scripts/` (`git status --ignored=no`);
 * - every `ops/` or `scripts/` file the running script imports that is not tracked at all (`scripts/` is
 *   gitignored, so an untracked script is invisible to `git status`).
 */
export const dirtyGitSourcePaths = (entry: string | undefined = process.argv[1]) => {
  // The repository the running script lives in (the operator runs from its root; the script path decides).
  const root = git([...(entry ? ["-C", dirname(resolve(entry))] : []), "rev-parse", "--show-toplevel"]);
  const dirty = (git([...(root ? ["-C", root] : []), "status", "--porcelain", "--ignored=no", "-uall", "--", "src", ...OPERATOR_DIRS], false) ?? "")
    .split(/\r?\n/).map(line => line.slice(3).trim()).filter(Boolean);
  if (!root || !entry) return dirty;
  const imports = scriptImportClosure(entry, root, loadedModuleFiles());
  if (!imports.length) return dirty;
  const tracked = new Set((git(["-C", root, "ls-files", "--", ...imports]) ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  return [...dirty, ...imports.filter(file => !tracked.has(file)).map(file => `${file} (imported, untracked)`)];
};

export async function assertProductionWriterMatchesDeployment(seams: GuardSeams = {}): Promise<WriterDecision & { allowed: true }> {
  const argv = seams.argv ?? process.argv;
  const database = (seams.database ?? getMongoDatabaseName)();
  const production = database === "vantagemovers";
  const decision = decideProductionWriter({
    database,
    localHead: production ? (seams.localHead ?? localGitHead)() : null,
    dirtySourcePaths: production ? (seams.dirtySourcePaths ?? dirtyGitSourcePaths)() : [],
    recorded: production ? await (seams.readDeployment ?? readRecordedDeployment)() : null,
    allowSchemaDrift: argv.includes(ALLOW_SCHEMA_DRIFT_FLAG),
  });
  if (!decision.allowed) throw new ProductionWriterRefusal(decision);
  (seams.log ?? (line => console.log(line)))(JSON.stringify({ production_writer_guard: decision.reason, database, ...(decision.detail ? { detail: decision.detail } : {}) }));
  return decision;
}
