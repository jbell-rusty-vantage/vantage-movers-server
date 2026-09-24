/**
 * S10 step 4 (reconciliation §5; assignment addendum §2.3, E1/E2): the Priority 5 reconcile.
 * Core and bucket definitions: `scripts/dev_ops/lib/priority5-reconcile.ts`.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/reconcile-priority5.ts [--limit=N]                        # dry run (read-only)
 *   node --env-file=.env --import tsx scripts/dev_ops/reconcile-priority5.ts --allow-production                   # production dry run
 *   SALES_INTELLIGENCE_PRIORITY5_CLOSURE=true ... --apply --allow-production [--resume]                           # operator, gate G-S6
 *   ... --apply --allow-production --release-holds --manifest=<path>                                            # operator: hand held number_refresh back
 *
 * Flags. The dry run forces the Priority 5 mapping in this process only (it reports what the mapping
 * WOULD do, before activation). `--apply` refuses unless SALES_INTELLIGENCE_PRIORITY5_CLOSURE,
 * LEAD_PROGRESS and OUTREACH_ENSURE are `true` in this process's env, and the deployed server must
 * already run with PRIORITY5_CLOSURE on: with it off the live repair would read 5 as unmapped again and
 * open a `disposition_reopen` review on every record this run closed.
 *
 * Rules (§5): dry run by default; `--allow-production` required against `vantagemovers`; `--apply`
 * runs the production-writer drift guard; resumable (manifest checkpoint + JSONL); report into
 * `sales-intelligence-ui-ux-workspace/evidence/S10-4-<env>.md` (or `--report-dir`); zero model calls
 * (the paid-stage job counter before/after; the E2 upgrade's `number_refresh` is put on `operator_hold`).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { csiFlag } from "../../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";
import { jsonlLogger } from "./lib/call-log-repair";
import { newP5Manifest, P5_PAID_STAGES, P5_RECONCILE_VERSION, priority5Report, releasePriority5Holds, runPriority5Reconcile, type P5Manifest } from "./lib/priority5-reconcile";

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const OUT_DIR = "scripts/dev_ops/output";
const WORKSPACE_EVIDENCE = resolve(process.cwd(), "../sales-intelligence-ui-ux-workspace/evidence");

async function main() {
  const apply = flag("apply");
  if (!apply) process.env.SALES_INTELLIGENCE_PRIORITY5_CLOSURE = "true";
  else for (const name of ["PRIORITY5_CLOSURE", "LEAD_PROGRESS", "OUTREACH_ENSURE"] as const)
    if (!csiFlag(name)) throw new Error(`--apply requires SALES_INTELLIGENCE_${name}=true (and the deployed server running with PRIORITY5_CLOSURE on)`);
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  const production = database === "vantagemovers";
  if (production && !flag("allow-production")) throw new Error("Refusing to run against the production database without --allow-production");
  if (apply) await assertProductionWriterMatchesDeployment();
  const env = production ? "production" : database;
  const manifestPath = arg("manifest") ?? `${OUT_DIR}/priority5-reconcile-${database}-${apply ? "apply" : "dry-run"}.json`;
  let manifest: P5Manifest | null = null;
  if (flag("resume") || flag("release-holds")) {
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")) as P5Manifest; } catch { manifest = null; }
    if (manifest && (manifest.version !== P5_RECONCILE_VERSION || manifest.database !== database || manifest.mode !== (apply ? "apply" : "dry_run"))) throw new Error(`manifest ${manifestPath} is for another run`);
  }
  manifest ??= newP5Manifest(database, apply);
  const save = async (m: P5Manifest) => { await mkdir(dirname(manifestPath), { recursive: true }); await writeFile(`${manifestPath}.tmp`, JSON.stringify(m, null, 2)); await rename(`${manifestPath}.tmp`, manifestPath); };
  const log = jsonlLogger(manifestPath.replace(/\.json$/, "") + ".jsonl", manifest.run_id, line => { if (!line.includes('"event":"candidate"')) console.log(line); });
  if (flag("release-holds")) {
    if (!apply) throw new Error("--release-holds needs --apply (it hands paid work back to production consumers)");
    console.log(JSON.stringify({ released: await releasePriority5Holds(manifest, { save, log }) }));
    return;
  }
  const limit = arg("limit") ? Number(arg("limit")) : null;
  await runPriority5Reconcile({ apply, limit, page: Number(arg("page") ?? 25) }, manifest, { save, log });
  const claimableDelta = P5_PAID_STAGES.reduce((sum, stage) => sum + ((manifest!.jobs_after?.[stage] ?? 0) - (manifest!.jobs_before?.[stage] ?? 0)), 0);
  const reportDir = arg("report-dir") ?? (existsSync(WORKSPACE_EVIDENCE) ? WORKSPACE_EVIDENCE : OUT_DIR);
  await mkdir(reportDir, { recursive: true });
  const report = join(reportDir, `S10-4-${env}${apply ? "-apply" : ""}.md`);
  await writeFile(report, priority5Report(manifest, env, { PRIORITY5_CLOSURE: csiFlag("PRIORITY5_CLOSURE"), LEAD_PROGRESS: csiFlag("LEAD_PROGRESS"), OUTREACH_ENSURE: csiFlag("OUTREACH_ENSURE"),
    PROGRESS_PLAN: csiFlag("PROGRESS_PLAN"), ATTENTION_EVOLUTION: csiFlag("ATTENTION_EVOLUTION") }) +
    `\nClaimable paid-stage delta (production consumers may add their own work during the run): ${claimableDelta}. Manifest \`${manifestPath}\`, JSONL \`${manifestPath.replace(/\.json$/, "")}.jsonl\`.\n`);
  console.log(JSON.stringify({ report, manifest: manifestPath, processed: manifest.processed, finished: manifest.finished_at !== null, holds: manifest.holds.length, claimable_paid_delta: claimableDelta }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
