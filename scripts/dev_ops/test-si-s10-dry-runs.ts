import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
// S10-REPAIR C25 harness: every S10 dry run (and the read-only step 7/9 commands) against a copy of the final-UI seed.
// The copy is `mongodump | mongorestore` of `testvantagemovers_finalui` inside the csi01 container (read-only on the
// seed); the disposable copy `testvantagemovers_t3cs10<hex>` is dropped at the end. Production flags on.
const database = `testvantagemovers_t3cs10${randomBytes(5).toString("hex")}`;
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-s10-dry-runs.replica.test.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "true",
    SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false",
    SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_AUTO_ATTACH: "false",
    SALES_INTELLIGENCE_LEAD_PROGRESS: "true", SALES_INTELLIGENCE_ATTENTION_V2: "true", SALES_INTELLIGENCE_FORM_LEAD_NUMBERS: "true",
    SALES_INTELLIGENCE_ATTENTION_EVOLUTION: "true", SALES_INTELLIGENCE_CASE_FILE: "true", SALES_INTELLIGENCE_PROGRESS_PLAN: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "true",
    SALES_INTELLIGENCE_PRIORITY5_CLOSURE: "true", AI_GATEWAY_API_KEY: "",
    RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
  },
});
console.log(`S10 dry-run harness: ${database} (copy of testvantagemovers_finalui); loopback replica csi01 on port 27189`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the S10 dry-run harness"); process.exitCode = 1; });
