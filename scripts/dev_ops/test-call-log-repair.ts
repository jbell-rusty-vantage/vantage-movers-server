import { spawn } from "node:child_process";
// CC-07 isolated replica proof (Call Log repair: classify, apply live, in-process downstream, holds, resume).
// Loopback csi01 only; RingCentral pages, recording media, STT and the analysis model step are synthetic/faked.
const database = "testvantagemovers_ccrepair";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-call-log-repair.replica.test.ts"], {
  stdio: "inherit",
  env: {
    ...env, CC_DEBUG: process.env.CC_DEBUG ?? "", CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_MEDIA_ENABLED: "true",
    SALES_INTELLIGENCE_STT_ENABLED: "true", SALES_INTELLIGENCE_EXTRACTION_ENABLED: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true",
    SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false", SALES_INTELLIGENCE_PERSONAL_LEDGER: "true", SALES_INTELLIGENCE_STT_CENTS_PER_SECOND: "0.01",
    // Empty, not absent: a transitive dotenv/config import must not refill provider credentials from .env.
    AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "",
    RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global",
    VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
  },
});
console.log(`CC-07 Call Log repair replica proof: ${database}; loopback replica csi01:27189; synthetic provider, faked model steps`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the CC-07 replica proof"); process.exitCode = 1; });
