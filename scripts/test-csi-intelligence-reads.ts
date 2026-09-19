import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const database = `testvantagemovers_csi17reads${randomBytes(6).toString("hex")}`;
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/test-csi-intelligence-reads.replica.test.ts"], {
  stdio: "inherit", env: { ...process.env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
    SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false",
    AI_GATEWAY_API_KEY: "", BLOB_READ_WRITE_TOKEN: "", BLOB_STORE_ID: "", RINGCENTRAL_ACCOUNT_ID: "",
  },
});
console.log(`CSI-17 reads isolated replica proof: ${database}; loopback replica csi01 on port 27189`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start isolated CSI-17 reads replica proof"); process.exitCode = 1; });
