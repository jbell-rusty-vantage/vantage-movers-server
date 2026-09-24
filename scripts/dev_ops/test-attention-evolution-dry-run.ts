import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
/** AC7-DRYRUN write-free proof: `node --import tsx scripts/dev_ops/test-attention-evolution-dry-run.ts` (T4C_DRYRUN_OUT=<dir> writes AC7-DRYRUN-replica.md) (disposable database). */
const database = `testvantagemovers_t4cdry${randomBytes(5).toString("hex")}`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "--test-reporter=tap", "scripts/dev_ops/test-attention-evolution-dry-run.replica.test.ts"], {
  stdio: "inherit", env: { ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
    SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true" } });
console.log(`AC7-DRYRUN proof (seed copy): ${database}; loopback replica csi01:27189; synthetic evidence only`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start local proof"); process.exitCode = 1; });
