/**
 * CC-07 historical repair (Call Log capture completeness §6.7).
 *
 * Re-projects the provider Call Log from --from (default 2026-09-20T00:00Z) to --to (default now) in
 * 24 h windows, classifying every record MISSING / STALE / unchanged against the stored row before
 * any write, then (write mode only) applying it with the live source so live downstream scheduling
 * applies, and driving each changed interaction's recording discovery → media fetch → transcription
 * → analysis → application → number refresh in this process on PERSONAL_AI_GATEWAY_API_KEY
 * (personal ledger; same models as production; no cost cap). See lib/call-log-repair.ts.
 *
 * Run only after CC-04 (provisional Call Log records) is deployed, from the deployed commit.
 *
 * Dry run (read-only: RingCentral GET + Mongo reads):
 *   node --env-file=.env --import tsx ops/repair-call-log-capture.ts \
 *     --from 2026-09-21T00:00:00Z --to 2026-09-22T00:00:00Z --manifest ops/output/<name>.json --allow-production
 * Write:
 *   node --env-file=.env --import tsx ops/repair-call-log-capture.ts \
 *     --manifest ops/output/<name>.json --allow-production --confirm-write [--max-wait-minutes 120]
 * Resume: re-run the same command (the manifest is resumable). Give held units back to production
 * consumers instead: add --release-holds.
 * `--through transcription`: fix records, fetch media and transcribe, and hold every analysis on
 * `operator_hold`; a later run on the same manifest without it releases and runs the held analyses.
 *
 * Output: the manifest (--manifest) and a JSONL log next to it (<manifest>.jsonl). Identifiers only.
 */
import { resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiDataset, csiProviderConfiguration } from "../src/config/domain/salesIntelligence";
import {
  jsonlLogger, loadManifest, manifestSaver, newManifest, runCallLogRepair, type RepairManifest,
} from "./lib/call-log-repair";
import { createStageRunners } from "./lib/call-log-repair-stages";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";

export const REPAIR_DEFAULT_FROM = "2026-09-20T00:00:00Z";

function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}
const flag = (name: string) => process.argv.includes(name);
/** `--through transcription`: fix records, fetch media and transcribe; hold every analysis for a later full run. */
const throughTranscription = () => {
  const value = option("--through");
  if (value === null || value === undefined) return false;
  if (value !== "transcription") throw new Error("--through accepts only 'transcription'");
  return true;
};
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");
const date = (name: string, value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} is not a date`);
  return parsed;
};

/**
 * Paid work in this process uses the operator's personal key only, books to the personal ledger,
 * and never falls back to the company key or its Vercel OIDC identity. Production pipeline flags are
 * set for this process so the workers run; Move assessment nomination stays off here (it would be
 * queued for the company-key cron), see the report.
 */
function configurePaidProcess() {
  const personal = process.env.PERSONAL_AI_GATEWAY_API_KEY?.trim() ?? "";
  if (!personal) throw new Error("PERSONAL_AI_GATEWAY_API_KEY is missing or empty; the repair never falls back to AI_GATEWAY_API_KEY");
  process.env.AI_GATEWAY_API_KEY = personal;
  delete process.env.VERCEL_OIDC_TOKEN;
  // No queue wake-up from this process: a published job id would be run by the production consumer.
  delete process.env.VERCEL;
  delete process.env.VERCEL_REGION;
  process.env.SALES_INTELLIGENCE_PERSONAL_LEDGER = "true";
  for (const name of ["ENABLED", "MEDIA_ENABLED", "STT_ENABLED", "EXTRACTION_ENABLED", "OUTREACH_ENSURE"])
    process.env[`SALES_INTELLIGENCE_${name}`] = "true";
  process.env.SALES_INTELLIGENCE_MOVE_ASSESSMENT = "false";
  // Same models as production (the context-refresh backfill's production values unless overridden in env).
  process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ??= "openai/gpt-5.6-luna";
  process.env.SALES_INTELLIGENCE_ANALYSIS_V3 ??= "true";
  const rate = Number(process.env.SALES_INTELLIGENCE_STT_CENTS_PER_SECOND);
  if (!Number.isFinite(rate) || rate <= 0)
    throw new Error("SALES_INTELLIGENCE_STT_CENTS_PER_SECOND must be set to the production value (transcription pauses without STT pricing)");
}

async function main() {
  const confirm = flag("--confirm-write");
  const manifestPath = resolve(option("--manifest") ?? `ops/output/call-log-repair-${confirm ? "apply" : "dry-run"}.json`);
  const maxWaitMinutes = Number(option("--max-wait-minutes") ?? 120);
  if (!Number.isFinite(maxWaitMinutes) || maxWaitMinutes < 0) throw new Error("--max-wait-minutes must be ≥ 0");
  if (confirm) configurePaidProcess();

  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !flag("--allow-production"))
    throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production to proceed");
  // CC-00 §5.2: only the deployed build writes production (override: --allow-schema-drift). A dry run writes nothing.
  if (confirm) await assertProductionWriterMatchesDeployment();

  let manifest: RepairManifest | null = await loadManifest(manifestPath);
  const mode = confirm ? "apply" : "dry_run";
  if (manifest && manifest.mode !== mode) throw new Error(`manifest ${manifestPath} is a ${manifest.mode} manifest; use a new --manifest for ${mode}`);
  if (manifest && JSON.stringify(manifest.dataset) !== JSON.stringify(csiDataset())) throw new Error("manifest dataset differs from this database");
  const provider = csiProviderConfiguration();
  manifest ??= newManifest({
    mode, now: new Date(),
    from: date("--from", option("--from") ?? REPAIR_DEFAULT_FROM),
    to: date("--to", option("--to") ?? new Date().toISOString()),
    credential: confirm ? "PERSONAL_AI_GATEWAY_API_KEY" : null,
    models: confirm ? { extraction: provider.extractionModel, transcription: provider.transcriptionModel,
      stt_cents_per_second: String(provider.transcriptionCentsPerSecond), analysis_v3: process.env.SALES_INTELLIGENCE_ANALYSIS_V3 ?? null } : {},
  });
  const save = manifestSaver(manifestPath);
  const log = jsonlLogger(manifestPath.replace(/\.json$/, "") + ".jsonl", manifest.run_id,
    line => { if (!/"event":"(page|stage|classified|applied)"/.test(line)) console.log(line); });
  await save(manifest);
  await log("start", { mode, database, manifest: manifestPath, range: manifest.range, credential: manifest.credential, models: manifest.models });

  const summary = await runCallLogRepair(manifest, {
    save, log, maxWaitMs: maxWaitMinutes * 60_000,
    ...(confirm ? { stages: createStageRunners({ runId: manifest.run_id }) } : {}),
  }, { releaseHolds: flag("--release-holds"), throughTranscription: throughTranscription() });
  console.log(JSON.stringify({ done: true, manifest: manifestPath, ...summary }));
}

main().catch(error => {
  console.error(JSON.stringify({ stopped: true, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 400) : "setup_failed" }));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
