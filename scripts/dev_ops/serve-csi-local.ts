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
 *
 * S8-REP (CF8): the server can act as a named rep through the same signed-header path the admin proxy
 * uses. `CSI_LOCAL_ACTOR=rep:<agent_id>` makes every request a rep request; a per-request
 * `x-csi-local-actor: rep:<agent_id>` (or `owner`) overrides it. Only this local server honours that
 * header: a front middleware strips it and re-signs the request's actor headers as the rep (role `rep`,
 * `x-vantage-admin-agent-id`, the 8-line canonical payload, the local signing secret), which is what
 * `vantage-admin` `setTrustedAdminHeaders` sends for a rep session. `owner` (the default) leaves the
 * request exactly as the caller signed it. List `REP_ACCESS` (and `OVERVIEW`) in `CSI_LOCAL_FLAGS`.
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
// SEED-T3 part 2 (CF6/CF7/CF9) and S8-REP (CF8): every Team 3 flag, so a capture's mode is never decided by .env.
const LOCAL_FLAGS = ["ATTENTION_V2", "TIMELINE_V2", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "CAPTURE_WEBHOOK", "NUMBERS_HAS_CALLS_DEFAULT",
  "PRIORITY5_CLOSURE", "OVERVIEW", "RECEIVER_ASSIGNMENT", "RECEIVER_LATEST_WINS", "REP_ACCESS"] as const;
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
const LOCAL_ACTOR_PATTERN = /^(owner|rep:[a-f\d]{24})$/i;
const defaultActor = (process.env.CSI_LOCAL_ACTOR ?? "owner").trim();
if (!LOCAL_ACTOR_PATTERN.test(defaultActor)) throw new Error("CSI_LOCAL_ACTOR must be owner or rep:<24-hex agent id>");
if (defaultActor.toLowerCase() !== "owner") console.log(`Local CSI API: every request acts as ${defaultActor} unless x-csi-local-actor says otherwise`);
void (async () => {
  const [{ default: express }, { default: app }, canonical, trusted] = await Promise.all([import("express"), import("../../src/app"),
    import("../../src/services/operationsRegistry/trustedActorCanonical"), import("../../src/services/operationsRegistry/trustedActor")]);
  const { ADMIN_PROXY_HEADER_NAMES: names, ADMIN_PROXY_AGENT_HEADER, buildCanonicalRepActorPayload, normalizeAdminPath } = canonical;
  const outer = express();
  outer.use((req, res, next) => {
    // CF8: names the database this local API serves, so a capture can prove its commands go to a disposable copy.
    res.setHeader("x-csi-local-database", DATABASE);
    const requested = (req.header("x-csi-local-actor") ?? defaultActor).trim();
    delete req.headers["x-csi-local-actor"];
    if (!LOCAL_ACTOR_PATTERN.test(requested)) { res.status(400).json({ ok: false, error: "x-csi-local-actor must be owner or rep:<agent_id>" }); return; }
    if (requested.toLowerCase() === "owner") { next(); return; }
    // Re-sign as the rep, exactly as the admin proxy does for a rep session linked to this Agent.
    const agentId = requested.slice("rep:".length).toLowerCase();
    const fields = { adminId: `local-rep-${agentId}`, email: `rep+${agentId}@local.invalid`, role: "rep", timestamp: String(Date.now()),
      requestId: req.header(names.requestId) ?? `local-rep-${Date.now()}`, method: req.method, path: normalizeAdminPath(req.originalUrl.split("?")[0] ?? ""), agentId };
    Object.assign(req.headers, { [names.userId]: fields.adminId, [names.email]: fields.email, [names.role]: "rep", [names.timestamp]: fields.timestamp,
      [names.requestId]: fields.requestId, [ADMIN_PROXY_AGENT_HEADER]: agentId,
      [names.signature]: trusted.signAdminActorPayload(buildCanonicalRepActorPayload(fields), process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) });
    next();
  });
  outer.use(app);
  const port = Number(process.env.PORT) || 3999;
  outer.listen(port, () => console.log(`Local API listening on http://localhost:${port}`));
})();
