import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
// Deliberately independent of .env and any inherited Atlas URI.
const database = `testvantagemovers_csi${randomBytes(6).toString("hex")}`;
const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    "--import",
    "./scripts/test-setup.ts",
    "--test",
    "scripts/test-csi-foundation.replica.test.ts",
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
    },
  },
);
console.log(
  `CSI isolated replica proof: ${database}; loopback replica csi01 on port 27189`,
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  console.error("Unable to start isolated CSI replica proof");
  process.exitCode = 1;
});
