/**
 * Old-deployment and no-late-write gates for `purge.ts` (pre-deploy audit, 2026-10-04; PREDEPLOY-AUDIT.md).
 *
 * Why: every queue publisher of the pre-slim server calls the top-level `@vercel/queue` `send`, which pins each message
 * to the publishing deployment (`Vqs-Deployment-Id` = `VERCEL_DEPLOYMENT_ID`). A message the old deployment published
 * before the cutover (a backlog item, a failed message retried every 30 s, a delayed `call_log_refresh` wake-up) is
 * delivered back to the OLD deployment, which runs OLD code, for up to the queue's default 24 h retention. That code
 * writes `operational_events` (and, through the incident path, incidents and notifications) and can re-create a
 * dropped collection. The old Admin writes `admin_audit_logs` the same way through its immutable URL. The slim code
 * cannot stop it; only removing the old deployments (or waiting out the retention) can. The purge therefore requires:
 *
 *   - `--cutover-at=<ISO>`: T0, when the production aliases moved to the slim server and Admin;
 *   - `--quiet-since=<ISO>`: the start of the last clean snapshot pair (CUTOVER.md step 5), at or after T0;
 *   - exactly one of
 *       `--old-deployments-removed=dpl_…[,dpl_…]`: the ids of the pre-slim server and Admin deployments removed with
 *         `vercel remove` (CUTOVER.md step 3b). Recorded in the run log; must not name the stamped slim deployment;
 *       `--old-deployments-kept`: no removal. Allowed only once `OLD_DEPLOYMENT_DRAIN_MS` has passed since T0 and no
 *         sales-intelligence job created before T0 is still claimable by an old consumer.
 *
 * And, at step (a) and again immediately before every drop, no drop target or historical collection may carry a
 * write (newest `_id` time, `updatedAt`, `createdAt`, `updated_at`, `created_at`) at or after `--quiet-since`.
 */
import { type Document, ObjectId, type Filter } from "mongodb";
import type { ReadOnlyCluster } from "./guarded-mongo";

/** Default queue retention (24 h) + `call_log_refresh` max age (45 min) + function `maxDuration` (800 s). */
export const OLD_DEPLOYMENT_DRAIN_MS = (24 * 3_600 + 45 * 60 + 800) * 1_000;
/** Statuses an old consumer can still claim (`claimCsiJob`: pending/retry when due, leased when the lease expired). */
export const CLAIMABLE_JOB_STATUSES = ["pending", "retry", "leased"] as const;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
/** Write timestamps the retired models carry (Mongoose `timestamps`, snake-case in the conversation/Admin models). */
export const WRITE_TIMESTAMP_FIELDS = ["updatedAt", "createdAt", "updated_at", "created_at"] as const;

export type CutoverGate = {
  cutoverAt: string | undefined;
  quietSince: string | undefined;
  removedDeployments: string[];
  oldDeploymentsKept: boolean;
};

export type NewestWrite = { ns: string; last_insert_at: string | null; last_write_field_at: string | null; field: string | null };

const parseIso = (value: string | undefined): Date | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
};

/** Reads the gate flags from argv (`--name=value` / `--name`). */
export function readCutoverGate(argValue: (name: string) => string | undefined, hasFlag: (name: string) => boolean): CutoverGate {
  const removed = argValue("old-deployments-removed");
  return {
    cutoverAt: argValue("cutover-at"),
    quietSince: argValue("quiet-since"),
    removedDeployments: removed ? removed.split(",").map((s) => s.trim()).filter(Boolean) : [],
    oldDeploymentsKept: hasFlag("old-deployments-kept"),
  };
}

export const cutoverGateGiven = (gate: CutoverGate): boolean =>
  Boolean(gate.cutoverAt || gate.quietSince || gate.removedDeployments.length || gate.oldDeploymentsKept);

/**
 * Problems with the cutover gate. Pure; unit-tested. `claimableBeforeCutover` is the number of sales-intelligence
 * jobs (any stage, any dataset) created before T0 that are still pending/retry/leased.
 */
export function cutoverGateProblems(
  gate: CutoverGate,
  ctx: { now: Date; stampDeploymentId: string | null; claimableBeforeCutover: number },
): string[] {
  const problems: string[] = [];
  const cutover = parseIso(gate.cutoverAt);
  const quiet = parseIso(gate.quietSince);
  if (!cutover) problems.push("--cutover-at=<ISO> is required: the instant the production aliases moved to the slim server and Admin (CUTOVER.md step 3)");
  if (!quiet) problems.push("--quiet-since=<ISO> is required: the observed_at of the earlier snapshot of the last clean pair (CUTOVER.md step 5)");
  if (cutover && cutover > ctx.now) problems.push(`--cutover-at ${cutover.toISOString()} is in the future`);
  if (quiet && quiet > ctx.now) problems.push(`--quiet-since ${quiet.toISOString()} is in the future`);
  if (cutover && quiet && quiet < cutover) problems.push(`--quiet-since ${quiet.toISOString()} is before --cutover-at ${cutover.toISOString()}`);

  const removed = gate.removedDeployments.length > 0;
  if (removed === gate.oldDeploymentsKept)
    problems.push("pass exactly one of --old-deployments-removed=dpl_…[,dpl_…] (CUTOVER.md step 3b) or --old-deployments-kept");
  if (removed) {
    for (const id of gate.removedDeployments) if (!DEPLOYMENT_ID.test(id)) problems.push(`--old-deployments-removed entry ${id} is not a Vercel deployment id (dpl_…)`);
    if (!ctx.stampDeploymentId) problems.push("the deployment stamp has no vercel_deployment_id, so the removed list cannot be checked against the live slim deployment");
    else if (gate.removedDeployments.includes(ctx.stampDeploymentId))
      problems.push(`--old-deployments-removed names ${ctx.stampDeploymentId}, the slim deployment that wrote the stamp`);
  }
  if (gate.oldDeploymentsKept && !removed) {
    if (cutover && ctx.now.getTime() - cutover.getTime() < OLD_DEPLOYMENT_DRAIN_MS) {
      const ready = new Date(cutover.getTime() + OLD_DEPLOYMENT_DRAIN_MS).toISOString();
      problems.push(`--old-deployments-kept: messages pinned to the old deployments can still be delivered until ${ready} (24 h queue retention + 45 min + 800 s); remove them (CUTOVER.md step 3b) or wait`);
    }
    if (ctx.claimableBeforeCutover > 0)
      problems.push(`--old-deployments-kept: ${ctx.claimableBeforeCutover} sales_intelligence_jobs created before --cutover-at are still claimable by an old consumer`);
  }
  return problems;
}

/** Jobs created before `cutoverAt` (ObjectId time) that a consumer can still claim. */
export function claimableBeforeFilter(cutoverAt: Date): Filter<Document> {
  return { _id: { $lt: ObjectId.createFromTime(Math.floor(cutoverAt.getTime() / 1_000)) }, status: { $in: [...CLAIMABLE_JOB_STATUSES] } };
}

/** One problem per namespace whose newest insert or write timestamp is at or after `quietSince`. Pure; unit-tested. */
export function writesAfterProblems(rows: readonly NewestWrite[], quietSince: Date): string[] {
  const since = quietSince.toISOString();
  // An ObjectId carries whole seconds: compare inserts against the start of the --quiet-since second.
  const sinceSecond = new Date(Math.floor(quietSince.getTime() / 1_000) * 1_000).toISOString();
  const problems: string[] = [];
  for (const row of rows) {
    if (row.last_insert_at && row.last_insert_at >= sinceSecond) problems.push(`${row.ns}: insert at ${row.last_insert_at}, at or after --quiet-since ${since} (a writer is still live)`);
    if (row.last_write_field_at && row.last_write_field_at >= since)
      problems.push(`${row.ns}: ${row.field} ${row.last_write_field_at}, at or after --quiet-since ${since} (a writer is still live)`);
  }
  return problems;
}

/** The aggregate that finds the newest write timestamp of a collection (one scan; dates only). */
export function newestWritePipeline(): Document[] {
  const max = (field: string) => ({ $max: { $cond: [{ $eq: [{ $type: `$${field}` }, "date"] }, `$${field}`, null] } });
  return [{ $group: { _id: null, ...Object.fromEntries(WRITE_TIMESTAMP_FIELDS.map((f) => [f, max(f)])) } }];
}

/** The newest insert (`_id` time, ObjectId ids only) and the newest write timestamp of one existing collection. */
export async function newestWrite(c: ReadOnlyCluster, db: string, name: string): Promise<NewestWrite> {
  const [lastId] = await c.find(db, name, {}, { projection: { _id: 1 }, sort: { _id: -1 }, limit: 1 });
  const [maxima] = await c.aggregate(db, name, newestWritePipeline());
  let field: string | null = null;
  let at: Date | null = null;
  for (const f of WRITE_TIMESTAMP_FIELDS) {
    const value = maxima?.[f];
    if (value instanceof Date && (!at || value > at)) {
      at = value;
      field = f;
    }
  }
  return {
    ns: `${db}.${name}`,
    last_insert_at: lastId?._id instanceof ObjectId ? lastId._id.getTimestamp().toISOString() : null,
    last_write_field_at: at ? at.toISOString() : null,
    field,
  };
}
