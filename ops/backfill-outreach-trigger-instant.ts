/**
 * S11-TIME (UI-1 §7, UX8): rebase Lead Outreach records' `trigger_at` (and the times derived from it) onto the real
 * arrival instant. Core, rules and what is rewritten: `ops/lib/backfill-outreach-trigger-instant.lib.ts`.
 *
 *   node --env-file=.env --import tsx ops/backfill-outreach-trigger-instant.ts --dry-run [--limit=N] [--page=200] [--report=path]
 *   node --env-file=.env --import tsx ops/backfill-outreach-trigger-instant.ts --apply --i-know-this-is-production    # operator, after the deploy
 *
 * Rules: dry run is the default and is read-only (it may run against production); `--apply` against the production
 * database (`vantagemovers`) refuses without `--i-know-this-is-production` and runs the production-writer drift guard
 * (`ops/lib/production-writer-guard.ts`: the local HEAD must be the deployed commit, with no uncommitted `src/`/`ops/`
 * change), so run it only after the S11-TIME server deploy, from that commit. An apply publishes the Attention snapshot
 * once at the end (`--no-publish` skips it; the minute publish picks the records up anyway). Idempotent: a re-run
 * finds rewritten records `unchanged`. Report: counts and distributions only (`--report`, default under `ops/output/`);
 * the apply also writes a JSONL of rewritten record ids under `ops/output/` (gitignored).
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { csiFlag } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { publishAttentionSnapshot } from "../src/services/salesIntelligence/outreach/attention";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";
import { newTriggerInstantReport, runTriggerInstantBackfill, triggerInstantReport } from "./lib/backfill-outreach-trigger-instant.lib";

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const OUT_DIR = "ops/output";
export const PRODUCTION_CONFIRM_FLAG = "--i-know-this-is-production";

async function main() {
  const apply = flag("apply");
  if (apply && flag("dry-run")) throw new Error("Pass --dry-run or --apply, not both");
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  const production = database === "vantagemovers";
  if (apply && production) {
    if (!process.argv.includes(PRODUCTION_CONFIRM_FLAG)) throw new Error(`Refusing to --apply against the production database without ${PRODUCTION_CONFIRM_FLAG}`);
    await assertProductionWriterMatchesDeployment();
  }
  const env = production ? "production" : database;
  const mode = apply ? "apply" : "dry-run";
  const jsonl = `${OUT_DIR}/outreach-trigger-instant-${database}-${mode}.jsonl`;
  if (apply) await mkdir(OUT_DIR, { recursive: true });
  const report = newTriggerInstantReport(database, apply);
  await runTriggerInstantBackfill({ apply, limit: arg("limit") ? Number(arg("limit")) : null, page: Number(arg("page") ?? 200) }, report, {
    log: async (event, fields = {}) => {
      const line = JSON.stringify({ at: new Date().toISOString(), run_id: report.run_id, event, ...fields });
      if (apply) await appendFile(jsonl, line + "\n");
      if (event !== "rewritten") console.log(line);
    },
  });
  let published: unknown = null;
  if (apply && report.written > 0 && !flag("no-publish")) published = await publishAttentionSnapshot({ deadlineMs: 300_000 });
  const flags = ["ATTENTION_EVOLUTION", "ATTENTION_V2", "OVERVIEW", "OUTREACH_ENSURE"] as const;
  const path = arg("report") ?? `${OUT_DIR}/outreach-trigger-instant-${database}-${mode}.md`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, triggerInstantReport(report, env, [
    `- Process flags: ${flags.map(name => `${name}=${csiFlag(name)}`).join(", ")}`,
    ...(apply ? [`- Attention publish after the apply: ${published ? JSON.stringify({ status: (published as { status?: string }).status ?? null }) : "not run"}`, `- JSONL: \`${jsonl}\``] : []),
  ]) + "\n");
  console.log(JSON.stringify({ report: path, mode, processed: report.processed, outcomes: report.outcomes, written: report.written }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
