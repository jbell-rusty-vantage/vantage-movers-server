import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CSI_JOB_STAGES, CSI_RETIRED_JOB_STAGES } from "../../config/domain/salesIntelligence";

/**
 * SRV-T (IMPLEMENTATION-PLAN §7/§8; D01 deterministic scope): a static import-graph check that runs in
 * the unit suite (CI).
 * 1. No module reachable from `src/services/salesOutreach/**` imports a model / AI / transcription SDK,
 *    and none lives on a retired AI/media/analysis path.
 * 2. No job stage enqueued from `src/services/salesOutreach/**` is a retired stage; every stage named
 *    there is a retained, registered stage.
 */

const SRC = path.resolve(__dirname, "../..");
const DESK = path.resolve(__dirname);

/** Packages that call a model, transcribe audio or run an AI pipeline. */
const FORBIDDEN_PACKAGES = [/^ai$/, /^@ai-sdk\//, /^openai$/, /^@anthropic-ai\//, /^@google\/generative-ai$/, /^@google\/genai$/, /^assemblyai$/, /^@deepgram\//, /^@modelcontextprotocol\//, /^langchain/, /^@langchain\//];
/** Source paths of the retired AI/media/Outreach pipeline (server-admin slimming) and any model seam. */
const FORBIDDEN_PATHS = [/\/analysis\//, /\/assessment\//, /\/transcri/i, /\/media\//, /\/llm/i, /\/(ai|models?Gateway|aiGateway)\//, /\/outreach\/(?!.*salesOutreach)/, /\/backfill\//, /intelligenceRun/i];

const isTest = (file: string) => /\.test\.ts$/.test(file) || /[\\/](testing|testSupport|deskTesting|testingPipeline)\.ts$/.test(file);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of [/(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/g, /import\(\s*["']([^"']+)["']\s*\)/g, /require\(\s*["']([^"']+)["']\s*\)/g, /^\s*import\s+["']([^"']+)["']/gm])
    for (const m of source.matchAll(re)) out.push(m[1]!);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts"), base]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

/** Every module reachable from the desk's non-test sources, with the packages each imports. */
function reachable(): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = walk(DESK).filter((f) => !isTest(f));
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const target = resolveLocal(file, spec);
        if (target && target.startsWith(SRC)) queue.push(target);
      } else if (!spec.startsWith("node:")) packages.set(spec, file);
    }
  }
  return { files, packages };
}

test("SRV-T: no model, AI or transcription call path is importable from salesOutreach/*", () => {
  const { files, packages } = reachable();
  assert.ok(files.size > 50, `the walk found the desk graph (${files.size} modules)`);
  for (const [pkg, importer] of packages)
    assert.ok(!FORBIDDEN_PACKAGES.some((re) => re.test(pkg)), `${path.relative(SRC, importer)} imports ${pkg}`);
  for (const file of files) {
    const rel = `/${path.relative(SRC, file).split(path.sep).join("/")}`;
    if (rel.startsWith("/services/salesOutreach/")) continue;
    assert.ok(!FORBIDDEN_PATHS.some((re) => re.test(rel)), `the desk reaches ${rel}`);
  }
});

test("SRV-T: no retired job stage can be enqueued from salesOutreach/*; every stage named there is retained", () => {
  const retired = new Set<string>(CSI_RETIRED_JOB_STAGES);
  const retained = new Set<string>(CSI_JOB_STAGES);
  const named: string[] = [];
  for (const file of walk(DESK).filter((f) => !isTest(f))) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\bstage\s*:\s*["']([a-z_]+)["']/g)) named.push(m[1]!);
    for (const m of source.matchAll(/claimCsiJob\([^)]*["']([a-z_]+)["']\s*\)/g)) named.push(m[1]!);
    for (const stage of retired) assert.ok(!new RegExp(`["']${stage}["']`).test(source), `${path.relative(SRC, file)} names retired stage ${stage}`);
  }
  assert.ok(named.length >= 2, "the desk's job stages were found");
  for (const stage of named) assert.ok(retained.has(stage) && !retired.has(stage), `stage ${stage} is not a retained stage`);
});
