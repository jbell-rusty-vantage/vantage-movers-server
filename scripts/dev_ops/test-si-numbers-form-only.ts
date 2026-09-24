import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
// S5c-NUMBERS isolated replica proof (reconciliation addendum §3.5, C21, C25). Independent of .env and any
// inherited Atlas URI. The flag-off page is compared with the BASE code's page: `src/` at SI_NUMBERS_BASE_REF
// (default d57c4e2, the commit S5c-NUMBERS was cut from) is extracted under scripts/dev_ops/output (gitignored)
// and imported next to the new code, reading the same database.
const database = `testvantagemovers_t3cnumbers${randomBytes(5).toString("hex")}`;
const baseRef = process.env.SI_NUMBERS_BASE_REF?.trim() || "d57c4e2";
const baseDir = resolve("scripts/dev_ops/output", `si-numbers-base-${baseRef}`);
if (!existsSync(resolve(baseDir, "src/services/numberActivity/search.ts"))) {
  mkdirSync(baseDir, { recursive: true });
  const archive = spawnSync("git", ["archive", "--format=tar", baseRef, "src"], { maxBuffer: 512 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(`git archive ${baseRef} failed: ${archive.stderr.toString()}`);
  // `cwd`, not `-C <abs path>`: GNU tar (Git Bash) reads "C:" as a remote host.
  const untar = spawnSync("tar", ["-x", "-f", "-"], { cwd: baseDir, input: archive.stdout, maxBuffer: 64 * 1024 * 1024 });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr.toString()}`);
}
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-numbers-form-only.replica.test.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CSI_REPLICA_TEST: "true",
      TEST_MODE: "true",
      TEST_MONGO_DATABASE_NAME: database,
      MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
      SHEET_SYNC_MODE: "disabled",
      SALES_INTELLIGENCE_ENABLED: "true",
      // Production reality (TEAM-3 §4): the Team 4 flags are on.
      SALES_INTELLIGENCE_ATTENTION_EVOLUTION: "true",
      SALES_INTELLIGENCE_CASE_FILE: "true",
      SALES_INTELLIGENCE_PROGRESS_PLAN: "true",
      SALES_INTELLIGENCE_FORM_LEAD_NUMBERS: "true",
      SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
      SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
      // The test passes the flag through the `hasCallsDefault` seam; the env stays off.
      SALES_INTELLIGENCE_NUMBERS_HAS_CALLS_DEFAULT: "false",
      RINGCENTRAL_ACCOUNT_ID: "",
      AI_GATEWAY_API_KEY: "",
      PERSONAL_AI_GATEWAY_API_KEY: "",
      CRON_SECRET: "synthetic-cron-secret",
      VANTAGE_API_SECRET: "synthetic-global",
      VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
      SI_NUMBERS_BASE_DIR: baseDir,
    },
  },
);
console.log(`S5c-NUMBERS isolated replica proof: ${database}; base ${baseRef}; loopback replica csi01 on port 27189`);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  console.error("Unable to start isolated S5c-NUMBERS replica proof");
  process.exitCode = 1;
});
