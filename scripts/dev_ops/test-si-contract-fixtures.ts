/**
 * Validates every captured contract fixture of a stage against the SERVER's Zod DTO schemas.
 *
 *   node --import tsx scripts/dev_ops/test-si-contract-fixtures.ts --stage S1 [--dir <contracts dir>]
 *
 * Each `<slug>__<state>.json` is matched to its registry entry (`lib/si-contract-registry.ts`); the
 * `ok` envelope the route adds is stripped and the rest is parsed with the entry's schema. TAP output
 * (`ok` / `not ok`, `# pass N`, `# fail N`); exit code 1 on any failure or when the folder is empty.
 * A route whose server schema is not exported yet is parsed loosely and marked `# TODO`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SI_CONTRACTS_DIR } from "./lib/si-contract-common";
import { routeForFile, type ResolvedSchema, type Stage } from "./lib/si-contract-registry";

// DTO modules pull config; keep the process inert (no provider keys, test database names only).
Object.assign(process.env, { TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_finalui", SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof",
  AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "" });
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const stage = arg("stage") as Stage | undefined;
if (!stage || !["S1", "S2", "S3", "S4"].includes(stage)) throw new Error("--stage S1|S2|S3|S4 is required");
const dir = resolve(arg("dir") ?? SI_CONTRACTS_DIR, stage);

async function main() {
  const files = readdirSync(dir).filter(file => file.endsWith(".json") && !file.startsWith("_")).sort();
  console.log("TAP version 13");
  console.log(`1..${files.length}`);
  let pass = 0, fail = 0, todo = 0;
  const cache = new Map<string, ResolvedSchema>();
  for (const [index, file] of files.entries()) {
    const n = index + 1;
    const route = routeForFile(stage!, file);
    if (!route) { fail++; console.log(`not ok ${n} - ${file} # no registry entry for this slug`); continue; }
    const key = `${route.stage}:${route.slug}`;
    if (!cache.has(key)) cache.set(key, await route.schema());
    const { schema, name, exact } = cache.get(key)!;
    const { ok, ...body } = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as { ok?: unknown } & Record<string, unknown>;
    const parsed = schema.safeParse(body);
    if (ok === true && parsed.success) {
      pass++;
      if (!exact) todo++;
      console.log(`ok ${n} - ${file} (${name})${exact ? "" : " # TODO server schema not exported yet"}`);
    } else {
      fail++;
      console.log(`not ok ${n} - ${file} (${name})`);
      const issues = parsed.success ? [{ path: ["ok"], message: `ok envelope is ${String(ok)}` }] : parsed.error.issues.slice(0, 8);
      console.log("  ---");
      for (const issue of issues) console.log(`  - ${issue.path.join(".")}: ${issue.message}`);
      console.log("  ...");
    }
  }
  console.log(`# tests ${files.length}`);
  console.log(`# pass ${pass}`);
  console.log(`# fail ${fail}`);
  if (todo) console.log(`# todo ${todo}`);
  if (fail || !files.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
