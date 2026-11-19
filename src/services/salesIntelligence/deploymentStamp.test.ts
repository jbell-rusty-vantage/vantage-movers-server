import assert from "node:assert/strict";
import { test } from "node:test";
import { decideProductionWriter, type RecordedDeployment } from "./deploymentStamp";

const A = "a".repeat(40), B = "b".repeat(40);
const recorded = (commit: string | null): RecordedDeployment => ({
  deployment_commit: commit, commit_source: commit ? "DEPLOYMENT_COMMIT_SHA" : null, recorded_at: new Date(), vercel_deployment_id: null,
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
