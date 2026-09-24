import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
// S5c-HEALTH isolated replica proof (C20: capture_health on the Owner coverage read, query bound, plans, p95).
// Independent of .env and any inherited Atlas URI; its own database, dropped at the end.
// Run through the lock: node C:/Users/Pinda/AppData/Local/Temp/t3tools/replica-lock.cjs "cd <worktree> && node --import tsx scripts/dev_ops/test-si-capture-health.ts"
const database = `testvantagemovers_t3bhealth${randomBytes(6).toString("hex")}`;
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-capture-health.replica.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
    RINGCENTRAL_COLLECTION_MODE: "test", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "true",
    SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "true", SALES_INTELLIGENCE_CALL_LOG_SYNC: "shadow",
    SALES_INTELLIGENCE_ATTENTION_EVOLUTION: "true", SALES_INTELLIGENCE_CASE_FILE: "true", SALES_INTELLIGENCE_PROGRESS_PLAN: "true",
    SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false",
    AI_GATEWAY_API_KEY: "", BLOB_READ_WRITE_TOKEN: "", BLOB_STORE_ID: "", RINGCENTRAL_ACCOUNT_ID: "",
  },
});
console.log(`S5c-HEALTH isolated replica proof: ${database}; loopback replica csi01 on port 27189`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start isolated S5c-HEALTH replica proof"); process.exitCode = 1; });
