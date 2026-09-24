/**
 * Local Owner API for browser verification against an isolated csi01 replica database.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/serve-csi-local.ts
 *
 * Environment: `CSI_LOCAL_DATABASE` (default `testvantagemovers_madem0`), `PORT` (default 3999),
 * `CSI_LOCAL_FLAGS` (optional, e.g. `ATTENTION_V2,TIMELINE_V2`; unlisted final-data flags are forced off).
 * The Mongo URI is hard-coded to loopback; Atlas is never reached. The Admin proxy signing
 * secret is read from `../vantage-admin/.env` so the isolated Admin copy can sign Owner
 * requests; the value is never printed. Company/personal gateway keys are removed from the
 * process so no route can start paid work from this server.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATABASE = process.env.CSI_LOCAL_DATABASE ?? "testvantagemovers_madem0";
if (!/^testvantagemovers_[a-z0-9]+$/.test(DATABASE)) throw new Error("CSI_LOCAL_DATABASE must be testvantagemovers_<alnum>");
function adminSecret(): string {
  // SEED-T3: `CSI_ADMIN_ENV_FILE` names the Admin .env when the server checkout is a worktree outside the workspace.
  const file = readFileSync(resolve(process.cwd(), process.env.CSI_ADMIN_ENV_FILE ?? "../vantage-admin/.env"), "utf8");
  const line = file.split(/\r?\n/).find(row => row.startsWith("VANTAGE_ADMIN_PROXY_SIGNING_SECRET="));
  const value = line?.slice("VANTAGE_ADMIN_PROXY_SIGNING_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error("Admin proxy signing secret not found in ../vantage-admin/.env");
  return value;
}
// Empty strings, not `delete`: `crm/crmConfig.ts` imports `dotenv/config`, which refills deleted keys from `.env`.
process.env.AI_GATEWAY_API_KEY = "";
process.env.PERSONAL_AI_GATEWAY_API_KEY = "";
process.env.SALES_INTELLIGENCE_MCP_ENDPOINT = "";
// CF-PREP: no Blob store. The Owner media route would otherwise read the store named in `.env` for a
// seeded pathname; blank, it writes its local audit row and then fails the read (`BlobReadFailed`).
process.env.BLOB_READ_WRITE_TOKEN = "";
process.env.BLOB_STORE_ID = "";
// CF-PREP: `CSI_LOCAL_FLAGS=ATTENTION_V2,TIMELINE_V2` turns the final-data flags on. Each of the two is
// set explicitly (listed → "true", else "false") so `.env` or the shell can never decide a capture's mode.
// CF-AC: the three Team 4 flags too, so .env can never decide an AC capture mode either.
// SEED-T3 (CF5c): CAPTURE_WEBHOOK (the coverage read's webhook facts) and NUMBERS_HAS_CALLS_DEFAULT (S5c-NUMBERS) too.
// CAPTURE_WEBHOOK only changes reads here: the local API runs no cron and receives no webhook.
// SEED-T3 part 2 (CF6/CF7/CF9): PRIORITY5_CLOSURE, OVERVIEW and the two RECEIVER flags too.
const LOCAL_FLAGS = ["ATTENTION_V2", "TIMELINE_V2", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "CAPTURE_WEBHOOK", "NUMBERS_HAS_CALLS_DEFAULT",
  "PRIORITY5_CLOSURE", "OVERVIEW", "RECEIVER_ASSIGNMENT", "RECEIVER_LATEST_WINS"] as const;
const requested = (process.env.CSI_LOCAL_FLAGS ?? "").split(",").map(v => v.trim().toUpperCase()).filter(Boolean);
const unknownFlags = requested.filter(v => !(LOCAL_FLAGS as readonly string[]).includes(v));
if (unknownFlags.length) throw new Error(`CSI_LOCAL_FLAGS: unknown flag(s) ${unknownFlags.join(", ")}; allowed ${LOCAL_FLAGS.join(", ")}`);
for (const flag of LOCAL_FLAGS) process.env[`SALES_INTELLIGENCE_${flag}`] = requested.includes(flag) ? "true" : "false";
Object.assign(process.env, {
  TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: DATABASE, MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
  MONGODB_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
  SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
  SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false",
  SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false",
  SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false",
  SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_AUTO_ATTACH: "false",
  SALES_INTELLIGENCE_LEAD_PROGRESS: "true", RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret",
  VANTAGE_ADMIN_PROXY_SIGNING_SECRET: adminSecret(), PORT: process.env.PORT ?? "3999",
});
console.log(`Local CSI API: database ${DATABASE}, loopback replica csi01:27189, port ${process.env.PORT}; gateway and Blob keys removed from the process; ` +
  `flags ${LOCAL_FLAGS.map(f => `${f}=${process.env[`SALES_INTELLIGENCE_${f}`]}`).join(" ")}`);
void import("./../dev-server");
