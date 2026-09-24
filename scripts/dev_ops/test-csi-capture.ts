import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
// CSI-02 isolated replica proof. Deliberately independent of .env and any inherited Atlas URI.
// An explicit loopback test database (`TEST_MONGO_DATABASE_NAME=testvantagemovers_<alnum>`) is honoured so parallel worktrees stay apart.
const requested = process.env.TEST_MONGO_DATABASE_NAME?.trim() ?? "";
const database = /^testvantagemovers_[a-z0-9]+$/.test(requested)
  ? requested
  : `testvantagemovers_csi02${randomBytes(6).toString("hex")}`;
const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    "--import",
    "./scripts/test-setup.ts",
    "--test",
    "scripts/dev_ops/test-csi-capture.replica.test.ts",
  ],
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
      SALES_INTELLIGENCE_ENABLED: "false",
      SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
      SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
      RINGCENTRAL_ACCOUNT_ID: "",
    },
  },
);
console.log(
  `CSI-02 isolated replica proof: ${database}; loopback replica csi01 on port 27189`,
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  console.error("Unable to start isolated CSI-02 replica proof");
  process.exitCode = 1;
});
