import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
// MA-02 isolated replica proof (Move assessment runtime: generation, reuse, fences, retention).
// Loopback csi01 only; the model is mocked and every network call is refused.
// Team 4 AC6-PLAN: then the progress re-plan proof (its own database; it turns its flags on in-process).
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const suites = [
  { file: "scripts/dev_ops/test-csi-move-assessment.replica.test.ts", database: `testvantagemovers_ma${randomBytes(6).toString("hex")}`, label: "MA-02 Move assessment" },
  { file: "scripts/dev_ops/test-csi-progress-replan.replica.test.ts", database: `testvantagemovers_t4c${randomBytes(6).toString("hex")}`, label: "Team 4 AC6-PLAN progress re-plan" },
];
function run(index: number, worst: number) {
  const suite = suites[index];
  if (!suite) { process.exitCode = worst; return; }
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", suite.file], {
    stdio: "inherit",
    env: {
      ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: suite.database,
      MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "true",
      SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_LEAD_PROGRESS: "false",
      SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION: "synthetic", SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION: "1",
      SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION: "1", SALES_INTELLIGENCE_EXTRACTION_MODEL: "openai/gpt-5-mini",
      // Empty, not absent: a transitive dotenv/config import must not refill provider credentials from .env.
      AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "",
      RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global",
      VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  });
  console.log(`${suite.label} disposable proof: ${suite.database}; loopback replica csi01:27189; mocked model, synthetic evidence only`);
  child.on("exit", code => run(index + 1, Math.max(worst, code ?? 1)));
  child.on("error", () => { console.error(`Unable to start the ${suite.label} replica proof`); process.exitCode = 1; });
}
run(0, 0);
