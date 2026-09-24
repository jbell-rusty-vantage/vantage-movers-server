import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
// LP-01/03/06 isolated replica proof (Lead progress projection, CRM disposition, override/reopen,
// authoritative Booking closure, H2 re-scan, time sorts, H7 latency). Independent of .env and Atlas.
// Team 4 AC5-PROGRESS: then the default-next-step proof (ATTENTION_EVOLUTION on), in its own database.
const suites = [
  { file: "scripts/dev_ops/test-csi-lead-progress.replica.test.ts", database: `testvantagemovers_lp01${randomBytes(6).toString("hex")}`, label: "LP-01" },
  { file: "scripts/dev_ops/test-csi-progress-evolution.replica.test.ts", database: `testvantagemovers_t4b${randomBytes(6).toString("hex")}`, label: "Team 4 AC5-PROGRESS" },
];
function run(index: number, worst: number) {
  const suite = suites[index];
  if (!suite) { process.exitCode = worst; return; }
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", suite.file], {
    stdio: "inherit",
    env: {
      ...process.env,
      CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: suite.database,
      MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
      SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
      SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false",
      SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_AUTO_ATTACH: "false",
      SALES_INTELLIGENCE_LEAD_PROGRESS: "true",
      RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  });
  console.log(`${suite.label} isolated replica proof: ${suite.database}; loopback replica csi01 on port 27189`);
  child.on("exit", code => run(index + 1, Math.max(worst, code ?? 1)));
  child.on("error", () => { console.error(`Unable to start isolated ${suite.label} replica proof`); process.exitCode = 1; });
}
run(0, 0);
