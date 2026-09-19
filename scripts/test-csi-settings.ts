import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const database = `testvantagemovers_csi09${randomBytes(6).toString("hex")}`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(RC_|RINGCENTRAL_|SALES_INTELLIGENCE_)/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/test-csi-settings.replica.test.ts"], {
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
    SALES_INTELLIGENCE_FIRST_ACTION_DUE_STAFFED_MINUTES: "45",
    SALES_INTELLIGENCE_STT_ENABLED: "false",
    SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false",
    SALES_INTELLIGENCE_NUDGE_ENABLED: "false",
    VANTAGE_API_SECRET: "synthetic-global",
    VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
  },
});
console.log(`CSI-09 isolated replica proof: ${database}; loopback csi01:27189; no .env`);
child.on("exit", (code) => { process.exitCode = code ?? 1; });
child.on("error", () => { process.exitCode = 1; });
