import { spawn } from "node:child_process";
// S4-TIMELINE isolated replica proof. Independent of .env and of any inherited Atlas URI.
//   node --import tsx scripts/dev_ops/test-si-timeline.ts            seed testvantagemovers_s4timeline, prove B12/B13/D4/D6/fixes
//   node --import tsx scripts/dev_ops/test-si-timeline.ts --finalui  read only: B12 on the S0 seed (testvantagemovers_finalui)
const finalui = process.argv.includes("--finalui");
const database = finalui ? "testvantagemovers_finalui" : "testvantagemovers_s4timeline";
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-timeline.replica.test.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CSI_REPLICA_TEST: "true",
    TEST_MODE: "true",
    TEST_MONGO_DATABASE_NAME: database,
    SI_TIMELINE_MODE: finalui ? "finalui" : "seed",
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
    SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_ENABLED: "false",
    SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
    SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
    SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED: "",
    RINGCENTRAL_WEBHOOK_ENABLED: "false",
    RINGCENTRAL_ACCOUNT_ID: "",
    AI_GATEWAY_API_KEY: "",
    OPENAI_API_KEY: "",
  },
});
console.log(`S4-TIMELINE replica proof: ${database}; loopback replica csi01 on port 27189`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start the S4-TIMELINE replica proof"); process.exitCode = 1; });
