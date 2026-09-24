/**
 * Context-provenance refresh: one new number synthesis per Contact Number that already has
 * retained conversation summaries, so its findings, prior-finding relations and running summary
 * are produced with the Subject Story, Granot state and Prior Analysis pages (spec CP-06).
 * Summaries are cached per transcript version and are not re-generated; only the findings step
 * is billed. Uses the normal analysis job path in-process (`runIntelligenceJob`, number_refresh,
 * structured pipeline) with the operator's PERSONAL_AI_GATEWAY_API_KEY for this process only.
 * Application intents (publication, supersede links, review items) are left to the production
 * apply cron, exactly like the unsummarized backfill.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/backfill-csi-context-refresh.ts \
 *     --manifest scripts/dev_ops/output/<file>.json [--limit N] [--concurrency 1..4] [--allow-production] [--confirm-write] [--allow-schema-drift]
 *
 * Manifests carry identifiers and operational outcomes only, never transcript or summary text.
 */
const personal = process.env.PERSONAL_AI_GATEWAY_API_KEY?.trim() ?? "";
if (!personal) { console.error(JSON.stringify({ refused: "PERSONAL_AI_GATEWAY_API_KEY is missing or empty" })); process.exit(2); }
process.env.AI_GATEWAY_API_KEY = personal;
// Personal-key spend is recorded per run but never reserved against or added to the Owner's monthly ceiling.
process.env.SALES_INTELLIGENCE_PERSONAL_LEDGER = "true";
process.env.SALES_INTELLIGENCE_EXTRACTION_ENABLED = "true";
process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ??= "openai/gpt-5.6-luna";
process.env.SALES_INTELLIGENCE_ANALYSIS_V3 ??= "true";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo, withTransaction } from "../../src/db";
import { csiDataset, CSI_BACKFILL_JOB_PRIORITY } from "../../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceEvidenceSnapshotModel } from "../../src/models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { CsiError } from "../../src/services/salesIntelligence/auth";
import { runIntelligenceJob } from "../../src/services/salesIntelligence/analysis/worker";
import { STRUCTURED_PIPELINE, FINDINGS_PROMPT_VERSION } from "../../src/services/salesIntelligence/analysis/structuredPrompt";
import { continueStructuredAnalysis, runBoundedBackfill, waitForBackfillPeer } from "../backfill-csi-structured-analysis.lib";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";

const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const entrySchema = z.object({
  number_id: idSchema, conversations: z.number().int().nonnegative(), summarized: z.number().int().nonnegative(),
  prior_runs: z.array(z.string()), job_id: idSchema.optional(), run_id: idSchema.optional(),
  state: z.enum(["selected", "queued", "completed", "skipped", "failed"]), reason: z.string().optional(),
  analysis_status: z.string().optional(), run_status: z.string().optional(), story_events: z.number().nullable().optional(),
  prior_findings: z.number().nullable().optional(), relations: z.number().nullable().optional(), discrepancies: z.number().nullable().optional(),
  actual_cents: z.number().nullable().optional(), usage_complete: z.boolean().optional(),
});
const manifestSchema = z.object({ version: z.literal("csi-context-refresh-v1"), cutoff: z.string().datetime(), model: z.string(), prompt_version: z.string(),
  dataset: z.object({ deployment: z.string(), database: z.string() }), entries: z.array(entrySchema) });
type Manifest = z.infer<typeof manifestSchema>;

function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}
let pendingSave = Promise.resolve();
function save(path: string, manifest: Manifest) {
  const contents = JSON.stringify(manifest, null, 2) + "\n";
  pendingSave = pendingSave.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, contents);
    await rename(temporary, path);
  });
  return pendingSave;
}
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

/** Every Number with at least one eligible, retained-summary conversation, oldest activity first. */
async function selectCohort(limit: number): Promise<Manifest> {
  const cutoff = new Date();
  const dataset = csiDataset();
  const rows = await getLeadConversationModel().find({ "analysis_eligibility.status": "eligible", latest_transcript_version: { $type: "string" }, content_purged_at: null, contact_number_id: { $ne: null } })
    .select("contact_number_id started_at").sort({ started_at: 1, _id: 1 }).lean();
  const byNumber = new Map<string, number>();
  for (const row of rows) byNumber.set(String(row.contact_number_id), (byNumber.get(String(row.contact_number_id)) ?? 0) + 1);
  const manifest: Manifest = { version: "csi-context-refresh-v1", cutoff: cutoff.toISOString(), model: process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL!,
    prompt_version: FINDINGS_PROMPT_VERSION, dataset, entries: [] };
  for (const [numberId, conversations] of byNumber) {
    const number = await getContactNumberModel().findById(numberId).select("purged_at content_purge_pending kind classification").lean();
    const summarized = await getIntelligenceEvidenceSnapshotModel().countDocuments({ ...dataset, source_type: "summary", artifact_key: { $type: "string" }, purged_at: null,
      conversation_id: { $in: rows.filter(r => String(r.contact_number_id) === numberId).map(r => r._id) } });
    const priors = await getIntelligenceRunModel().find({ ...dataset, subject_key: `number:${numberId}` }).select("status analysis_pipeline prompt_version").sort({ _id: -1 }).limit(5).lean();
    const skip = !number || number.purged_at || number.content_purge_pending ? "number_unavailable"
      : number.kind !== "external" || ["company", "non_customer"].includes(number.classification) ? "number_excluded"
      : !summarized ? "no_retained_summary"
      : priors.some(r => r.prompt_version === FINDINGS_PROMPT_VERSION && ["completed", "submitted", "running"].includes(r.status)) ? "already_current" : null;
    manifest.entries.push({ number_id: numberId, conversations, summarized, prior_runs: priors.map(r => `${r.status}:${r.prompt_version ?? "legacy"}`),
      state: skip ? "skipped" : "selected", ...(skip ? { reason: skip } : {}) });
    if (manifest.entries.filter(e => e.state === "selected").length >= limit) break;
  }
  return manifestSchema.parse(manifest);
}

async function main() {
  const path = resolve(option("--manifest") ?? "scripts/dev_ops/output/csi-context-refresh.json");
  const concurrency = Number(option("--concurrency") ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("--concurrency must be 1..4");
  const limit = Number(option("--limit") ?? Number.MAX_SAFE_INTEGER);
  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !process.argv.includes("--allow-production"))
    throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production to proceed");
  // CC-00 §5.2: production data is only written by the deployed build (override: --allow-schema-drift).
  await assertProductionWriterMatchesDeployment();
  let manifest: Manifest;
  try { manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    manifest = await selectCohort(limit);
  }
  if (JSON.stringify(manifest.dataset) !== JSON.stringify(csiDataset())) throw new Error("Manifest dataset differs from this database");
  if (manifest.prompt_version !== FINDINGS_PROMPT_VERSION) throw new Error(`Manifest was selected for ${manifest.prompt_version}; this build is ${FINDINGS_PROMPT_VERSION}`);
  await save(path, manifest);
  const confirm = process.argv.includes("--confirm-write");
  const count = (state: string) => manifest.entries.filter(e => e.state === state).length;
  console.log(JSON.stringify({ mode: confirm ? "apply" : "dry_run", cutoff: manifest.cutoff, model: manifest.model, prompt_version: manifest.prompt_version, database, credential: "PERSONAL_AI_GATEWAY_API_KEY",
    selected: count("selected"), skipped: count("skipped"), completed: count("completed"), failed: count("failed"), manifest: path, concurrency }));
  if (!confirm) return;
  const Jobs = getSalesIntelligenceJobModel(), Runs = getIntelligenceRunModel();
  const cutoffKey = manifest.cutoff.slice(0, 10);
  await runBoundedBackfill(manifest.entries.filter(e => ["selected", "queued", "failed"].includes(e.state)), concurrency, async (entry, stop) => {
    try {
      if (!entry.job_id) {
        const job = await withTransaction(session => enqueueCsiJob({ stage: "number_refresh", subject_key: `number:${entry.number_id}`,
          dedupe_key: `csi:number-analysis:context-refresh:${entry.number_id}:${cutoffKey}`, input_revision: 1,
          input_refs: [entry.number_id], priority: CSI_BACKFILL_JOB_PRIORITY }, session));
        entry.job_id = String(job._id); entry.state = "queued";
        await save(path, manifest);
      }
      if (entry.state === "failed") await Jobs.updateOne({ _id: entry.job_id, dedupe_key: { $regex: "^csi:number-analysis:context-refresh:" }, status: { $in: ["paused", "retry"] } },
        { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
      const analysis = await continueStructuredAnalysis(() => runIntelligenceJob(entry.job_id, "number_refresh", { historical: true, publish: async () => ({ published: false, error_code: null }) }),
        () => Jobs.findById(entry.job_id).select("status next_attempt_at result").lean().exec());
      entry.analysis_status = analysis.status;
      if (analysis.status === "not_claimable") await waitForBackfillPeer(() => Jobs.findById(entry.job_id).select("status leased_until").lean().exec(), sleep);
      const run = await Runs.findOne({ job_id: entry.job_id }).lean();
      entry.run_id = run ? String(run._id) : undefined;
      entry.run_status = run?.status;
      entry.actual_cents = run?.usage?.actual_cents ?? null;
      entry.usage_complete = run?.usage?.usage_complete ?? false;
      const artifacts = run?.step_artifacts as { lineage?: { story_events?: number; prior_finding_ids?: string[] } } | null;
      entry.story_events = artifacts?.lineage?.story_events ?? null;
      entry.prior_findings = artifacts?.lineage?.prior_finding_ids?.length ?? null;
      const output = run?.output as { prior_finding_relations?: unknown[]; story_discrepancies?: unknown[] } | null;
      entry.relations = output?.prior_finding_relations?.length ?? null;
      entry.discrepancies = output?.story_discrepancies?.length ?? null;
      const job = await Jobs.findById(entry.job_id).select("status reason result").lean();
      if (!run || run.analysis_pipeline !== STRUCTURED_PIPELINE || !["submitted", "completed"].includes(run.status)) {
        entry.state = "failed"; entry.reason = `${analysis.status}:${analysis.reason ?? job?.reason ?? run?.status ?? "no_run"}`;
        await save(path, manifest);
        console.error(JSON.stringify(entry));
        const reason = String(analysis.reason ?? (job?.result as { reason?: string } | null)?.reason ?? "");
        if (analysis.status === "disabled" || ["analysis_configuration_missing", "budget_exhausted"].includes(reason)) { stop(); return false; }
        return true;
      }
      entry.state = "completed"; delete entry.reason;
      await save(path, manifest);
      console.log(JSON.stringify(entry));
    } catch (error) {
      stop();
      entry.state = "failed";
      entry.reason = error instanceof CsiError ? error.code : error instanceof Error ? error.message.slice(0, 80) : "unknown_error";
      await save(path, manifest);
      console.error(JSON.stringify({ ...entry, stopped: true }));
      process.exitCode = 1;
      return false;
    }
    return true;
  });
  console.log(JSON.stringify({ completed: count("completed"), failed: count("failed"), skipped: count("skipped"),
    actual_cents: manifest.entries.reduce((sum, e) => sum + (e.actual_cents ?? 0), 0),
    story_events: manifest.entries.reduce((sum, e) => sum + (e.story_events ?? 0), 0), relations: manifest.entries.reduce((sum, e) => sum + (e.relations ?? 0), 0),
    usage_complete: manifest.entries.filter(e => e.state === "completed").every(e => e.usage_complete === true) }));
}

main().catch(error => {
  console.error(JSON.stringify({ stopped: true, error: error instanceof CsiError ? error.code : error instanceof Error ? error.message.slice(0, 120) : "setup_failed" }));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
