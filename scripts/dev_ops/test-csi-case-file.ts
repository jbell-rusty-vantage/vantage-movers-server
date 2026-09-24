import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
/**
 * K12 (Attention and Case File spec §4.14): the structured findings pipeline with the Case File on,
 * against the loopback replica, with a stubbed model. Disposable database `testvantagemovers_t4bcf<hex>`.
 *
 *   node --import tsx scripts/dev_ops/test-csi-case-file.ts
 */
const database = `testvantagemovers_t4bcf${randomBytes(6).toString("hex")}`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "--test-reporter=spec", "scripts/dev_ops/test-csi-case-file.replica.test.ts"], {
  stdio: "inherit", env: { ...env, CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01", SHEET_SYNC_MODE: "disabled",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_EXTRACTION_ENABLED: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true",
    SALES_INTELLIGENCE_SCOPED_KEY_NAME: "synthetic-intelligence", SALES_INTELLIGENCE_RUN_TOKEN_SECRET: "synthetic-intelligence-run-signature",
    VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-case-file-owner-signature", SALES_INTELLIGENCE_ANALYSIS_V3: "true", SALES_INTELLIGENCE_CASE_FILE: "true",
    VANTAGE_API_SECRET: "synthetic-global" } });
console.log(`Case File disposable proof: ${database}; loopback replica csi01:27189; synthetic evidence only`);
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { console.error("Unable to start local proof"); process.exitCode = 1; });
