/**
 * CC-00 §5.2 drift guard, operator half. Every `scripts/dev_ops/*` entry point that can write
 * production calls `assertProductionWriterMatchesDeployment()` after connecting to Mongo.
 *
 * When the target database is production it compares the local `git rev-parse HEAD` with the
 * commit the deployed server recorded (sync-state scope `deployment`) and refuses unless
 * `--allow-schema-drift` is passed. A newer local build writing fields the deployed schema
 * rejects is what stopped capture for hours on 2026-09-23 (§2.1).
 */
import { execFileSync } from "node:child_process";
import { getMongoDatabaseName } from "../../../src/config/domain/runtime";
import {
  decideProductionWriter,
  readRecordedDeployment,
  type RecordedDeployment,
  type WriterDecision,
} from "../../../src/services/salesIntelligence/deploymentStamp";

export const ALLOW_SCHEMA_DRIFT_FLAG = "--allow-schema-drift";

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

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export const localGitHead = () => git(["rev-parse", "HEAD"]) || null;
/** Uncommitted tracked or untracked changes under `src/`: the deployed build cannot contain them. */
export const dirtyGitSourcePaths = () =>
  (git(["status", "--porcelain", "--", "src"]) ?? "").split(/\r?\n/).map(line => line.slice(3).trim()).filter(Boolean);

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
