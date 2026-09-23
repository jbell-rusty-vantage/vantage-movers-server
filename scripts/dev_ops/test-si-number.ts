import { spawn } from "node:child_process";
// S4-NUMBER isolated replica proof (V15 row scores, D5 two-Lead Number, D2 detail reads). Independent of .env and any inherited Atlas URI.
const database = "testvantagemovers_s4number";
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "scripts/dev_ops/test-si-number.replica.test.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CSI_REPLICA_TEST: "true",
      TEST_MODE: "true",
      TEST_MONGO_DATABASE_NAME: database,
      MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
      SHEET_SYNC_MODE: "disabled",
      SALES_INTELLIGENCE_ENABLED: "true",
      SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
      SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
      SALES_INTELLIGENCE_DIRECTORY_SYNC: "false",
      SALES_INTELLIGENCE_MEDIA_ENABLED: "false",
      SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true",
      SALES_INTELLIGENCE_STT_ENABLED: "false",
      RINGCENTRAL_ACCOUNT_ID: "",
    },
  },
);
console.log(`S4-NUMBER isolated replica proof: ${database}; loopback replica csi01 on port 27189`);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  console.error("Unable to start isolated S4-NUMBER replica proof");
  process.exitCode = 1;
});
