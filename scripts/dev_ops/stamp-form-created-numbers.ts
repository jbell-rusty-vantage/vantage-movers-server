/**
 * S10 step 1, second half (reconciliation addendum §3.5, §5): stamp `created_via: "form_lead"` on the
 * Contact Numbers the Form Lead Contact Numbers backfill and the live `attachment-lead:` job already
 * created. Run it after `backfill-form-lead-contact-numbers.ts` has finished (Numbers created after
 * this code is deployed carry the field from `ensureFormLeadContactNumber`). Logic and bases:
 * `lib/stamp-form-created-numbers.ts`.
 *
 * Dry run (default; reads only, reports the match counts by basis):
 *   node --env-file=.env --import tsx scripts/dev_ops/stamp-form-created-numbers.ts --allow-production
 * Apply (from the deployed commit; drift guard):
 *   node --env-file=.env --import tsx scripts/dev_ops/stamp-form-created-numbers.ts --apply --allow-production [--resume]
 * Options: `--include-fallback` (also stamp the zero-call, Form-Lead-edge, no-audit basis),
 * `--limit=N`, `--report <path>` (default `../sales-intelligence-ui-ux-workspace/evidence/S10-1-<env>.md`).
 *
 * Resumable: apply writes `scripts/dev_ops/output/stamp-form-created-numbers.checkpoint.json` after
 * every page; `--resume` continues after its `after` id. Re-running without `--resume` is also safe
 * (already-stamped rows are counted, not rewritten). JSONL log next to the checkpoint.
 * Zero model calls and zero jobs: the job table is counted before and after. Off production the run
 * fails if any job was created; on production (live crons run) it fails if a new job names a stamped Number.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";
import { renderStampReport, runStampFormCreatedNumbers } from "./lib/stamp-form-created-numbers";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const OUT_DIR = "scripts/dev_ops/output";

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  const apply = flag("apply");
  await connectMongo();
  const database = getMongoDatabaseName();
  const production = database === "vantagemovers";
  if (production && !flag("allow-production")) throw new Error("Refusing to run against production without --allow-production");
  // CC-00 §5.2: only the deployed build writes production. The dry run writes nothing.
  if (apply) await assertProductionWriterMatchesDeployment();
  const env = production ? "production" : "replica";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const limit = option("limit") ? Number(option("limit")) : undefined;
  const result = await runStampFormCreatedNumbers({
    database, apply, includeFallback: flag("include-fallback"), resume: flag("resume"),
    checkpointPath: `${OUT_DIR}/stamp-form-created-numbers${production ? "" : `-${database}`}.checkpoint.json`,
    jsonlPath: `${OUT_DIR}/stamp-form-created-numbers-${apply ? "apply" : "dry"}-${stamp}.jsonl`,
    ...(limit !== undefined ? { limit } : {}),
    log: (line) => console.log(line),
  });
  const evidenceDir = resolve("../sales-intelligence-ui-ux-workspace/evidence");
  const report = resolve(option("report") ?? (existsSync(evidenceDir) ? `${evidenceDir}/S10-1-${env}.md` : `${OUT_DIR}/S10-1-${env}.md`));
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, renderStampReport(result, env, `stamp-form-created-numbers.ts ${argv.join(" ")}`));
  console.log(JSON.stringify({ phase: "finished", report, ...result }, null, 2));
  // Off production nothing else runs, so any new job is this script's. On production the live crons
  // keep creating jobs; the proof there is that none names a stamped Number.
  if (result.jobs.touching_stamped !== 0 || (!production && result.jobs.created_during_run !== 0)) {
    throw new Error(`jobs were created by the run (${JSON.stringify(result.jobs)})`);
  }
}

main().then(() => mongoose.disconnect()).then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
