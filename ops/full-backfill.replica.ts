import { spawn } from "node:child_process";
// Full-backfill replica proof (ops/full-backfill.replica.test.ts). Loopback csi01 replica only; the model step is faked.
// Needs Docker `csi01` (mongo:8.0 --replSet csi01 --port 27189). CI does not run it.
const database = "testvantagemovers_fullbackfill";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./ops/test-setup.ts", "--test", "ops/full-backfill.replica.test.ts"], {
  stdio: "inherit",
  env: {
    ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_EXTRACTION_ENABLED: "true",
    SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false", SALES_INTELLIGENCE_PROGRESS_PLAN: "false",
    SALES_INTELLIGENCE_CASE_FILE: "true", SALES_INTELLIGENCE_PERSONAL_LEDGER: "true", SALES_INTELLIGENCE_EXTRACTION_MODEL: "openai/gpt-5.6-luna",
    // Empty, not absent: a transitive dotenv/config import must not refill provider credentials from .env.
    AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "", RINGCENTRAL_ACCOUNT_ID: "", RC_TOKEN_STORE: "file",
    CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
  },
});
console.log(`Full-backfill replica proof: ${database}; loopback replica csi01:27189; faked model steps`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the full-backfill replica proof"); process.exitCode = 1; });
