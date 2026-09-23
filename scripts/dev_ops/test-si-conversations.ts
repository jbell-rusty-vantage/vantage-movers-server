import { spawn } from "node:child_process";
// S4-CONV isolated replica proof (Owner conversation cards, transcript pages, media audit + stream with a fake blob reader).
// Loopback csi01 only; no model call, no blob store, every network call is refused, synthetic evidence only.
const database = "testvantagemovers_s4conv";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-conversations.replica.test.ts"], {
  stdio: "inherit",
  env: {
    ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false",
    SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_LEAD_PROGRESS: "false",
    // Empty, not absent: a transitive dotenv/config import must not refill provider credentials from .env.
    AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "",
    BLOB_READ_WRITE_TOKEN: "", BLOB_STORE_ID: "", RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret",
    VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
  },
});
console.log(`S4-CONV conversations disposable proof: ${database}; loopback replica csi01:27189; no model, no blob store, synthetic evidence only`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the S4-CONV replica proof"); process.exitCode = 1; });
