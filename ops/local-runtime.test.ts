import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { apiEnvironment, assertApiIdentity } from "./local-runtime";

test("API readiness requires the real connection and exact synthetic database identity", () => {
  const valid = { ok: true, readyState: 1, host: "127.0.0.1", name: "testvantagemovers_agent", expectedName: "testvantagemovers_agent" };
  assert.doesNotThrow(() => assertApiIdentity(valid));
  for (const value of [null, {}, { ...valid, ok: false }, { ...valid, readyState: 0 },
    { ...valid, host: "production.mongodb.net" }, { ...valid, host: "localhost" },
    { ...valid, name: "vantagemovers" }, { ...valid, name: "testvantagemovers" },
    { ...valid, expectedName: "vantagemovers" }]) {
    assert.throws(() => assertApiIdentity(value), /local_api_identity_mismatch/);
  }
});

test("actual child ignores hostile inherited credentials, Node injection and a private .env", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "vantage-launch-test-"));
  const envFile = path.join(fixture, ".env");
  const privateEnv = "CRM_API_ID=private-sentinel\nRC_JWT=private-token\nMONGO_URI=mongodb+srv://private.invalid\nTEST_MODE=false\n";
  writeFileSync(envFile, privateEnv);
  try {
    const env = apiEnvironment({ ...process.env, NODE_OPTIONS: "--require=hostile-missing-module", NODE_PATH: fixture,
      MONGO_URI: "mongodb+srv://hostile.invalid", TEST_MODE: "false", GOOGLE_SERVICE_ACCOUNT_JSON: "hostile-credential",
      RC_JWT: "hostile-token", DOTENV_CONFIG_PATH: envFile, DOTENV_CONFIG_OVERRIDE: "true", UNKNOWN_FUTURE_PROVIDER_SECRET: "hostile-secret" });
    const dotenv = path.resolve(__dirname, "../node_modules/dotenv/config.js");
    const child = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(dotenv)}); console.log(JSON.stringify({ mongo:process.env.MONGO_URI, test:process.env.TEST_MODE, database:process.env.TEST_MONGO_DATABASE_NAME, secret:process.env.VANTAGE_API_SECRET, leaked:['CRM_API_ID','RC_JWT','GOOGLE_SERVICE_ACCOUNT_JSON','NODE_OPTIONS','NODE_PATH','UNKNOWN_FUTURE_PROVIDER_SECRET','VANTAGE_TEST_RUNNER'].filter(k=>process.env[k]!==undefined) }));`], {
      cwd: fixture, env, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.deepEqual(result, { mongo: "mongodb://127.0.0.1:27017/?directConnection=true", test: "true", database: "testvantagemovers_agent", secret: "local-dev-secret", leaked: [] });
    assert.equal(readFileSync(envFile, "utf8"), privateEnv, "user .env is untouched");
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("active onboarding links resolve in a standalone checkout", () => {
  const root = path.resolve(__dirname, "..");
  for (const filename of ["AGENTS.md", "CLOUD_AGENTS.md", "docs/operations/README.md", "docs/operations/sheet-sync.md"]) {
    const document = readFileSync(path.join(root, filename), "utf8");
    for (const match of document.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const destination = match[1]!.split("#")[0]!;
      if (!destination || /^[a-z]+:/i.test(destination)) continue;
      assert.equal(existsSync(path.resolve(root, path.dirname(filename), destination)), true, filename + ": " + destination);
    }
  }
});
