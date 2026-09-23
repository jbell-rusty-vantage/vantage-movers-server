/**
 * Local Owner API for browser verification against an isolated csi01 replica database.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/serve-csi-local.ts
 *
 * Environment: `CSI_LOCAL_DATABASE` (default `testvantagemovers_madem0`), `PORT` (default 3999).
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
  const file = readFileSync(resolve(process.cwd(), "../vantage-admin/.env"), "utf8");
  const line = file.split(/\r?\n/).find(row => row.startsWith("VANTAGE_ADMIN_PROXY_SIGNING_SECRET="));
  const value = line?.slice("VANTAGE_ADMIN_PROXY_SIGNING_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error("Admin proxy signing secret not found in ../vantage-admin/.env");
  return value;
}
// Empty strings, not `delete`: `crm/crmConfig.ts` imports `dotenv/config`, which refills deleted keys from `.env`.
process.env.AI_GATEWAY_API_KEY = "";
process.env.PERSONAL_AI_GATEWAY_API_KEY = "";
process.env.SALES_INTELLIGENCE_MCP_ENDPOINT = "";
Object.assign(process.env, {
  TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: DATABASE, MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
  MONGODB_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
  SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
  SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
  SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false",
  SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false",
  SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_AUTO_ATTACH: "false",
  SALES_INTELLIGENCE_LEAD_PROGRESS: "true", RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret",
  VANTAGE_ADMIN_PROXY_SIGNING_SECRET: adminSecret(), PORT: process.env.PORT ?? "3999",
});
console.log(`Local CSI API: database ${DATABASE}, loopback replica csi01:27189, port ${process.env.PORT}; gateway keys removed from the process`);
void import("./../dev-server");
