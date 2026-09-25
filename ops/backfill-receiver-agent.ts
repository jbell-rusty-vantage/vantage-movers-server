/**
 * S10 step 3 (reconciliation §5; assignment addendum §3.3, E7): the `receiver_agent` backfill.
 * Core and bucket definitions: `ops/backfill-receiver-agent.lib.ts`.
 *
 *   node --env-file=.env --import tsx ops/backfill-receiver-agent.ts [--limit=N] [--page=50]              # dry run (read-only)
 *   node --env-file=.env --import tsx ops/backfill-receiver-agent.ts --allow-production                    # production dry run
 *   SALES_INTELLIGENCE_RECEIVER_LATEST_WINS=true SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT=true \
 *     ... --apply --allow-production [--resume]                                                              # operator, S10 step 3
 *
 * Flags. The dry run needs none (it only plans). `--apply` refuses unless SALES_INTELLIGENCE_RECEIVER_LATEST_WINS
 * and SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT are `true` in this process's env, and the deployed server should run
 * with both on: with LATEST_WINS off the live Granot processor would stop replacing reps after the backfill set
 * them, and with RECEIVER_ASSIGNMENT off the Outreach scan would not turn the written `receiver_agent` changes
 * into `crm_receiver` assignments (they would wait for the flag and the S10 step 6 re-ensure lap).
 *
 * Rules (§5): dry run by default; `--allow-production` required against `vantagemovers`; `--apply` runs the
 * production-writer drift guard; resumable (manifest checkpoint + JSONL); report into
 * `sales-intelligence-ui-ux-workspace/evidence/S10-3-<env>.md` (or `--report-dir`); zero model calls and zero
 * Sales Intelligence jobs (each apply page aborts if one appears; the job table is counted before and after).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { csiFlag } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";
import { jsonlLogger } from "./lib/call-log-repair";
import { newReceiverBackfillManifest, RECEIVER_BACKFILL_VERSION, receiverBackfillReport, runReceiverBackfill, type ReceiverBackfillManifest } from "./lib/backfill-receiver-agent.lib";

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const OUT_DIR = "ops/output";
const WORKSPACE_EVIDENCE = resolve(process.cwd(), "../sales-intelligence-ui-ux-workspace/evidence");

async function main() {
  const apply = flag("apply");
  if (apply) for (const name of ["RECEIVER_LATEST_WINS", "RECEIVER_ASSIGNMENT"] as const)
    if (!csiFlag(name)) throw new Error(`--apply requires SALES_INTELLIGENCE_${name}=true (and the deployed server running with it on)`);
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  const production = database === "vantagemovers";
  if (production && !flag("allow-production")) throw new Error("Refusing to run against the production database without --allow-production");
  if (apply) await assertProductionWriterMatchesDeployment();
  const env = production ? "production" : database;
  const manifestPath = arg("manifest") ?? `${OUT_DIR}/receiver-agent-backfill-${database}-${apply ? "apply" : "dry-run"}.json`;
  let manifest: ReceiverBackfillManifest | null = null;
  if (flag("resume")) {
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ReceiverBackfillManifest; } catch { manifest = null; }
    if (manifest && (manifest.version !== RECEIVER_BACKFILL_VERSION || manifest.database !== database || manifest.mode !== (apply ? "apply" : "dry_run"))) throw new Error(`manifest ${manifestPath} is for another run`);
  }
  manifest ??= newReceiverBackfillManifest(database, apply);
  const save = async (m: ReceiverBackfillManifest) => { await mkdir(dirname(manifestPath), { recursive: true }); await writeFile(`${manifestPath}.tmp`, JSON.stringify(m, null, 2)); await rename(`${manifestPath}.tmp`, manifestPath); };
  const log = jsonlLogger(manifestPath.replace(/\.json$/, "") + ".jsonl", manifest.run_id, line => { if (!line.includes('"event":"candidate"')) console.log(line); });
  const limit = arg("limit") ? Number(arg("limit")) : null;
  await runReceiverBackfill({ apply, limit, page: Number(arg("page") ?? 50) }, manifest, { save, log });
  const reportDir = arg("report-dir") ?? (existsSync(WORKSPACE_EVIDENCE) ? WORKSPACE_EVIDENCE : OUT_DIR);
  await mkdir(reportDir, { recursive: true });
  const report = join(reportDir, `S10-3-${env}${apply ? "-apply" : ""}.md`);
  await writeFile(report, receiverBackfillReport(manifest, env, { RECEIVER_LATEST_WINS: csiFlag("RECEIVER_LATEST_WINS"), RECEIVER_ASSIGNMENT: csiFlag("RECEIVER_ASSIGNMENT"),
    OUTREACH_ENSURE: csiFlag("OUTREACH_ENSURE") }) + `\nManifest \`${manifestPath}\`, JSONL \`${manifestPath.replace(/\.json$/, "")}.jsonl\`.\n`);
  console.log(JSON.stringify({ report, manifest: manifestPath, processed: manifest.processed, finished: manifest.finished_at !== null,
    jobs_total_before: manifest.jobs_before?.total ?? null, jobs_total_after: manifest.jobs_after?.total ?? null }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
