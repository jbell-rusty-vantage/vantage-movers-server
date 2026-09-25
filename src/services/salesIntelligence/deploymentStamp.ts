import { logger } from "../../logger";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";

/**
 * Drift guard, server half (Call Log capture completeness §5.2, CC-00).
 *
 * The production server records which commit it runs in `sales_intelligence_sync_state`
 * scope `deployment`, so an operator script that writes production can refuse to run from
 * a different tree. §2.1: a backfill running newer code wrote Contact Number fields the
 * deployed schema rejected, and capture failed for hours.
 *
 * Written through the raw collection with `$set` of its own fields only: the sync-state
 * schema belongs to capture, and this row must never need a schema change to be written.
 */
export const DEPLOYMENT_SYNC_SCOPE = "deployment";

export type DeployedCommit = { commit: string; source: "VERCEL_GIT_COMMIT_SHA" | "DEPLOYMENT_COMMIT_SHA" };
export type RecordedDeployment = {
  deployment_commit: string | null;
  commit_source: string | null;
  recorded_at: Date | null;
  vercel_deployment_id: string | null;
};

const SHA = /^[0-9a-f]{40}$/i;

/**
 * Git integration deploys expose `VERCEL_GIT_COMMIT_SHA`. CLI deploys pass the constant
 * explicitly: `vercel deploy --prod -e DEPLOYMENT_COMMIT_SHA=$(git rev-parse HEAD)`.
 */
export function deployedCommitFromEnv(env: NodeJS.ProcessEnv = process.env): DeployedCommit | null {
  for (const source of ["VERCEL_GIT_COMMIT_SHA", "DEPLOYMENT_COMMIT_SHA"] as const) {
    const value = env[source]?.trim();
    if (value && SHA.test(value)) return { commit: value.toLowerCase(), source };
  }
  return null;
}

type StampCollection = {
  updateOne(filter: object, update: object, options: { upsert: boolean }): Promise<unknown>;
};

export type RecordDeploymentDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  collection?: () => StampCollection;
};

/**
 * Only a Vercel production deployment records itself: a preview, a local dev server or a
 * test pointed at the production database must never overwrite the deployed commit.
 */
export async function recordDeploymentCommit(deps: RecordDeploymentDeps = {}): Promise<"recorded" | "skipped"> {
  const env = deps.env ?? process.env;
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") return "skipped";
  const deployed = deployedCommitFromEnv(env);
  const collection = deps.collection?.() ?? (getSalesIntelligenceSyncStateModel().collection as unknown as StampCollection);
  await collection.updateOne(
    { scope: DEPLOYMENT_SYNC_SCOPE },
    {
      $set: {
        deployment_commit: deployed?.commit ?? null,
        commit_source: deployed?.source ?? null,
        vercel_deployment_id: env.VERCEL_DEPLOYMENT_ID?.trim() || null,
        recorded_at: (deps.now ?? (() => new Date()))(),
      },
      $setOnInsert: { scope: DEPLOYMENT_SYNC_SCOPE },
    },
    { upsert: true },
  );
  return "recorded";
}

let recorded: Promise<unknown> | null = null;

/** Once per process; a failed write is retried on the next cron hit and never fails the caller. */
export function recordDeploymentCommitOnce(deps: RecordDeploymentDeps = {}): Promise<unknown> {
  recorded ??= recordDeploymentCommit(deps).catch((error: unknown) => {
    recorded = null;
    logger.warn({
      msg: "sales_intelligence.deployment_stamp.failed",
      errorName: error instanceof Error ? error.name : "Error",
    });
  });
  return recorded;
}

/** Test seam. */
export function resetDeploymentStamp(): void {
  recorded = null;
}

export async function readRecordedDeployment(): Promise<RecordedDeployment | null> {
  const row = (await getSalesIntelligenceSyncStateModel().collection.findOne({ scope: DEPLOYMENT_SYNC_SCOPE })) as
    | (Partial<RecordedDeployment> & { scope: string })
    | null;
  if (!row) return null;
  return {
    deployment_commit: typeof row.deployment_commit === "string" ? row.deployment_commit : null,
    commit_source: typeof row.commit_source === "string" ? row.commit_source : null,
    recorded_at: row.recorded_at instanceof Date ? row.recorded_at : null,
    vercel_deployment_id: typeof row.vercel_deployment_id === "string" ? row.vercel_deployment_id : null,
  };
}

export const PRODUCTION_DATABASE_NAME = "vantagemovers";

export type WriterDecision =
  | { allowed: true; reason: "not_production" | "commit_matches" | "drift_allowed"; detail?: string }
  | { allowed: false; reason: "deployment_not_recorded" | "commit_differs" | "working_tree_dirty" | "local_head_unknown"; detail: string };

/**
 * Pure decision for `assertProductionWriterMatchesDeployment`. Production data is only
 * written by the deployed build (R6): a local tree that differs from the recorded
 * deployment, or has uncommitted `src/` changes, is refused unless drift is explicitly allowed.
 */
export function decideProductionWriter(input: {
  database: string;
  localHead: string | null;
  dirtySourcePaths: readonly string[];
  recorded: RecordedDeployment | null;
  allowSchemaDrift: boolean;
}): WriterDecision {
  if (input.database !== PRODUCTION_DATABASE_NAME) return { allowed: true, reason: "not_production" };
  const refusal = ((): WriterDecision | null => {
    if (!input.localHead) return { allowed: false, reason: "local_head_unknown", detail: "git rev-parse HEAD failed" };
    const deployed = input.recorded?.deployment_commit ?? null;
    if (!deployed)
      return { allowed: false, reason: "deployment_not_recorded",
        detail: "sales_intelligence_sync_state scope 'deployment' has no deployment_commit; the deployed build predates the stamp or the CLI deploy omitted -e DEPLOYMENT_COMMIT_SHA" };
    if (deployed.toLowerCase() !== input.localHead.toLowerCase())
      return { allowed: false, reason: "commit_differs", detail: `local HEAD ${input.localHead} differs from deployed ${deployed}` };
    if (input.dirtySourcePaths.length)
      return { allowed: false, reason: "working_tree_dirty", detail: `uncommitted src/ or scripts/ changes: ${input.dirtySourcePaths.slice(0, 5).join(", ")}` };
    return null;
  })();
  if (!refusal) return { allowed: true, reason: "commit_matches" };
  if (input.allowSchemaDrift) return { allowed: true, reason: "drift_allowed", detail: refusal.detail };
  return refusal;
}
