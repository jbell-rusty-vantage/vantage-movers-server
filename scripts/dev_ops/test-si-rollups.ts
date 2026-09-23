import { spawn } from "node:child_process";
// S1-ROLLUP isolated replica proof (B1). Independent of .env and any inherited Atlas URI; synthetic data only.
const database = "testvantagemovers_s1rollup";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-rollups.replica.test.ts"],
  {
    stdio: "inherit",
    env: {
      ...env,
      CSI_REPLICA_TEST: "true",
      TEST_MODE: "true",
      TEST_MONGO_DATABASE_NAME: database,
      MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
      SHEET_SYNC_MODE: "disabled",
      SALES_INTELLIGENCE_ENABLED: "true",
      SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
      SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
      SALES_INTELLIGENCE_DIRECTORY_SYNC: "false",
      SALES_INTELLIGENCE_MEDIA_ENABLED: "false",
      SALES_INTELLIGENCE_STT_ENABLED: "false",
      SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true",
      SALES_INTELLIGENCE_OUTREACH_ENSURE: "true",
      SALES_INTELLIGENCE_LEAD_PROGRESS: "false",
      // Audio purge off; 30-day transcript and activity windows so the proof's old rows are purged.
      SALES_INTELLIGENCE_RETENTION_AUDIO_DAYS: "0",
      SALES_INTELLIGENCE_RETENTION_TRANSCRIPT_DAYS: "30",
      SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS: "30",
      RINGCENTRAL_ACCOUNT_ID: "",
      CRON_SECRET: "synthetic-cron-secret",
      VANTAGE_API_SECRET: "synthetic-global",
      VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  },
);
console.log(`S1-ROLLUP isolated replica proof: ${database}; loopback replica csi01 on port 27189`);
child.on("exit", (code) => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the S1-ROLLUP replica proof"); process.exitCode = 1; });
