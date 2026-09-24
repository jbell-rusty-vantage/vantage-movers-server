import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
// CSI-06 isolated replica proof (directory sync, rebuild, admin routes). Independent of .env and any inherited Atlas URI.
// Team 4 (AC3/AC4/AC5-ACTIVITY): then the attention-evolution proof, flag on, in its own database.
const suites = [
  { file: "scripts/dev_ops/test-csi-outreach.replica.test.ts", database: `testvantagemovers_csi06${randomBytes(6).toString("hex")}`, label: "CSI-06" },
  { file: "scripts/dev_ops/test-csi-attention-evolution.replica.test.ts", database: `testvantagemovers_t4a${randomBytes(6).toString("hex")}`, label: "Team 4 AC3/AC4/AC5" },
];
function run(index: number, worst: number) {
  const suite = suites[index];
  if (!suite) { process.exitCode = worst; return; }
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", suite.file],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CSI_REPLICA_TEST: "true",
        TEST_MODE: "true",
        TEST_MONGO_DATABASE_NAME: suite.database,
        MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
        SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
        SHEET_SYNC_MODE: "disabled",
        SALES_INTELLIGENCE_ENABLED: "true",
        SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
        SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
        SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_STT_ENABLED: "false",
        RINGCENTRAL_ACCOUNT_ID: "",
        CRON_SECRET: "synthetic-cron-secret",
        VANTAGE_API_SECRET: "synthetic-global",
        VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
      },
    },
  );
  console.log(`${suite.label} isolated replica proof: ${suite.database}; loopback replica csi01 on port 27189`);
  child.on("exit", (code) => run(index + 1, Math.max(worst, code ?? 1)));
  child.on("error", () => {
    console.error(`Unable to start isolated ${suite.label} replica proof`);
    process.exitCode = 1;
  });
}
run(0, 0);
