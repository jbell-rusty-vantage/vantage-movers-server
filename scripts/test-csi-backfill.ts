import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const database = `testvantagemovers_csi15${randomBytes(6).toString("hex")}`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(RC_|RINGCENTRAL_|SALES_INTELLIGENCE_)/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/test-csi-backfill.replica.test.ts"], {
  stdio: "inherit", env: { ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi15-backfill-proof",
    SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_BACKFILL_DAYS: "7",
    SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_STT_ENABLED: "false", SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false",
    SALES_INTELLIGENCE_NUDGE_ENABLED: "false", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature" },
});
console.log(`CSI-15 backfill isolated replica: ${database}; loopback csi01:27189; fake providers; no .env`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { process.exitCode = 1; });
