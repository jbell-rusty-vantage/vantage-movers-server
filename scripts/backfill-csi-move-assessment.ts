/**
 * Assessment-only Move assessment backfill (MA-03; MA-01 §9, specification §9).
 *
 * Inventory (default, read-only, no manifest):
 *   node --env-file=.env --import tsx scripts/backfill-csi-move-assessment.ts [--inventory] [--out scripts/dev_ops/output/<file>.json]
 *     [--model <id>] [--cutoff <ISO>] [--limit N] [--subject-keys k1,k2] [--allow-production]
 * Shadow canary / apply (paid; the operator's personal gateway key only):
 *   node --env-file=.env --import tsx scripts/backfill-csi-move-assessment.ts --shadow|--apply
 *     --manifest scripts/dev_ops/output/<file>.json --max-subjects N --max-total-cents N --max-attempts-per-subject N
 *     --model <CSI_EXTRACTION_MODELS id> [--concurrency 1..4] [--hold-cents N] [--lead-only-cohort] [--subject-keys k1,k2]
 *     [--cutoff <ISO>] [--resume] --confirm-write [--allow-production]
 * Promote accepted shadow artifacts (zero model calls):
 *   ... --promote --manifest <file> --resume --confirm-write [--allow-production]
 *
 * Paid modes read PERSONAL_AI_GATEWAY_API_KEY only, refuse when it is missing or empty, and
 * clear AI_GATEWAY_API_KEY before the runtime loads so nothing can fall back to it. No HTTP
 * endpoint is called; the only provider traffic is the runtime's model call. Manifests and
 * reports carry identifiers and counts only.
 */
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { LanguageModel } from "ai" with { "resolution-mode": "import" };
import type { BackfillCaps, BackfillManifest, BackfillRunOptions, Cohort } from "../src/services/salesIntelligence/assessment/backfill";

export class BackfillRefusal extends Error {}

export type BackfillArgs = {
  mode: "inventory" | "shadow" | "apply" | "promote";
  manifest: string | null; out: string | null; model: string | null; cutoff: string | null; limit: number | null;
  caps: Partial<BackfillCaps>; hold_cents: number | null; cohort: Cohort; subject_keys: string[] | null;
  resume: boolean; confirm_write: boolean; allow_production: boolean;
};

const FLAGS = new Set(["--inventory", "--shadow", "--apply", "--promote", "--lead-only-cohort", "--resume", "--confirm-write", "--allow-production"]);
const VALUES = new Set(["--manifest", "--out", "--model", "--cutoff", "--limit", "--max-subjects", "--max-total-cents", "--max-attempts-per-subject",
  "--concurrency", "--hold-cents", "--subject-keys"]);

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  const values = new Map<string, string>(), flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS.has(arg)) flags.add(arg);
    else if (VALUES.has(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new BackfillRefusal(`missing value for ${arg}`);
      values.set(arg, value);
    } else throw new BackfillRefusal(`unknown argument ${arg}`);
  }
  const modes = (["--shadow", "--apply", "--promote"] as const).filter(flag => flags.has(flag));
  if (modes.length > 1 || (modes.length && flags.has("--inventory"))) throw new BackfillRefusal("choose one mode");
  const integer = (flag: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const raw = values.get(flag);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new BackfillRefusal(`${flag} must be an integer in ${min}..${max}`);
    return value;
  };
  const caps: Partial<BackfillCaps> = { max_subjects: integer("--max-subjects", 1), max_total_cents: integer("--max-total-cents", 0),
    max_attempts_per_subject: integer("--max-attempts-per-subject", 1, 10), concurrency: integer("--concurrency", 1, 4) ?? 1 };
  const subjectKeys = values.get("--subject-keys")?.split(",").map(key => key.trim()).filter(Boolean) ?? null;
  return {
    mode: modes[0] ? (modes[0].slice(2) as BackfillArgs["mode"]) : "inventory",
    manifest: values.get("--manifest") ?? null, out: values.get("--out") ?? null, model: values.get("--model") ?? null,
    cutoff: values.get("--cutoff") ?? null, limit: integer("--limit", 1) ?? null, caps, hold_cents: integer("--hold-cents", 1) ?? null,
    cohort: flags.has("--lead-only-cohort") ? "lead_only" : "summary", subject_keys: subjectKeys?.length ? subjectKeys : null,
    resume: flags.has("--resume"), confirm_write: flags.has("--confirm-write"), allow_production: flags.has("--allow-production"),
  };
}

/** Manifests and inventory files live only under the untracked `scripts/dev_ops/output/`. */
export function outputPath(path: string, root = resolve(process.cwd(), "scripts/dev_ops/output")) {
  const full = resolve(process.cwd(), path), rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !full.endsWith(".json")) throw new BackfillRefusal("manifest/out must be a .json file under scripts/dev_ops/output/");
  return full;
}

export function isLocalDatabase(database: string, uri: string | undefined) {
  return /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, path);
}
const exists = (path: string) => access(path).then(() => true, () => false);

export type BackfillSeams = {
  /** Test seam: a mocked model injected into the runtime (production builds the gateway model). */
  model?: LanguageModel;
  waitForRetry?: BackfillRunOptions["waitForRetry"];
  ledger?: BackfillRunOptions["ledger"];
  log?: (line: string) => void;
  now?: () => Date;
};

/** CLI library entry. Throws `BackfillRefusal` before any write or reservation when a precondition fails. */
export async function executeBackfill(argv: readonly string[], seams: BackfillSeams = {}) {
  const args = parseBackfillArgs(argv);
  const log = seams.log ?? ((line: string) => console.log(line));
  const paid = args.mode === "shadow" || args.mode === "apply";
  const writes = paid || args.mode === "promote";

  // Structural refusals first: nothing below touches Mongo or a provider until they pass.
  if (writes && !args.manifest) throw new BackfillRefusal("--manifest is required");
  const manifestPath = args.manifest ? outputPath(args.manifest) : null;
  const outPath = args.out ? outputPath(args.out) : null;
  if (paid) {
    for (const cap of ["max_subjects", "max_total_cents", "max_attempts_per_subject"] as const)
      if (args.caps[cap] === undefined) throw new BackfillRefusal(`--${cap.replaceAll("_", "-")} is required`);
    if (!args.model) throw new BackfillRefusal("--model is required");
  }
  if (writes && !args.confirm_write) throw new BackfillRefusal("--confirm-write is required");
  if (args.mode === "promote" && !args.resume) throw new BackfillRefusal("--promote works on an existing manifest: pass --resume");

  // The personal key is read once, by name, and never stored, printed or logged.
  let personalKey = "";
  if (paid) {
    personalKey = process.env.PERSONAL_AI_GATEWAY_API_KEY?.trim() ?? "";
    if (!personalKey) throw new BackfillRefusal("PERSONAL_AI_GATEWAY_API_KEY is missing or empty; the backfill never falls back to AI_GATEWAY_API_KEY");
  }
  // The company key is never read by this runner: cleared before the runtime is loaded.
  process.env.AI_GATEWAY_API_KEY = "";

  // Loaded only now (CommonJS require, in order), after the company key is cleared.
  const { connectMongo } = require("../src/db") as typeof import("../src/db");
  const { getMongoDatabaseName } = require("../src/config/domain/runtime") as typeof import("../src/config/domain/runtime");
  const config = require("../src/config/domain/salesIntelligence") as typeof import("../src/config/domain/salesIntelligence");
  const runtime = require("../src/services/salesIntelligence/assessment/runtime") as typeof import("../src/services/salesIntelligence/assessment/runtime");
  const backfill = require("../src/services/salesIntelligence/assessment/backfill") as typeof import("../src/services/salesIntelligence/assessment/backfill");
  const contract = require("../src/services/salesIntelligence/assessment/contract") as typeof import("../src/services/salesIntelligence/assessment/contract");
  const runtimeConfig = runtime.moveAssessmentRuntimeConfiguration();
  if (runtimeConfig.gateway_key) throw new BackfillRefusal("the runtime still sees a company gateway key; refusing");
  const model = args.model ?? runtimeConfig.model_id ?? null;
  if (!model || !(config.CSI_EXTRACTION_MODELS as readonly string[]).includes(model)) throw new BackfillRefusal("--model must be one of CSI_EXTRACTION_MODELS");
  if (paid && !runtimeConfig.pricing) throw new BackfillRefusal("SALES_INTELLIGENCE_ANALYSIS_* pricing is not configured");
  if (paid && !config.csiFlag("ENABLED")) throw new BackfillRefusal("SALES_INTELLIGENCE_ENABLED is off");

  const database = getMongoDatabaseName();
  if (!isLocalDatabase(database, process.env.MONGO_URI) && !args.allow_production)
    throw new BackfillRefusal("the database is not a local testvantagemovers_* one; pass --allow-production to proceed");
  await connectMongo();
  const dataset = config.csiDataset();
  const now = seams.now ?? (() => new Date());
  const cutoff = args.cutoff ? new Date(args.cutoff) : now();
  if (!Number.isFinite(cutoff.getTime())) throw new BackfillRefusal("--cutoff must be an ISO date");

  if (args.mode === "inventory") {
    const report = await backfill.inventoryCandidates({ cutoff, model, pricing: runtimeConfig.pricing, limit: args.limit ?? undefined,
      subject_keys: args.subject_keys, now: now() });
    const summary = backfill.inventorySummary(report);
    if (outPath) await writeJson(outPath, { dataset, model, ...report });
    log(JSON.stringify({ mode: "inventory", read_only: true, dataset, model, ...summary }));
    return { mode: args.mode, inventory: report };
  }

  // Manifest: create (frozen cohort) or resume.
  let manifest: BackfillManifest;
  const present = await exists(manifestPath!);
  if (args.resume) {
    if (!present) throw new BackfillRefusal("--resume: manifest not found");
    manifest = backfill.backfillManifestSchema.parse(JSON.parse(await readFile(manifestPath!, "utf8")));
    if (JSON.stringify(manifest.dataset) !== JSON.stringify(dataset)) throw new BackfillRefusal("manifest dataset differs from this database");
    if (manifest.cohort !== args.cohort) throw new BackfillRefusal("manifest cohort differs (use --lead-only-cohort only with a Lead-only manifest)");
    if (paid) {
      if (manifest.model !== model) throw new BackfillRefusal("--model differs from the manifest");
      const current = contract.assessmentStepContract();
      if (JSON.stringify(current) !== JSON.stringify(manifest.contract)) throw new BackfillRefusal("assessment contract changed since the manifest was frozen; start a new bounded run");
      try { backfill.applyCapChanges(manifest, { ...manifest.caps, ...args.caps } as BackfillCaps, now()); }
      catch { throw new BackfillRefusal("--max-subjects is frozen with the cohort; expansion requires a new bounded run"); }
      if (args.hold_cents) manifest.estimate.hold_floor_cents = Math.max(manifest.estimate.hold_floor_cents, args.hold_cents);
    }
  } else {
    if (present) throw new BackfillRefusal("manifest already exists; pass --resume or choose a new path");
    const inventory = await backfill.inventoryCandidates({ cutoff, model, pricing: runtimeConfig.pricing, subject_keys: args.subject_keys, now: now() });
    const stamp = cutoff.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    manifest = backfill.createManifest({ manifest_id: `mabf-${args.cohort === "lead_only" ? "lo" : "sum"}-${stamp}-${randomBytes(3).toString("hex")}`,
      cohort: args.cohort, cutoff, dataset, model, caps: backfill.backfillCapsSchema.parse(args.caps), candidates: inventory.candidates,
      subject_filter: args.subject_keys, now: now(),
      estimate: { basis: inventory.estimate.basis, assumption: backfill.ESTIMATE_ASSUMPTION, hold_floor_cents: args.hold_cents ?? 0 } });
  }
  const store = backfill.manifestStore(manifest, value => writeJson(manifestPath!, value));
  await store.checkpoint();
  log(JSON.stringify({ mode: args.mode, manifest_id: manifest.manifest_id, cohort: manifest.cohort, dataset, model: manifest.model,
    caps: manifest.caps, selected: manifest.rows.length, canary: manifest.selection.canary.length, deferred: manifest.selection.deferred.length,
    credential: backfill.BACKFILL_CREDENTIAL }));

  if (args.mode === "promote") {
    manifest.runs.push({ mode: "promote", started_at: now().toISOString(), finished_at: null, halted: null });
    await backfill.promoteRows(store, now);
    manifest.runs.at(-1)!.finished_at = now().toISOString();
    await store.checkpoint();
  } else {
    await backfill.runBackfill(store, { mode: args.mode as "shadow" | "apply", gateway_key: personalKey, model_id: model,
      pricing: runtimeConfig.pricing ?? undefined, model: seams.model, hold_cents: manifest.estimate.hold_floor_cents,
      waitForRetry: seams.waitForRetry, ledger: seams.ledger, now });
  }
  const report = backfill.backfillReport(manifest, await backfill.loadReportArtifacts(manifest));
  log(JSON.stringify({ report }));
  for (const line of report.reimbursement) log(`reimbursement: ${line}`);
  return { mode: args.mode, manifest, report, manifest_path: manifestPath };
}

if (require.main === module) {
  executeBackfill(process.argv.slice(2))
    .catch(error => {
      // Errors may carry provider text; print only a code, a refusal or an error name.
      const message = error instanceof BackfillRefusal ? { refused: error.message }
        : { stopped: true, error: error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.name : "unknown_error" };
      console.error(JSON.stringify(message));
      process.exitCode = error instanceof BackfillRefusal ? 2 : 1;
    })
    .finally(async () => { const mongoose = (await import("mongoose")).default; await mongoose.disconnect(); });
}
