/**
 * Contract capture for a Sales Intelligence contract freeze CF1–CF4 (TEAM-1 §5).
 *
 *   # flags on (the new contract): snapshot published with ATTENTION_V2 on, API started with both flags
 *   CSI_LOCAL_DATABASE=testvantagemovers_finalui CSI_LOCAL_FLAGS=ATTENTION_V2,TIMELINE_V2 PORT=3999 \
 *     node --env-file=.env --import tsx scripts/dev_ops/serve-csi-local.ts
 *   node --import tsx scripts/dev_ops/capture-si-contract.ts --stage S1
 *   # flags off (production-Admin compatibility): flag-off snapshot, API started without CSI_LOCAL_FLAGS
 *   node --import tsx scripts/dev_ops/capture-si-contract.ts --stage S2 --flag-off
 *
 * Options: `--base http://127.0.0.1:3999`, `--out <contracts dir>`. The full post-restart sequence is
 * `sales-intelligence-ui-ux-workspace/contracts/CAPTURE-RUNBOOK.md`.
 *
 * Calls every Owner read the stage's registry entries name (`lib/si-contract-registry.ts`) for the
 * mode, once per seeded state from `si_seed_manifest`, signed exactly like the admin proxy, and
 * writes pretty-printed JSON to `<out>/<Sn>/<slug>__<state>.json` (flag off: `<out>/<Sn>/flag-off/`).
 * Every call has an expected status (200 unless the registry says otherwise); anything else is a
 * failure and the exit code is 1. A non-200 call is stored as `{status, headers, body}`; a body that
 * is not JSON (audio) is never written.
 *
 * Guards: the base URL must be loopback; the API must serve a seeded Outreach record from the
 * manifest read directly out of `testvantagemovers_finalui` on the local replica (so production can
 * never be captured); and the API's flag state and the snapshot's must match the mode
 * (`GET /outreach/:id/timeline` 200 vs 404 FEATURE_DISABLED; `data.metrics` present vs absent on
 * `GET /attention`). Secrets are read from `.env` files and never printed.
 */
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import { SI_CONTRACTS_DIR, SI_SEED_DATABASE, SI_SEED_MANIFEST, SI_SEED_REPLICA, assertSeedDatabase, type SiManifestRow } from "./lib/si-contract-common";
import { routesFor, type CaptureCall, type Mode, type RouteEntry, type Stage } from "./lib/si-contract-registry";

const PREFIX = "/api/v1/admin/sales-intelligence";
const KEPT_HEADERS = ["content-type", "content-range", "accept-ranges", "cache-control"];
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const stage = arg("stage") as Stage | undefined;
if (!stage || !["S1", "S2", "S3", "S4"].includes(stage)) throw new Error("--stage S1|S2|S3|S4 is required");
const mode: Mode = args.includes("--flag-off") ? "off" : "on";
const base = (arg("base") ?? "http://127.0.0.1:3999").replace(/\/+$/, "");
const out = resolve(arg("out") ?? SI_CONTRACTS_DIR, stage, ...(mode === "off" ? ["flag-off"] : []));
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

type Response = { status: number; headers: Record<string, string>; body: unknown; json: boolean };
async function get(pathAndQuery: string, extra: Record<string, string> = {}): Promise<Response> {
  const path = `${PREFIX}${pathAndQuery}`, signedPath = path.split("?")[0]!;
  const timestamp = String(Date.now()), requestId = randomUUID();
  const payload = [OWNER.id, OWNER.email, "owner", timestamp, requestId, "GET", signedPath].join("\n");
  const response = await fetch(`${base}${path}`, { headers: { ...extra, "x-api-secret": apiSecret, "x-vantage-admin-user-id": OWNER.id, "x-vantage-admin-email": OWNER.email,
    "x-vantage-admin-role": "owner", "x-vantage-admin-timestamp": timestamp, "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-signature": createHmac("sha256", signingSecret).update(payload).digest("hex") }, signal: AbortSignal.timeout(30_000) });
  const headers = Object.fromEntries(KEPT_HEADERS.flatMap(name => { const v = response.headers.get(name); return v === null ? [] : [[name, v]]; }));
  const json = (response.headers.get("content-type") ?? "").includes("application/json");
  if (!json) { await response.body?.cancel(); return { status: response.status, headers, body: null, json }; }
  const text = await response.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: response.status, headers, body, json };
}

type Summary = { route: string; state: string; path: string; status: number; note: string; ok: boolean };
async function capture(route: RouteEntry, call: CaptureCall, summary: Summary[]) {
  const expect = call.expect ?? 200;
  const response = await get(call.path, call.headers);
  const file = `${route.slug}__${call.state}.json`;
  const record = (ok: boolean, note: string) => summary.push({ route: route.route, state: call.state, path: call.path.split("?")[0]!.replace(/[a-f\d]{24}/gi, ":id"), status: response.status, note, ok });
  if (response.status !== expect) return record(false, `expected ${expect}: ${JSON.stringify(response.body).slice(0, 160)}`), null;
  if (route.kind === "read") {
    if ((response.body as { ok?: boolean } | null)?.ok !== true) return record(false, "200 without {ok: true}"), null;
    writeFileSync(resolve(out, file), `${JSON.stringify(response.body, null, 2)}\n`);
  } else {
    writeFileSync(resolve(out, file), `${JSON.stringify({ status: response.status, headers: response.headers, body: response.json ? response.body : null }, null, 2)}\n`);
  }
  record(true, file);
  for (const next of call.chain ?? []) {
    const path = next.next(response.body);
    if (!path) { summary.push({ route: route.route, state: next.state, path: "(chain)", status: 0, note: "previous page returned no cursor: seed too small for a page 2", ok: false }); continue; }
    await capture(route, { state: next.state, path }, summary);
  }
  return response.body;
}

async function main() {
  assertSeedDatabase(SI_SEED_DATABASE);
  const client = new MongoClient(SI_SEED_REPLICA, { maxPoolSize: 1, serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const rows = (await client.db(SI_SEED_DATABASE).collection(SI_SEED_MANIFEST).find({}, { projection: { _id: 0, seeded_at: 0 } }).toArray()) as unknown as SiManifestRow[];
  await client.close();
  if (!rows.length) throw new Error(`no ${SI_SEED_MANIFEST} rows in ${SI_SEED_DATABASE}; run seed-csi-final-ui.ts first`);

  // Guard 1: the API serves the seed database (a seeded record id resolves to the seeded subject).
  const sentinel = rows.find(row => row.outreach_record_id)!;
  const probe = await get(`/outreach/${sentinel.outreach_record_id}`);
  if (probe.status !== 200 || (probe.body as { data?: { outreach?: { id?: string } } } | null)?.data?.outreach?.id !== sentinel.outreach_record_id)
    throw new Error(`the API at ${base} does not serve ${SI_SEED_DATABASE} (probe ${probe.status}); refusing to capture`);
  // Guard 2: API flags and snapshot match the mode.
  const timeline = await get(`/outreach/${sentinel.outreach_record_id}/timeline?limit=1`);
  const timelineOn = timeline.status === 200;
  if (mode === "on" && !timelineOn) throw new Error(`TIMELINE_V2 is off on the API (outreach timeline ${timeline.status}); start serve-csi-local.ts with CSI_LOCAL_FLAGS=ATTENTION_V2,TIMELINE_V2`);
  if (mode === "off" && (timeline.status !== 404 || (timeline.body as { code?: string } | null)?.code !== "FEATURE_DISABLED"))
    throw new Error(`TIMELINE_V2 is on on the API (outreach timeline ${timeline.status}); restart serve-csi-local.ts without CSI_LOCAL_FLAGS`);
  const desk = await get("/attention");
  const metrics = Boolean((desk.body as { data?: { metrics?: unknown } } | null)?.data?.metrics);
  if (mode === "on" && !metrics) throw new Error("the Attention snapshot has no metrics: republish with the flag on (seed-csi-final-ui.ts --publish-attention on)");
  if (mode === "off" && metrics) throw new Error("the Attention snapshot carries metrics: republish with the flag off (seed-csi-final-ui.ts --publish-attention off)");

  const routes = routesFor(stage!, mode);
  if (!routes.length) throw new Error(`no ${mode === "off" ? "flag-off " : ""}registry entries for ${stage}`);
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(out)) if (file.endsWith(".json")) rmSync(resolve(out, file));
  const summary: Summary[] = [];
  for (const route of routes) for (const call of route.calls(rows)) await capture(route, call, summary);
  writeFileSync(resolve(out, "_capture-index.json"), `${JSON.stringify({ stage, mode: mode === "on" ? "flags on (ATTENTION_V2, TIMELINE_V2)" : "flags off",
    database: SI_SEED_DATABASE, captured_at: new Date().toISOString(), calls: summary }, null, 2)}\n`);
  for (const s of summary) console.log(`${s.ok ? "ok  " : "FAIL"} ${String(s.status).padEnd(4)} ${s.route.padEnd(44)} ${s.state.padEnd(40)} ${s.note}`);
  const failed = summary.filter(s => !s.ok);
  console.log(`\n${stage}${mode === "off" ? " flag-off" : ""}: captured ${summary.length - failed.length}, failed ${failed.length} → ${out}`);
  if (failed.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
