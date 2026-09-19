import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/test-csi-owner.replica.test.ts"], {
  stdio: "inherit", env: { ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true",
    TEST_MONGO_DATABASE_NAME: `testvantagemovers_csi18${randomBytes(6).toString("hex")}`,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "true",
    SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-proof-signature-secret" },
});
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { process.exitCode = 1; });
