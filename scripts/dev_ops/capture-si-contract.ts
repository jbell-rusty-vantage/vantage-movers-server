/**
 * Contract capture for a Sales Intelligence contract freeze (TEAM-1 §5).
 *
 *   CSI_LOCAL_DATABASE=testvantagemovers_finalui PORT=3999 node --env-file=.env --import tsx scripts/dev_ops/serve-csi-local.ts
 *   node --import tsx scripts/dev_ops/capture-si-contract.ts --stage S1 [--base http://127.0.0.1:3999] [--out <dir>] [--strict]
 *
 * Calls every Owner read the stage's registry entries name (`lib/si-contract-registry.ts`), once per
 * seeded state from `si_seed_manifest`, signed exactly like the admin proxy, and writes the
 * pretty-printed JSON to `<out>/<Sn>/<route-slug>__<state>.json` (default: the workspace
 * `contracts/`). A route that answers 404 without a JSON body, or 400 INVALID_INPUT for a query parameter
 * a later stage adds, is recorded as not implemented yet (`--strict` makes the 400 case a failure).
 *
 * Guards: the base URL must be loopback, and before capturing anything the API must serve a seeded
 * Outreach record from the manifest read directly out of `testvantagemovers_finalui` on the local
 * replica, so production can never be captured. Secrets are read from `.env` files and never printed.
 */
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import { SI_CONTRACTS_DIR, SI_SEED_DATABASE, SI_SEED_MANIFEST, SI_SEED_REPLICA, assertSeedDatabase, type SiManifestRow } from "./lib/si-contract-common";
import { routesFor, type Stage } from "./lib/si-contract-registry";

const PREFIX = "/api/v1/admin/sales-intelligence";
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const stage = arg("stage") as Stage | undefined;
if (!stage || !["S1", "S2", "S3", "S4"].includes(stage)) throw new Error("--stage S1|S2|S3|S4 is required");
const base = (arg("base") ?? "http://127.0.0.1:3999").replace(/\/+$/, "");
const out = resolve(arg("out") ?? SI_CONTRACTS_DIR, stage);
const strict = args.includes("--strict");
const host = new URL(base).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new Error(`refusing non-loopback base ${base}`);

function envValue(file: string, key: string): string {
  const line = readFileSync(file, "utf8").split(/\r?\n/).find(row => row.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${key} not found in ${file}`);
  return value;
}
const apiSecret = envValue(resolve(process.cwd(), ".env"), "VANTAGE_API_SECRET");
const signingSecret = envValue(resolve(process.cwd(), "../vantage-admin/.env"), "VANTAGE_ADMIN_PROXY_SIGNING_SECRET");
const OWNER = { id: "5eed00000000000000000001", email: "owner@example.test" };

async function get(pathAndQuery: string) {
  const path = `${PREFIX}${pathAndQuery}`, signedPath = path.split("?")[0]!;
  const timestamp = String(Date.now()), requestId = randomUUID();
  const payload = [OWNER.id, OWNER.email, "owner", timestamp, requestId, "GET", signedPath].join("\n");
  const response = await fetch(`${base}${path}`, { headers: { "x-api-secret": apiSecret, "x-vantage-admin-user-id": OWNER.id, "x-vantage-admin-email": OWNER.email,
    "x-vantage-admin-role": "owner", "x-vantage-admin-timestamp": timestamp, "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-signature": createHmac("sha256", signingSecret).update(payload).digest("hex") }, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: response.status, body };
}

async function main() {
  assertSeedDatabase(SI_SEED_DATABASE);
  const client = new MongoClient(SI_SEED_REPLICA, { maxPoolSize: 1, serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const rows = (await client.db(SI_SEED_DATABASE).collection(SI_SEED_MANIFEST).find({}, { projection: { _id: 0, seeded_at: 0 } }).toArray()) as unknown as SiManifestRow[];
  await client.close();
  if (!rows.length) throw new Error(`no ${SI_SEED_MANIFEST} rows in ${SI_SEED_DATABASE}; run seed-csi-final-ui.ts first`);

  // Guard: the API must serve the seed database (a seeded record id resolves to the seeded subject).
  const sentinel = rows.find(row => row.outreach_record_id)!;
  const probe = await get(`/outreach/${sentinel.outreach_record_id}`);
  const probed = (probe.body as { data?: { outreach?: { id?: string } } } | null)?.data?.outreach?.id;
  if (probe.status !== 200 || probed !== sentinel.outreach_record_id)
    throw new Error(`the API at ${base} does not serve ${SI_SEED_DATABASE} (probe ${probe.status}); refusing to capture`);

  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(out)) if (file.endsWith(".json")) rmSync(resolve(out, file));
  const summary: Array<{ route: string; state: string; status: number; note: string }> = [];
  for (const route of routesFor(stage!)) {
    for (const call of route.calls(rows)) {
      const { status, body } = await get(call.path);
      const file = `${route.slug}__${call.state}.json`;
      if (status === 200 && body && (body as { ok?: boolean }).ok === true) {
        writeFileSync(resolve(out, file), `${JSON.stringify(body, null, 2)}\n`);
        summary.push({ route: route.route, state: call.state, status, note: file });
      } else if (status === 404 && body === null) {
        summary.push({ route: route.route, state: call.state, status, note: "not implemented yet (no route)" });
      } else if (status === 400 && (body as { code?: string } | null)?.code === "INVALID_INPUT" && !strict) {
        // The route's strict query schema rejects a parameter a later stage adds.
        summary.push({ route: route.route, state: call.state, status, note: "not implemented yet (400 INVALID_INPUT: parameter not accepted)" });
      } else {
        summary.push({ route: route.route, state: call.state, status, note: `not captured: ${JSON.stringify(body).slice(0, 160)}` });
      }
    }
  }
  writeFileSync(resolve(out, "_capture-index.json"), `${JSON.stringify({ stage, database: SI_SEED_DATABASE, captured_at: new Date().toISOString(), calls: summary }, null, 2)}\n`);
  const captured = summary.filter(s => s.status === 200).length, missing = summary.filter(s => s.note.startsWith("not implemented")).length;
  const failed = summary.filter(s => s.status !== 200 && !s.note.startsWith("not implemented"));
  for (const s of summary) console.log(`${String(s.status).padEnd(4)} ${s.route.padEnd(40)} ${s.state.padEnd(34)} ${s.note}`);
  console.log(`\n${stage}: captured ${captured}, not implemented ${missing}, failed ${failed.length} → ${out}`);
  if (failed.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
