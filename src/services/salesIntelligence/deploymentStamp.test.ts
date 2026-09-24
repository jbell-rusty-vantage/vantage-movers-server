import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideProductionWriter,
  deployedCommitFromEnv,
  DEPLOYMENT_SYNC_SCOPE,
  recordDeploymentCommit,
  recordDeploymentCommitOnce,
  resetDeploymentStamp,
  type RecordedDeployment,
} from "./deploymentStamp";

const A = "a".repeat(40), B = "b".repeat(40);
const recorded = (commit: string | null): RecordedDeployment => ({
  deployment_commit: commit, commit_source: commit ? "DEPLOYMENT_COMMIT_SHA" : null, recorded_at: new Date(), vercel_deployment_id: null,
});

test("deployed commit: Vercel git SHA first, then the CLI deploy constant; anything else is not a commit", () => {
  assert.deepEqual(deployedCommitFromEnv({ VERCEL_GIT_COMMIT_SHA: A, DEPLOYMENT_COMMIT_SHA: B }), { commit: A, source: "VERCEL_GIT_COMMIT_SHA" });
  assert.deepEqual(deployedCommitFromEnv({ VERCEL_GIT_COMMIT_SHA: "", DEPLOYMENT_COMMIT_SHA: ` ${B.toUpperCase()} ` }), { commit: B, source: "DEPLOYMENT_COMMIT_SHA" });
  assert.equal(deployedCommitFromEnv({ DEPLOYMENT_COMMIT_SHA: "main" }), null);
  assert.equal(deployedCommitFromEnv({}), null);
});

test("only a Vercel production deployment records itself, with $set of its own fields", async () => {
  const writes: Array<{ filter: object; update: Record<string, Record<string, unknown>>; options: object }> = [];
  const collection = () => ({ updateOne: async (filter: object, update: object, options: object) => { writes.push({ filter, update: update as never, options }); } });
  const now = () => new Date("2026-09-24T00:00:00Z");
  assert.equal(await recordDeploymentCommit({ env: { VERCEL: "1", VERCEL_ENV: "preview", DEPLOYMENT_COMMIT_SHA: A }, collection, now }), "skipped");
  assert.equal(await recordDeploymentCommit({ env: { DEPLOYMENT_COMMIT_SHA: A }, collection, now }), "skipped");
  assert.equal(writes.length, 0);
  assert.equal(await recordDeploymentCommit({ env: { VERCEL: "1", VERCEL_ENV: "production", DEPLOYMENT_COMMIT_SHA: A, VERCEL_DEPLOYMENT_ID: "dpl_1" }, collection, now }), "recorded");
  assert.deepEqual(writes[0], {
    filter: { scope: DEPLOYMENT_SYNC_SCOPE },
    update: { $set: { deployment_commit: A, commit_source: "DEPLOYMENT_COMMIT_SHA", vercel_deployment_id: "dpl_1", recorded_at: now() },
      $setOnInsert: { scope: DEPLOYMENT_SYNC_SCOPE } },
    options: { upsert: true },
  });
  // A production deployment without a commit records null, so the guard refuses rather than trusting a stale value.
  await recordDeploymentCommit({ env: { VERCEL: "1", VERCEL_ENV: "production" }, collection, now });
  assert.equal(writes[1]!.update.$set!.deployment_commit, null);
});

test("recordDeploymentCommitOnce never throws and retries after a failed write", async () => {
  resetDeploymentStamp();
  let calls = 0;
  const env = { VERCEL: "1", VERCEL_ENV: "production", DEPLOYMENT_COMMIT_SHA: A };
  const failing = () => ({ updateOne: async () => { calls++; throw new Error("down"); } });
  await recordDeploymentCommitOnce({ env, collection: failing });
  await recordDeploymentCommitOnce({ env, collection: failing });
  assert.equal(calls, 2);
  const ok = () => ({ updateOne: async () => { calls++; } });
  await recordDeploymentCommitOnce({ env, collection: ok });
  await recordDeploymentCommitOnce({ env, collection: ok });
  assert.equal(calls, 3);
  resetDeploymentStamp();
});

test("assertProductionWriterMatchesDeployment decision: refuses a production writer whose commit differs", () => {
  const base = { database: "vantagemovers", localHead: A, dirtySourcePaths: [] as string[], recorded: recorded(A), allowSchemaDrift: false };
  assert.deepEqual(decideProductionWriter(base), { allowed: true, reason: "commit_matches" });
  const differs = decideProductionWriter({ ...base, recorded: recorded(B) });
  assert.equal(differs.allowed, false);
  assert.equal(differs.reason, "commit_differs");
  assert.match(differs.allowed ? "" : differs.detail, new RegExp(B));
  assert.equal(decideProductionWriter({ ...base, recorded: null }).reason, "deployment_not_recorded");
  assert.equal(decideProductionWriter({ ...base, recorded: recorded(null) }).reason, "deployment_not_recorded");
  assert.equal(decideProductionWriter({ ...base, localHead: null }).reason, "local_head_unknown");
  assert.equal(decideProductionWriter({ ...base, dirtySourcePaths: ["src/models/ContactNumber.ts"] }).reason, "working_tree_dirty");
  assert.deepEqual(decideProductionWriter({ ...base, recorded: recorded(B), allowSchemaDrift: true }).reason, "drift_allowed");
  // Non-production targets are never gated.
  assert.equal(decideProductionWriter({ ...base, database: "testvantagemovers_ccrepair", recorded: recorded(B) }).allowed, true);
  assert.equal(decideProductionWriter({ ...base, database: "testvantagemovers", recorded: null }).reason, "not_production");
});
