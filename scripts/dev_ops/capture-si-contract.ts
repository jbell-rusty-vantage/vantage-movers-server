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
import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import { SI_CONTRACTS_DIR, SI_SEED_DATABASE, SI_SEED_MANIFEST, SI_SEED_REPLICA, SI_WORKSPACE, assertSeedDatabase, type SiManifestRow } from "./lib/si-contract-common";
import { routesFor, type CaptureCall, type Mode, type RouteEntry, type Stage } from "./lib/si-contract-registry";

const PREFIX = "/api/v1/admin/sales-intelligence";
// SEED-T3 part 2: the flags production runs today, and Team 3's flags with code on the branch (the CF6/CF7/CF9 mode switch).
const T3_PRODUCTION_FLAGS = ["ATTENTION_V2", "TIMELINE_V2", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "CAPTURE_WEBHOOK"] as const;
const T3_TEAM_FLAGS = ["NUMBERS_HAS_CALLS_DEFAULT", "PRIORITY5_CLOSURE", "OVERVIEW", "RECEIVER_ASSIGNMENT", "RECEIVER_LATEST_WINS"] as const;
const KEPT_HEADERS = ["content-type", "content-range", "accept-ranges", "cache-control"];
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const stage = arg("stage") as Stage | undefined;
// "AC" (CF-AC, Team 4) is a stub until AC2's new reads land: `routesFor` returns `[]` and `main()`
// already turns that into a clear "no ... registry entries for AC" failure (AC0-SEED, 2026-09-23).
if (!stage || !["S1", "S2", "S3", "S4", "AC", "S5c", "S6", "S7", "S9"].includes(stage)) throw new Error("--stage S1|S2|S3|S4|AC|S5c|S6|S7|S9 is required");
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
// SEED-T3: `CSI_ADMIN_ENV_FILE` names the Admin .env when the server checkout is a worktree outside the workspace.
const signingSecret = envValue(resolve(process.cwd(), process.env.CSI_ADMIN_ENV_FILE ?? "../vantage-admin/.env"), "VANTAGE_ADMIN_PROXY_SIGNING_SECRET");
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
  // Guard 2 (CF5c): both S5c modes run with every production flag on; NUMBERS_HAS_CALLS_DEFAULT decides the mode.
  if (stage === "S5c") {
    const settings = await get("/settings");
    const flags = (settings.body as { data?: { flags?: Record<string, boolean> } } | null)?.data?.flags ?? {};
    const want = mode === "on";
    const start = `start serve-csi-local.ts with CSI_LOCAL_FLAGS=ATTENTION_V2,TIMELINE_V2,ATTENTION_EVOLUTION,CASE_FILE,PROGRESS_PLAN,CAPTURE_WEBHOOK${want ? ",NUMBERS_HAS_CALLS_DEFAULT" : ""}`;
    for (const flag of ["ATTENTION_V2", "TIMELINE_V2", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "CAPTURE_WEBHOOK"]) if (!flags[flag]) throw new Error(`${flag} is off on the API; ${start}`);
    if (Boolean(flags.NUMBERS_HAS_CALLS_DEFAULT) !== want) throw new Error(`NUMBERS_HAS_CALLS_DEFAULT is ${want ? "off" : "on"} on the API; ${start}`);
    const page = await get("/attention?view=all_outreach&limit=200");
    const rows = ((page.body as { data?: { items?: Array<{ sort_keys?: Record<string, unknown> }> } } | null)?.data?.items ?? []);
    if (!(page.body as { data?: { metrics?: unknown } } | null)?.data?.metrics) throw new Error("the Attention snapshot has no metrics: seed with --attention-v2 or republish with --publish-attention on");
    if (!rows.some(row => row.sort_keys && "band2_due_rank" in row.sort_keys)) throw new Error("the Attention snapshot was published with ATTENTION_EVOLUTION off: seed-csi-final-ui.ts --publish-attention on");
  } else if (stage === "S6" || stage === "S7" || stage === "S9") {
    // Guard 2 (CF6/CF7/CF9, SEED-T3 part 2): production's flags always on; every Team 3 flag on (mode on) or off (flag-off = production today).
    const settings = await get("/settings");
    const flags = (settings.body as { data?: { flags?: Record<string, boolean> } } | null)?.data?.flags ?? {};
    const want = mode === "on";
    const start = `start serve-csi-local.ts with CSI_LOCAL_FLAGS=${[...T3_PRODUCTION_FLAGS, ...(want ? T3_TEAM_FLAGS : [])].join(",")}`;
    for (const flag of T3_PRODUCTION_FLAGS) if (!flags[flag]) throw new Error(`${flag} is off on the API; ${start}`);
    for (const flag of T3_TEAM_FLAGS) if (Boolean(flags[flag]) !== want) throw new Error(`${flag} is ${want ? "off" : "on"} on the API; ${start}`);
    const page = await get("/attention?view=all_outreach&limit=200");
    const rows = ((page.body as { data?: { items?: Array<{ sort_keys?: Record<string, unknown>; outreach?: Record<string, unknown> | null }> } } | null)?.data?.items ?? []);
    if (!(page.body as { data?: { metrics?: unknown } } | null)?.data?.metrics) throw new Error("the Attention snapshot has no metrics: seed with --attention-v2");
    if (!rows.some(row => row.sort_keys && "band2_due_rank" in row.sort_keys)) throw new Error("the Attention snapshot was published with ATTENTION_EVOLUTION off");
    const banded = rows.some(row => row.outreach && "band_since" in row.outreach);
    if (banded !== want) throw new Error(`the Attention snapshot was published with OVERVIEW ${banded ? "on" : "off"}: seed-csi-final-ui.ts --publish-attention on${want ? "" : " --p5 off --overview off"}`);
  } else if (stage === "AC") {
    const settings = await get("/settings");
    const flags = (settings.body as { data?: { flags?: Record<string, boolean> } } | null)?.data?.flags ?? {};
    const want = mode === "on";
    for (const flag of ["ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN"]) if (Boolean(flags[flag]) !== want)
      throw new Error(`${flag} is ${flags[flag] ? "on" : "off"} on the API; start serve-csi-local.ts with CSI_LOCAL_FLAGS=ATTENTION_V2,TIMELINE_V2${want ? ",ATTENTION_EVOLUTION,CASE_FILE,PROGRESS_PLAN" : ""}`);
    if ((await get(`/outreach/${sentinel.outreach_record_id}/timeline?limit=1`)).status !== 200) throw new Error("TIMELINE_V2 is off on the API; AC captures need it on");
    const page = await get("/attention?view=all_outreach&limit=200");
    const rows = ((page.body as { data?: { items?: Array<{ sort_keys?: Record<string, unknown> }>; metrics?: unknown } } | null)?.data?.items ?? []);
    if (!(page.body as { data?: { metrics?: unknown } } | null)?.data?.metrics) throw new Error("the Attention snapshot has no metrics: republish with ATTENTION_V2 on");
    const evolved = rows.some(row => row.sort_keys && "band2_due_rank" in row.sort_keys);
    if (evolved !== want) throw new Error(`the Attention snapshot was published with ATTENTION_EVOLUTION ${evolved ? "on" : "off"}: seed-csi-final-ui.ts --publish-attention on${want ? "" : " --evolution off"}`);
  } else {
  const timeline = await get(`/outreach/${sentinel.outreach_record_id}/timeline?limit=1`);
  const timelineOn = timeline.status === 200;
  if (mode === "on" && !timelineOn) throw new Error(`TIMELINE_V2 is off on the API (outreach timeline ${timeline.status}); start serve-csi-local.ts with CSI_LOCAL_FLAGS=ATTENTION_V2,TIMELINE_V2`);
  if (mode === "off" && (timeline.status !== 404 || (timeline.body as { code?: string } | null)?.code !== "FEATURE_DISABLED"))
    throw new Error(`TIMELINE_V2 is on on the API (outreach timeline ${timeline.status}); restart serve-csi-local.ts without CSI_LOCAL_FLAGS`);
  const desk = await get("/attention");
  const metrics = Boolean((desk.body as { data?: { metrics?: unknown } } | null)?.data?.metrics);
  if (mode === "on" && !metrics) throw new Error("the Attention snapshot has no metrics: republish with the flag on (seed-csi-final-ui.ts --publish-attention on)");
  if (mode === "off" && metrics) throw new Error("the Attention snapshot carries metrics: republish with the flag off (seed-csi-final-ui.ts --publish-attention off)");
  }

  const routes = routesFor(stage!, mode);
  if (!routes.length) throw new Error(`no ${mode === "off" ? "flag-off " : ""}registry entries for ${stage}`);
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(out)) if (file.endsWith(".json")) rmSync(resolve(out, file));
  // SEED-T3 part 2: the manifest this capture used, beside its fixtures (the fixture test prefers it over the shared seed-manifest.json).
  writeFileSync(resolve(out, "_seed-manifest.json"), `${JSON.stringify({ database: SI_SEED_DATABASE, captured_at: new Date().toISOString(), rows }, null, 2)}\n`);
  const summary: Summary[] = [];
  // `script` entries (CF5c) have no HTTP call: `capture-si-s5c-local.ts` writes them after the HTTP pass (it reads `coverage__seed.json`).
  for (const route of routes) if (route.kind !== "script") for (const call of route.calls(rows)) await capture(route, call, summary);
  if (stage === "S5c" && mode === "on") {
    const child = spawnSync(process.execPath, ["--import", "tsx", resolve(__dirname, "capture-si-s5c-local.ts"), "--out", out], { encoding: "utf8", env: process.env });
    const line = (child.stdout ?? "").split(/\r?\n/).find(row => row.startsWith("S5C_LOCAL_SUMMARY "));
    if (line) summary.push(...(JSON.parse(line.slice("S5C_LOCAL_SUMMARY ".length)) as Summary[]));
    if (child.status !== 0 || !line) summary.push({ route: "script: capture-si-s5c-local.ts", state: "(run)", path: "(script)", status: child.status ?? -1,
      note: `exit ${child.status}: ${(child.stderr ?? "").trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 300)}`, ok: false });
  }
  // CF6: the S10 report formats (receiver backfill step 3, Priority 5 reconcile step 4) are copied from the replica evidence, not captured.
  const reports = stage === "S6" && mode === "on" ? ["S10-3-replica.md", "S10-3-replica-apply.md", "S10-4-replica.md", "S10-4-replica-apply.md"] : [];
  if (reports.length) {
    mkdirSync(resolve(out, "reports"), { recursive: true });
    for (const file of reports) {
      const from = resolve(SI_WORKSPACE, "evidence", file);
      if (!existsSync(from)) { summary.push({ route: "report (copied from evidence/)", state: file, path: "(file)", status: 0, note: `missing ${from}`, ok: false }); continue; }
      copyFileSync(from, resolve(out, "reports", file));
      summary.push({ route: "report (copied from evidence/)", state: file, path: "(file)", status: 0, note: `reports/${file}`, ok: true });
    }
  }
  const modeLabel = ["S6", "S7", "S9"].includes(stage!) ? (mode === "on" ? `flags on (${[...T3_PRODUCTION_FLAGS, ...T3_TEAM_FLAGS].join(", ")})`
      : `Team 3 flags off (${T3_TEAM_FLAGS.join(", ")}); production's on (${T3_PRODUCTION_FLAGS.join(", ")}); snapshot republished with PRIORITY5_CLOSURE and OVERVIEW off`)
    : stage === "AC" ? (mode === "on" ? "flags on (ATTENTION_V2, TIMELINE_V2, ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN)" : "Team 4 flags off (ATTENTION_V2, TIMELINE_V2 on)")
    : stage === "S5c" ? (mode === "on" ? "flags on (ATTENTION_V2, TIMELINE_V2, ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN, CAPTURE_WEBHOOK, NUMBERS_HAS_CALLS_DEFAULT)"
      : "NUMBERS_HAS_CALLS_DEFAULT off (ATTENTION_V2, TIMELINE_V2, ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN, CAPTURE_WEBHOOK on: production today)")
    : mode === "on" ? "flags on (ATTENTION_V2, TIMELINE_V2)" : "flags off";
  const notes = stage === "S6" && mode === "on" ? {
    reports: "reports/S10-{3,4}-replica[-apply].md: the receiver_agent backfill (S10 step 3, S6-AGENT) and the Priority 5 reconcile (S10 step 4, S6-P5) dry-run and apply " +
      "report formats, copied from the replica evidence (evidence/S10-3-replica*.md, evidence/S10-4-replica*.md); not HTTP captures.",
    receiver_agent: "S6-AGENT has not merged: the detail carries assignment {agent, origin} but not receiver_agent, and no record is crm_receiver yet. The seed writes the " +
      "receiver_agent states as raw Lead fields (and sets RECEIVER_ASSIGNMENT / RECEIVER_LATEST_WINS); re-run the seed and this capture after S6-AGENT merges.",
  } : stage === "S9" && mode === "on" ? {
    rep_scope: "The rep's own Overview (forced scope + team_medians) needs S8-REP: not captured. overview__owner-one-rep-scope.json is the Owner's agent_id scope " +
      "(the same readOverview scope path, from the param).",
  } : stage === "S5c" && mode === "on" ? {
    script: "case-file__*__script.json: no route exposes the Case File; capture-si-s5c-local.ts ran the real assembler (caseFileInputFor → assembleCaseFile → caseFileToReadContent) on the seed, read only.",
    synthetic: "coverage__capture-health-{ok,broken}__synthetic.json: the pure composeCaptureHealth (ownerCoverage.ts) over fixed inputs built from the seeded rows, " +
      "put in a copy of the real coverage__seed.json; validated with the same route schema and the production Admin ownerCoverageSchema. coverage__seed.json is the one real example (attention).",
  } : undefined;
  writeFileSync(resolve(out, "_capture-index.json"), `${JSON.stringify({ stage, mode: modeLabel, database: SI_SEED_DATABASE, captured_at: new Date().toISOString(),
    ...(notes ? { notes } : {}), calls: summary }, null, 2)}\n`);
  for (const s of summary) console.log(`${s.ok ? "ok  " : "FAIL"} ${String(s.status).padEnd(4)} ${s.route.padEnd(44)} ${s.state.padEnd(40)} ${s.note}`);
  const failed = summary.filter(s => !s.ok);
  console.log(`\n${stage}${mode === "off" ? " flag-off" : ""}: captured ${summary.length - failed.length}, failed ${failed.length} → ${out}`);
  if (failed.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
