import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertProductionWriterMatchesDeployment, dirtyGitSourcePaths, ProductionWriterRefusal, relativeImports, scriptImportClosure, type GuardSeams } from "./production-writer-guard";

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

test("V-T3 M7: relative imports are read from static, side-effect and dynamic import forms", () => {
  assert.deepEqual(relativeImports(`import { a } from "./lib/a";\nimport "../b.js";\nconst c = await import("./c");\nimport x from "mongoose";\nimport { y } from "../../src/y";`).sort(),
    ["../../src/y", "../b.js", "./c", "./lib/a"]);
});

test("V-T3 M7: the dirty check covers ops/ and scripts/ (tracked edits, untracked files, untracked imports)", () => {
  const repo = mkdtempSync(join(tmpdir(), "t3b-guard-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("init", "-q"); git("config", "user.email", "t@example.test"); git("config", "user.name", "t"); git("config", "core.autocrlf", "false");
    mkdirSync(join(repo, "src"), { recursive: true }); mkdirSync(join(repo, "ops", "lib"), { recursive: true }); mkdirSync(join(repo, "scripts"), { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "ops/lib/fresh.ts\n");
    writeFileSync(join(repo, "src", "model.ts"), "export const m = 1;\n");
    writeFileSync(join(repo, "ops", "run.ts"), `import { tracked } from "./lib/tracked";\nimport { m } from "../src/model";\nexport const r = tracked + m;\n`);
    writeFileSync(join(repo, "ops", "lib", "tracked.ts"), "export const tracked = 1;\n");
    git("add", ".gitignore", "src", "ops"); git("commit", "-qm", "base");
    const entry = join(repo, "ops", "run.ts");
    assert.deepEqual(dirtyGitSourcePaths(entry), [], "a clean checkout of committed ops/ passes");
    assert.deepEqual(scriptImportClosure(entry, repo), ["ops/lib/tracked.ts", "ops/run.ts"], "src/ is left to git status");

    writeFileSync(join(repo, "ops", "lib", "tracked.ts"), "export const tracked = 2;\n");
    assert.deepEqual(dirtyGitSourcePaths(entry), ["ops/lib/tracked.ts"], "an edited tracked lib");
    git("checkout", "--", "ops/lib/tracked.ts");

    writeFileSync(join(repo, "ops", "lib", "fresh.ts"), "export const fresh = 1;\n");
    assert.deepEqual(dirtyGitSourcePaths(entry), [], "an ignored, untracked file nothing imports is not the run's code");
    writeFileSync(join(repo, "ops", "run.ts"), `import { tracked } from "./lib/tracked";\nimport { fresh } from "./lib/fresh";\nexport const r = tracked + fresh;\n`);
    assert.deepEqual(dirtyGitSourcePaths(entry), ["ops/run.ts", "ops/lib/fresh.ts (imported, untracked)"], "an imported lib never committed");
    git("checkout", "--", "ops/run.ts");

    writeFileSync(join(repo, "scripts", "other.ts"), "export {};\n");
    assert.deepEqual(dirtyGitSourcePaths(entry), ["scripts/other.ts"], "an untracked, non-ignored file under scripts/");
    rmSync(join(repo, "scripts", "other.ts"));
    writeFileSync(join(repo, "src", "model.ts"), "export const m = 2;\n");
    assert.deepEqual(dirtyGitSourcePaths(entry), ["src/model.ts"], "src/ as before");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
