import { spawn } from "node:child_process";
// S9-READS isolated replica proof (C8–C11). Independent of .env and any inherited Atlas URI.
const database = "testvantagemovers_t3coverview";
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-overview.replica.test.ts"],
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
      SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
      SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
      SALES_INTELLIGENCE_DIRECTORY_SYNC: "false",
      SALES_INTELLIGENCE_MEDIA_ENABLED: "false",
      SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true",
      SALES_INTELLIGENCE_OUTREACH_ENSURE: "true",
      SALES_INTELLIGENCE_ATTENTION_V2: "true",
      SALES_INTELLIGENCE_ATTENTION_EVOLUTION: "true",
      SALES_INTELLIGENCE_CASE_FILE: "true",
      SALES_INTELLIGENCE_PROGRESS_PLAN: "true",
      SALES_INTELLIGENCE_STT_ENABLED: "false",
      SALES_INTELLIGENCE_OVERVIEW: "true",
      SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false",
      RINGCENTRAL_ACCOUNT_ID: "",
      CRON_SECRET: "synthetic-cron-secret",
      VANTAGE_API_SECRET: "synthetic-global",
      VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  },
);
console.log(`S9-READS isolated replica proof: ${database}; loopback replica csi01 on port 27189`);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  console.error("Unable to start isolated S9-READS replica proof");
  process.exitCode = 1;
});
