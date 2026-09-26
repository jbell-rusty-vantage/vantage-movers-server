/**
 * Full Sales Intelligence backfill on PERSONAL_AI_GATEWAY_API_KEY (handoff
 * `CSI-PERSONAL-KEY-FULL-BACKFILL-HANDOFF.md` §4–§7, amendments A1–A5). Logic: `lib/full-backfill.ts`.
 *
 * Estimate (default; free and strictly read-only: no gateway key, no manifest, no row written):
 *   node --env-file=.env --import tsx ops/backfill-csi-full-personal.ts --estimate --allow-production \
 *     [--layout case_file|default] [--numbers id,id] [--max-numbers N] [--since ISO] [--repair-manifest <abs path>] [--json <out.json>]
 *
 * Paid run (from a clean worktree of the deployed commit; detached, see the session prompt §7):
 *   node --max-old-space-size=8192 --env-file=.env --import tsx ops/backfill-csi-full-personal.ts \
 *     --allow-production --confirm-write --concurrency 2 --manifest ops/output/csi-full-backfill-<date>.json \
 *     --repair-manifest <abs path to call-log-repair-2026-09-20.json> [--layout case_file] [--s10-holds drive|leave] \
 *     [--numbers id,id | --max-numbers N] [--since ISO] [--repair-max-wait-minutes 120] [--repair-idle-minutes 60] [--skip-repair]
 * Resume: the same command plus --resume.
 *
 * Phase 1 spawns `ops/repair-call-log-capture.ts --manifest <repair manifest> --allow-production --confirm-write`
 * (no `--through`, never `--release-holds`) and waits for it; `--skip-repair` only reads its hold ownership.
 * Output: the manifest (`csi-full-backfill-v1`) and a JSONL log next to it. Identifiers only.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiDataset, csiProviderConfiguration } from "../src/config/domain/salesIntelligence";
import { readRecordedDeployment } from "../src/services/salesIntelligence/deploymentStamp";
import { ensureCurrentCsiBudgetPeriod } from "../src/services/salesIntelligence/budgetPeriod";
import {
  acquireRepairLock, budgetHeadroom, configurePaidProcess, releaseRepairLock, repairLockPath, createBackfillRunners, estimateWorkSet, jsonlLogger, loadManifest, manifestSaver,
  newManifest, parseCliOptions, readRepairHoldIds, runFullBackfill, selectWorkSet, targetVersions, type FullBackfillManifest,
} from "./lib/full-backfill";
import { assertProductionWriterMatchesDeployment, localGitHead } from "./lib/production-writer-guard";

const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

/** After the repair prints its `{"done":true…}` line it has nothing left to do; a child still alive this long after is stopped. */
const REPAIR_EXIT_GRACE_MS = 60_000;

/**
 * Phase 1: the repair's own script on its own manifest; the child inherits this process's paid configuration.
 * - Lock: `<manifest>.repair.lock` holds the child's PID; a start or resume while that PID is alive refuses.
 * - Watchdog: the repair script ends with `mongoose.disconnect()`, not `process.exit()`, so an open handle can keep it
 *   alive. Once it reports `done` it gets a grace period and is then stopped (exit 0). A child with no output for
 *   `--repair-idle-minutes` is stopped and the phase is marked failed (resumable).
 */
async function spawnRepair(repairManifest: string, input: { allowProduction: boolean; maxWaitMinutes: number; idleMinutes: number; rcTokenStore: string | null; lockPath: string }) {
  const env = { ...process.env };
  // The repair fetches media through its own code (handoff A4); it keeps the store it ran with.
  if (input.rcTokenStore === null) delete env.RC_TOKEN_STORE; else env.RC_TOKEN_STORE = input.rcTokenStore;
  await acquireRepairLock(input.lockPath, { pid: process.pid, started_at: new Date().toISOString(), repair_manifest: repairManifest });
  const child = spawn(process.execPath, ["--max-old-space-size=8192", "--import", "tsx", "ops/repair-call-log-capture.ts",
    "--manifest", repairManifest, "--confirm-write", "--max-wait-minutes", String(input.maxWaitMinutes),
    ...(input.allowProduction ? ["--allow-production"] : [])], { stdio: ["ignore", "pipe", "pipe"], env, cwd: resolve(__dirname, "..") });
  const lockPid = child.pid ?? process.pid;
  if (child.pid) await writeFile(input.lockPath, JSON.stringify({ pid: child.pid, started_at: new Date().toISOString(), repair_manifest: repairManifest }) + "\n");
  return new Promise<number | null>((done, fail) => {
    let reported: "done" | "stopped" | null = null, tail = "", idled = false;
    let grace: NodeJS.Timeout | null = null, idle: NodeJS.Timeout | null = null;
    const arm = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => { idled = true; console.error(JSON.stringify({ repair_watchdog: "idle", minutes: input.idleMinutes })); child.kill(); }, input.idleMinutes * 60_000);
    };
    arm();
    child.stderr.on("data", (chunk: Buffer) => { process.stderr.write(chunk); arm(); });
    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      arm();
      tail = (tail + chunk.toString("utf8")).slice(-4_096);
      if (!reported && /"done":true/.test(tail)) reported = "done";
      if (!reported && /"stopped":true/.test(tail)) reported = "stopped";
      if (reported === "done" && !grace) grace = setTimeout(() => { console.error(JSON.stringify({ repair_watchdog: "exit_after_done" })); child.kill(); }, REPAIR_EXIT_GRACE_MS);
    });
    child.on("exit", code => {
      if (idle) clearTimeout(idle);
      if (grace) clearTimeout(grace);
      // An idle stop is a failed phase even if the child exits 0 when killed.
      const result = reported === "done" && !idled ? 0 : idled || reported === "stopped" ? (code || 1) : code;
      void releaseRepairLock(input.lockPath, lockPid).finally(() => done(result));
    });
    child.on("error", error => { void releaseRepairLock(input.lockPath, lockPid).finally(() => fail(error)); });
  });
}

async function main() {
  const options = parseCliOptions(process.argv);
  const repairManifest = options.repairManifest ? resolve(options.repairManifest) : null;
  if (repairManifest && !existsSync(repairManifest)) throw new Error(`repair manifest ${repairManifest} does not exist (phase 1 never starts a new repair)`);
  const target = targetVersions(options.layout);
  const paid = options.mode === "apply" ? configurePaidProcess(process.env, options.layout) : null;
  const model = process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ?? "openai/gpt-5.6-luna";

  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !options.allowProduction)
    throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production to proceed");
  const now = new Date();

  if (options.mode === "estimate") {
    const repairHoldIds = await readRepairHoldIds(repairManifest);
    const ws = await selectWorkSet(target, { numbers: options.numbers, since: options.since, maxNumbers: options.maxNumbers }, now);
    const estimate = await estimateWorkSet(ws, target, model, repairHoldIds, now);
    const report = { mode: "estimate", database, ...estimate };
    console.log(JSON.stringify(report, null, 1));
    if (options.json) await writeFile(resolve(options.json), JSON.stringify(report, null, 1) + "\n");
    return;
  }

  // CC-00 §5.2: only the deployed build writes production (never pass --allow-schema-drift for a paid run).
  await assertProductionWriterMatchesDeployment();
  // The budget period is ensured before the run and again before every paid unit (the month rolls over mid-run),
  // so no fixed headroom rule applies; this refuses only when no active period can be ensured at all.
  const period = await ensureCurrentCsiBudgetPeriod(now).catch(error => {
    throw new Error(`budget preflight refused: no active budget period (${error instanceof Error ? error.message : "unknown"})`);
  });
  const headroom = budgetHeadroom(period ? { month: String(period.month), period_start: period.period_start, period_end: period.period_end,
    activated_at: period.activated_at ?? null } : null, now);

  const manifestPath = resolve(options.manifest ?? `ops/output/csi-full-backfill-${now.toISOString().slice(0, 10)}.json`);
  let manifest: FullBackfillManifest | null = await loadManifest(manifestPath);
  if (manifest && !options.resume) throw new Error(`manifest ${manifestPath} exists; pass --resume to continue it`);
  if (!manifest && options.resume) throw new Error(`--resume: manifest ${manifestPath} does not exist`);
  if (manifest && JSON.stringify(manifest.dataset) !== JSON.stringify(csiDataset())) throw new Error("manifest dataset differs from this database");
  if (manifest && manifest.layout !== options.layout) throw new Error(`manifest layout is ${manifest.layout}; resume with --layout ${manifest.layout}`);
  const provider = csiProviderConfiguration();
  manifest ??= newManifest({ now, layout: options.layout, deployed_commit: (await readRecordedDeployment())?.deployment_commit ?? null, local_head: localGitHead(),
    models: { extraction: provider.extractionModel, transcription: provider.transcriptionModel, stt_cents_per_second: String(provider.transcriptionCentsPerSecond),
      analysis_pricing_version: process.env.SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION ?? null, analysis_v3: process.env.SALES_INTELLIGENCE_ANALYSIS_V3 ?? null },
    options: { concurrency: options.concurrency, numbers: options.numbers, max_numbers: options.maxNumbers, since: options.since?.toISOString() ?? null,
      s10_holds: options.s10Holds, repair_manifest: repairManifest } });
  manifest.options.s10_holds = options.s10Holds;
  manifest.options.concurrency = options.concurrency;
  const save = manifestSaver(manifestPath);
  const log = jsonlLogger(manifestPath.replace(/\.json$/, "") + ".jsonl", manifest.run_id,
    line => { if (!/"event":"(unit|hold|release|created)"/.test(line)) console.log(line); });
  await save(manifest);
  await log("start", { database, manifest: manifestPath, layout: manifest.layout, prompt_versions: manifest.prompt_versions, models: manifest.models,
    deployed_commit: manifest.deployed_commit, budget_hours_left: headroom.hours_left, options: manifest.options, resume: options.resume });

  const summary = await runFullBackfill(manifest, {
    runners: createBackfillRunners(), save, log,
    runRepair: path => spawnRepair(path, { allowProduction: options.allowProduction, maxWaitMinutes: options.repairMaxWaitMinutes,
      idleMinutes: options.repairIdleMinutes, rcTokenStore: paid!.rcTokenStore, lockPath: repairLockPath(manifestPath) }),
  }, { concurrency: options.concurrency, s10Holds: options.s10Holds, repairManifest, skipRepair: options.skipRepair,
    numbers: manifest.options.numbers, since: manifest.options.since ? new Date(manifest.options.since) : null, maxNumbers: manifest.options.max_numbers, model: paid!.model });
  console.log(JSON.stringify({ done: true, manifest: manifestPath, ...summary, verify: manifest.phases.verify }));
  if (manifest.stopped) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ stopped: true, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 400) : "setup_failed" }));
  process.exitCode = 1;
}).finally(async () => { await mongoose.disconnect().catch(() => undefined); process.exit(); });
