import { spawn } from "node:child_process";
// All Numbers v2 replica proof (ops/numbers-v2/all-numbers.replica.test.ts). Loopback csi01 replica only; no provider traffic.
// Needs Docker `csi01` (mongo:8.0 --replSet csi01 --port 27189). CI does not run it.
const database = "testvantagemovers_allnumbers";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE|MONGO/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./ops/test-setup.ts", "--test", "ops/numbers-v2/all-numbers.replica.test.ts"], {
  stdio: "inherit",
  env: {
    ...env, DOTENV_CONFIG_PATH: "C:/nonexistent.env", CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true",
    SALES_INTELLIGENCE_FORM_LEAD_NUMBERS: "true",
    RINGCENTRAL_ACCOUNT_ID: "", RC_TOKEN_STORE: "file", AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", VERCEL_OIDC_TOKEN: "",
    CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
  },
});
console.log(`All Numbers v2 replica proof: ${database}; loopback replica csi01:27189`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the All Numbers replica proof"); process.exitCode = 1; });
