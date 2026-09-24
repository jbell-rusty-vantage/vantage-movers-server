/**
 * Validates every captured contract fixture of a stage against the SERVER's Zod DTO schemas (strict).
 *
 *   node --import tsx scripts/dev_ops/test-si-contract-fixtures.ts --stage S1 [--flag-off] [--dir <contracts dir>]
 *
 * Each `<slug>__<state>.json` is matched to its registry entry (`lib/si-contract-registry.ts`) for
 * the mode (flags on: `contracts/<Sn>/`; `--flag-off`: `contracts/<Sn>/flag-off/`). Per fixture:
 *   1. `read` fixtures: the `ok: true` envelope is stripped and the rest parsed with the exact server
 *      schema; `status` fixtures (`{status, headers, body}`) are parsed whole with their status schema;
 *   2. every production-Admin schema the entry lists (`vantage-admin@539a628` copies) must parse it too;
 *   3. the entry's content checks (a new optional field is actually present, filters hold, …) run
 *      against the body with the seed manifest (`contracts/seed-manifest.json`).
 * TAP output (`ok` / `not ok`, `# pass N`, `# fail N`); exit code 1 on any failure, on an empty
 * folder, or when a registry entry has no fixture at all (a route that was never captured).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SI_CONTRACTS_DIR, type SiManifestRow } from "./lib/si-contract-common";
import { routeForFile, routesFor, type Mode, type ResolvedSchema, type Stage } from "./lib/si-contract-registry";

// DTO modules pull config; keep the process inert (no provider keys, test database names only).
Object.assign(process.env, { TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_finalui", SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
  AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "" });
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const stage = arg("stage") as Stage | undefined;
if (!stage || !["S1", "S2", "S3", "S4", "AC", "S5c"].includes(stage)) throw new Error("--stage S1|S2|S3|S4|AC|S5c is required");
const mode: Mode = args.includes("--flag-off") ? "off" : "on";
const root = resolve(arg("dir") ?? SI_CONTRACTS_DIR);
const dir = resolve(root, stage, ...(mode === "off" ? ["flag-off"] : []));

function manifestRows(): SiManifestRow[] | null {
  const file = resolve(root, "seed-manifest.json");
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, "utf8")) as { rows?: SiManifestRow[] }).rows ?? null;
}

async function main() {
  const files = existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith(".json") && !file.startsWith("_")).sort() : [];
  const rows = manifestRows();
  const uncaptured = routesFor(stage!, mode).filter(route => !files.some(file => file.split("__")[0] === route.slug));
  console.log("TAP version 13");
  console.log(`1..${files.length + uncaptured.length}`);
  let pass = 0, fail = 0, n = 0;
  const cache = new Map<string, ResolvedSchema>();
  const resolveOnce = async (key: string, load: () => Promise<ResolvedSchema>) => { if (!cache.has(key)) cache.set(key, await load()); return cache.get(key)!; };
  for (const file of files) {
    n++;
    const route = routeForFile(stage!, mode, file);
    if (!route) { fail++; console.log(`not ok ${n} - ${file} # no registry entry for this slug`); continue; }
    const problems: string[] = [];
    const raw = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Record<string, unknown>;
    let body: unknown = raw;
    // CF5c: `script` fixtures carry the read envelope (written by capture-si-s5c-local.ts, not an HTTP call).
    const readLike = route.kind === "read" || route.kind === "script";
    if (readLike) {
      const { ok, ...rest } = raw;
      if (ok !== true) problems.push(`ok envelope is ${String(ok)}`);
      body = rest;
    }
    const server = await resolveOnce(`${route.stage}:${route.mode}:${route.slug}`, route.schema);
    const parsed = server.schema.safeParse(body);
    if (!parsed.success) problems.push(...parsed.error.issues.slice(0, 8).map(issue => `${server.name}: ${issue.path.join(".")}: ${issue.message}`));
    const names = [server.name];
    for (const [i, load] of (route.admin ?? []).entries()) {
      const admin = await resolveOnce(`${route.stage}:${route.mode}:${route.slug}:admin${i}`, load);
      names.push(admin.name);
      const result = admin.schema.safeParse(body);
      if (!result.success) problems.push(...result.error.issues.slice(0, 5).map(issue => `${admin.name}: ${issue.path.join(".")}: ${issue.message}`));
    }
    const state = file.slice(route.slug.length + 2, -".json".length);
    if (route.checks) problems.push(...route.checks(readLike ? raw : (raw as { body?: unknown }).body, { rows, state, file }));
    const note = route.kind === "script" ? " # script capture (no route); server caseFileArtifactSchema + script-local strict wrapper"
      : state.endsWith("__synthetic") ? " # synthetic: pure composeCaptureHealth in a copy of the real response"
      : server.source === "script-local" && route.kind === "read" ? " # server exports no schema; script-local strict schema" : "";
    if (!problems.length) { pass++; console.log(`ok ${n} - ${file} (${names.join(" + ")})${note}`); continue; }
    fail++;
    console.log(`not ok ${n} - ${file} (${names.join(" + ")})`);
    console.log("  ---");
    for (const problem of problems.slice(0, 12)) console.log(`  - ${problem}`);
    console.log("  ...");
  }
  for (const route of uncaptured) { n++; fail++; console.log(`not ok ${n} - ${route.slug} (${route.route}) # no fixture captured for this registry entry`); }
  console.log(`# tests ${n}`);
  console.log(`# pass ${pass}`);
  console.log(`# fail ${fail}`);
  if (fail || !files.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
