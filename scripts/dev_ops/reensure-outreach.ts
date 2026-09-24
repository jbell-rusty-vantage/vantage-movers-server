/**
 * S10 step 6 (reconciliation addendum §5, C24/C25): the full Outreach re-ensure lap.
 * Core, candidate set and the dry-run prediction: `scripts/dev_ops/lib/reensure-outreach.ts`.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/reensure-outreach.ts --allow-production [--limit=N] [--batch=25]     # dry run (read only)
 *   node --env-file=.env --import tsx scripts/dev_ops/reensure-outreach.ts --apply --allow-production                        # operator, after steps 1–5
 *   node --env-file=.env --import tsx scripts/dev_ops/reensure-outreach.ts --apply --allow-production --resume               # continue a stopped apply
 *   node --env-file=.env --import tsx scripts/dev_ops/reensure-outreach.ts --apply --allow-production --release-holds        # operator decision: hand held paid jobs back
 *
 * Rules (§5): dry run by default (read only: no transaction, no write); `--allow-production` required for any
 * database that is not a local `testvantagemovers_*`; `--apply` runs the production-writer drift guard and
 * needs OUTREACH_ENSURE and LEAD_PROGRESS on in this process (the deployed values: the lap runs the worker's
 * code with this process's flags), and PRIORITY5_CLOSURE on once any record is closed `granot_booked`;
 * resumable (checkpoint by record `_id` after every committed transaction + JSONL); bounded (`--batch`
 * records per page, `OUTREACH_NUMBER_REPLAY_PAGE` calls per transaction); `--limit`; report into
 * `sales-intelligence-ui-ux-workspace/evidence/S10-6-<env>[-dry-run].md` plus a `.json` summary (the band
 * counts before and after that step 9 reads); zero model calls: `--no-progress-plan` is on by default and
 * cannot be turned off (`--allow-progress-plan`) against production, and any paid job the lap creates is
 * put on `operator_hold` in the transaction that created it.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { csiFlag } from "../../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";
import { fileSeams, newReensureCheckpoint, releaseReensureHolds, REENSURE_VERSION, reensureReport, reensureSummary, runReensureOutreach, type ReensureCheckpoint } from "./lib/reensure-outreach";

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const OUT_DIR = "scripts/dev_ops/output";
const WORKSPACE_EVIDENCE = resolve(process.cwd(), "../sales-intelligence-ui-ux-workspace/evidence");
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");
export const REPORT_FLAGS = ["OUTREACH_ENSURE", "LEAD_PROGRESS", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "MOVE_ASSESSMENT", "ENABLED", "PRIORITY5_CLOSURE", "RECEIVER_ASSIGNMENT"] as const;
export const reportFlags = () => Object.fromEntries(REPORT_FLAGS.map(name => [name, csiFlag(name as never)]));

async function main() {
  const apply = flag("apply"), resume = flag("resume");
  const noProgressPlan = !flag("allow-progress-plan");
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  const production = database === "vantagemovers";
  if (!localDatabase(database, process.env.MONGO_URI) && !flag("allow-production")) throw new Error(`${database} is not a local testvantagemovers_* database; pass --allow-production`);
  if (production && !noProgressPlan) throw new Error("--allow-progress-plan is refused against production: the lap would nominate paid Move assessment re-plans");
  if (apply) {
    for (const name of ["OUTREACH_ENSURE", "LEAD_PROGRESS"] as const) if (!csiFlag(name)) throw new Error(`--apply requires SALES_INTELLIGENCE_${name}=true (the deployed value)`);
    // With PRIORITY5_CLOSURE off here, the lap would read 5 as unmapped and open a disposition_reopen review on every granot_booked record.
    if (!csiFlag("PRIORITY5_CLOSURE") && await getOutreachRecordModel().exists({ state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_booked" }))
      throw new Error("--apply requires SALES_INTELLIGENCE_PRIORITY5_CLOSURE=true: records are closed granot_booked");
    await assertProductionWriterMatchesDeployment();
  }
  const env = production ? "production" : localDatabase(database, process.env.MONGO_URI) ? "replica" : database;
  const outDir = arg("out") ?? OUT_DIR;
  const base = join(outDir, `reensure-outreach-${database}-${apply ? "apply" : "dry-run"}`);
  const checkpointPath = `${base}.checkpoint.json`;
  let cp: ReensureCheckpoint | null = null;
  if (existsSync(checkpointPath)) {
    const prior = JSON.parse(await readFile(checkpointPath, "utf8")) as ReensureCheckpoint;
    if (prior.version !== REENSURE_VERSION || prior.database !== database) throw new Error(`${checkpointPath} is for another run`);
    if (resume || flag("release-holds")) cp = prior;
    else if (!prior.finished_at && apply) throw new Error(`${checkpointPath} is an unfinished apply (run ${prior.run_id}): pass --resume, or move the file away to start over`);
    else await rename(checkpointPath, `${base}.${prior.run_id}.checkpoint.json`);
  } else if (resume || flag("release-holds")) throw new Error(`no checkpoint at ${checkpointPath} to resume`);
  // `--as-of=ISO` (replica only): one fixed clock for the bands and the work, so a proof is reproducible.
  const asOf = arg("as-of") ? new Date(arg("as-of")!) : null;
  if (asOf && (!localDatabase(database, process.env.MONGO_URI) || !Number.isFinite(+asOf))) throw new Error("--as-of is a replica-only fixed clock");
  cp ??= newReensureCheckpoint(database, apply, noProgressPlan, asOf ?? new Date());
  const seams = { ...fileSeams(base, cp.run_id, line => console.log(line)), ...(asOf ? { now: () => asOf } : {}) };
  if (flag("release-holds")) {
    if (!apply) throw new Error("--release-holds needs --apply (it hands paid work back to production consumers)");
    console.log(JSON.stringify({ released: await releaseReensureHolds(cp, seams) }));
    return;
  }
  const limit = arg("limit") ? Number(arg("limit")) : null;
  await runReensureOutreach({ apply, limit, batch: Number(arg("batch") ?? 25), noProgressPlan: cp.no_progress_plan }, cp, seams);
  const reportDir = arg("report-dir") ?? (existsSync(WORKSPACE_EVIDENCE) ? WORKSPACE_EVIDENCE : outDir);
  await mkdir(reportDir, { recursive: true });
  const name = `S10-6-${env}${apply ? "" : "-dry-run"}`;
  const files = { checkpoint: checkpointPath, jsonl: `${base}.jsonl`, summary: join(reportDir, `${name}.json`) };
  await writeFile(files.summary, JSON.stringify(reensureSummary(cp, reportFlags()), null, 1) + "\n");
  await writeFile(join(reportDir, `${name}.md`), reensureReport(cp, env, reportFlags(), files));
  console.log(JSON.stringify({ report: join(reportDir, `${name}.md`), summary: files.summary, processed: cp.processed, finished: cp.finished_at !== null,
    holds: cp.holds.length, replans_suppressed: cp.totals.replans_suppressed, predicted_replans: cp.totals.predicted_replans }));
}
if (require.main === module) {
  main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
}
