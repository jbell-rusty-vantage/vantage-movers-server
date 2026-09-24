import assert from "node:assert/strict";
import { test } from "node:test";
import { assertProductionWriterMatchesDeployment, ProductionWriterRefusal, type GuardSeams } from "./production-writer-guard";

const A = "1".repeat(40), B = "2".repeat(40);
const seams = (overrides: Partial<GuardSeams> = {}): GuardSeams => ({
  argv: [], database: () => "vantagemovers", localHead: () => A, dirtySourcePaths: () => [],
  readDeployment: async () => ({ deployment_commit: A, commit_source: "DEPLOYMENT_COMMIT_SHA", recorded_at: new Date(), vercel_deployment_id: null }),
  log: () => undefined, ...overrides,
});

test("refuses a production writer whose local HEAD differs from the deployed commit", async () => {
  await assert.rejects(
    assertProductionWriterMatchesDeployment(seams({ localHead: () => B })),
    (error: unknown) => error instanceof ProductionWriterRefusal && error.decision.reason === "commit_differs" && error.message.includes("--allow-schema-drift"),
  );
});

test("allows the deployed commit, an explicit drift override, and any non-production database", async () => {
  assert.equal((await assertProductionWriterMatchesDeployment(seams())).reason, "commit_matches");
  assert.equal((await assertProductionWriterMatchesDeployment(seams({ localHead: () => B, argv: ["--allow-schema-drift"] }))).reason, "drift_allowed");
  let read = false;
  const local = await assertProductionWriterMatchesDeployment(seams({ database: () => "testvantagemovers_ccrepair", readDeployment: async () => { read = true; return null; } }));
  assert.equal(local.reason, "not_production");
  assert.equal(read, false, "a local database never reads the production deployment row");
});

test("refuses when the deployment was never recorded or src/ has uncommitted changes", async () => {
  await assert.rejects(assertProductionWriterMatchesDeployment(seams({ readDeployment: async () => null })),
    (error: unknown) => error instanceof ProductionWriterRefusal && error.decision.reason === "deployment_not_recorded");
  await assert.rejects(assertProductionWriterMatchesDeployment(seams({ dirtySourcePaths: () => ["src/models/ContactNumber.ts"] })),
    (error: unknown) => error instanceof ProductionWriterRefusal && error.decision.reason === "working_tree_dirty");
});
