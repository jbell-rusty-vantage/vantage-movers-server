import { spawn } from "node:child_process";
// S5c-CALLS + S5c-RECOVERY isolated replica proof (reconciliation addendum §3.1, §3.3; C16, C17, C19, C25).
// Independent of .env and of any inherited Atlas URI; loopback csi01 only; no provider, model or queue traffic.
//   node --import tsx scripts/dev_ops/test-si-capture-recovery.ts
const database = "testvantagemovers_t3arecov";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-capture-recovery.replica.test.ts"], {
  stdio: "inherit",
  env: {
    ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "false",
    // Production has these on (brief §4): the Case File readers run with them.
    SALES_INTELLIGENCE_ATTENTION_EVOLUTION: "true", SALES_INTELLIGENCE_CASE_FILE: "true", SALES_INTELLIGENCE_PROGRESS_PLAN: "true",
    SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false", RINGCENTRAL_WEBHOOK_ENABLED: "false",
    AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "", RINGCENTRAL_ACCOUNT_ID: "",
    VANTAGE_API_SECRET: "synthetic-global",
  },
});
console.log(`S5c capture state + recovery replica proof: ${database}; loopback replica csi01 on port 27189`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the S5c replica proof"); process.exitCode = 1; });
