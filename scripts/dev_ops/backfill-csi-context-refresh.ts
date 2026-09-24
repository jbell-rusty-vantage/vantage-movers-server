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
 *     [--layout story|case_file]
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/backfill-csi-context-refresh.ts --layout case_file --estimate [--limit N] [--allow-production] [--json <path>]
 *
 * `--layout case_file` (Attention and Case File spec §10 AC7-BACKFILL): the refresh runs with
 * `SALES_INTELLIGENCE_CASE_FILE=true` in this process only, so each run records the Case File layout,
 * the findings `sales_intelligence_analyze_v5` and summary `csi-summary-v3` versions. v3 misses the
 * v2 summary cache, so every conversation a run touches is re-summarized (§4.12).
 * `--estimate` is free and read-only: it needs no gateway key, never writes a manifest or any row, and
 * prints the cohort size, the re-summaries and a projected cost from the stored token counts of each
 * conversation's current summary (its reservation), falling back to the transcript length.
 *
 * Manifests carry identifiers and operational outcomes only, never transcript or summary text.
 */
const ESTIMATE_ONLY = process.argv.includes("--estimate");
const CASE_FILE_LAYOUT = (() => { const at = process.argv.indexOf("--layout"); return at >= 0 && process.argv[at + 1] === "case_file"; })();
// Imported by a test (not the entry point) or `--estimate`: no gateway key, no environment changes.
if (require.main === module && !ESTIMATE_ONLY) {
  const personal = process.env.PERSONAL_AI_GATEWAY_API_KEY?.trim() ?? "";
  if (!personal) { console.error(JSON.stringify({ refused: "PERSONAL_AI_GATEWAY_API_KEY is missing or empty" })); process.exit(2); }
  process.env.AI_GATEWAY_API_KEY = personal;
  // Personal-key spend is recorded per run but never reserved against or added to the Owner's monthly ceiling.
  process.env.SALES_INTELLIGENCE_PERSONAL_LEDGER = "true";
  process.env.SALES_INTELLIGENCE_EXTRACTION_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ??= "openai/gpt-5.6-luna";
  process.env.SALES_INTELLIGENCE_ANALYSIS_V3 ??= "true";
  // The layout is read once per run at prepare time (spec §4.11); this process prepares Case File runs only.
  if (CASE_FILE_LAYOUT) process.env.SALES_INTELLIGENCE_CASE_FILE = "true";
}

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
import { getSalesIntelligenceAiReservationModel } from "../../src/models/SalesIntelligenceAiReservation";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getMoveAssessmentArtifactModel } from "../../src/models/MoveAssessmentArtifact";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { CsiError } from "../../src/services/salesIntelligence/auth";
import { runIntelligenceJob } from "../../src/services/salesIntelligence/analysis/worker";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";
import { STRUCTURED_PIPELINE, FINDINGS_PROMPT_VERSION, SUMMARY_PROMPT_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION, CASE_FILE_SUMMARY_PROMPT_VERSION }
  from "../../src/services/salesIntelligence/analysis/structuredPrompt";
import { continueStructuredAnalysis, runBoundedBackfill, waitForBackfillPeer } from "../backfill-csi-structured-analysis.lib";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";

/** Spec §4.11/§4.12: the versions a Case File run records (flag off keeps v4 / v2), as the runtime records them. */
export { CASE_FILE_FINDINGS_PROMPT_VERSION, CASE_FILE_SUMMARY_PROMPT_VERSION };
const LAYOUT_FINDINGS_VERSION = CASE_FILE_LAYOUT ? CASE_FILE_FINDINGS_PROMPT_VERSION : FINDINGS_PROMPT_VERSION;
const DEDUPE_PREFIX = CASE_FILE_LAYOUT ? "csi:number-analysis:case-file-refresh:" : "csi:number-analysis:context-refresh:";
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

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
async function selectCohort(limit: number, promptVersion = LAYOUT_FINDINGS_VERSION, model = process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ?? DEFAULT_MODEL): Promise<Manifest> {
  const cutoff = new Date();
  const dataset = csiDataset();
  const rows = await getLeadConversationModel().find({ "analysis_eligibility.status": "eligible", latest_transcript_version: { $type: "string" }, content_purged_at: null, contact_number_id: { $ne: null } })
    .select("contact_number_id started_at").sort({ started_at: 1, _id: 1 }).lean();
  const byNumber = new Map<string, number>();
  for (const row of rows) byNumber.set(String(row.contact_number_id), (byNumber.get(String(row.contact_number_id)) ?? 0) + 1);
  const manifest: Manifest = { version: "csi-context-refresh-v1", cutoff: cutoff.toISOString(), model,
    prompt_version: promptVersion, dataset, entries: [] };
  for (const [numberId, conversations] of byNumber) {
    const number = await getContactNumberModel().findById(numberId).select("purged_at content_purge_pending kind classification").lean();
    const summarized = await getIntelligenceEvidenceSnapshotModel().countDocuments({ ...dataset, source_type: "summary", artifact_key: { $type: "string" }, purged_at: null,
      conversation_id: { $in: rows.filter(r => String(r.contact_number_id) === numberId).map(r => r._id) } });
    const priors = await getIntelligenceRunModel().find({ ...dataset, subject_key: `number:${numberId}` }).select("status analysis_pipeline prompt_version").sort({ _id: -1 }).limit(5).lean();
    const skip = !number || number.purged_at || number.content_purge_pending ? "number_unavailable"
      : number.kind !== "external" || ["company", "non_customer"].includes(number.classification) ? "number_excluded"
      : !summarized ? "no_retained_summary"
      : priors.some(r => r.prompt_version === promptVersion && ["completed", "submitted", "running"].includes(r.status)) ? "already_current" : null;
    manifest.entries.push({ number_id: numberId, conversations, summarized, prior_runs: priors.map(r => `${r.status}:${r.prompt_version ?? "legacy"}`),
      state: skip ? "skipped" : "selected", ...(skip ? { reason: skip } : {}) });
    if (manifest.entries.filter(e => e.state === "selected").length >= limit) break;
  }
  return manifestSchema.parse(manifest);
}

/** Same cache key as `structuredRuntime.ts` (summary step): dataset, conversation, transcript version, prompt, model. */
export const summaryCacheKey = (conversationId: string, transcriptVersion: string, prompt: string, model: string) =>
  payloadHash({ ...csiDataset(), conversation_id: conversationId, transcript_version: transcriptVersion, prompt, model });

/** Summary system prompt + call header + binding: the non-transcript part of a summary input, in tokens (fallback path only). */
const SUMMARY_OVERHEAD_TOKENS = 2_500;
const CHARS_PER_TOKEN = 4;

export type CaseFileBackfillEstimate = {
  mode: "estimate"; layout: "case_file"; database: string; model: string;
  findings_prompt_version: string; summary_prompt_version: string; summary_cache_prompt_version_now: string;
  cohort: { numbers_selected: number; numbers_skipped: Record<string, number>; truncated: boolean };
  summaries: { conversations: number; re_summaries: number; v3_cache_hits: number; from_reservation: number; from_transcript_length: number; unknown: number;
    input_tokens: number; output_tokens: number };
  findings: { numbers: number; from_reservation: number; defaulted: number; input_tokens: number; output_tokens: number };
  /** V-AC N4: Move assessment re-runs the refresh triggers (each run nominates the Number's open records; v2 + the new digest miss every artifact). */
  assessments: { subjects: number; skipped_identity_review: number; from_artifact: number; defaulted: number; input_tokens: number; output_tokens: number; billed_to: string };
  pricing: { source: "env" | "reservation" | "none"; input_cents_per_million: number | null; output_cents_per_million: number | null };
  projected_cents: { summaries: number; findings: number; assessments: number; total: number; conservative_total: number };
  notes: string[];
};

type Pricing = { input_cents_per_million: number; output_cents_per_million: number };
async function resolvePricing(model: string): Promise<{ source: "env" | "reservation" | "none"; pricing: Pricing | null }> {
  const input = Number(process.env.SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION), output = Number(process.env.SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION);
  if (input > 0 && output > 0) return { source: "env", pricing: { input_cents_per_million: input, output_cents_per_million: output } };
  const row = await getSalesIntelligenceAiReservationModel().findOne({ stage: "analysis", model_version: model, pricing_snapshot: { $ne: null } })
    .sort({ _id: -1 }).select("pricing_snapshot").lean();
  const snapshot = row?.pricing_snapshot as Partial<Pricing> | null | undefined;
  return snapshot?.input_cents_per_million && snapshot.output_cents_per_million
    ? { source: "reservation", pricing: { input_cents_per_million: snapshot.input_cents_per_million, output_cents_per_million: snapshot.output_cents_per_million } }
    : { source: "none", pricing: null };
}
const cents = (pricing: Pricing | null, input: number, output: number) =>
  pricing ? (input * pricing.input_cents_per_million + output * pricing.output_cents_per_million) / 1_000_000 : 0;

/**
 * AC7-BACKFILL `--estimate`: reads only. For every cohort Number, every eligible conversation is a
 * re-summary under `csi-summary-v3` unless its v3 cache entry already exists; its token count comes
 * from the reservation of its current (v2) summary, the same transcript, else from the transcript
 * length. The findings step uses the Number's newest findings reservation (the Case File replaces the
 * story/prior/calls blocks, spec F7: similar size), with a conservative ×1.5 total.
 */
export async function estimateCaseFileBackfill(options: { limit: number; model?: string; log?: (line: string) => void }): Promise<CaseFileBackfillEstimate> {
  const model = options.model ?? process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ?? DEFAULT_MODEL;
  const dataset = csiDataset();
  const cohort = await selectCohort(options.limit, CASE_FILE_FINDINGS_PROMPT_VERSION, model);
  const selected = cohort.entries.filter(e => e.state === "selected");
  const skipped: Record<string, number> = {};
  for (const e of cohort.entries) if (e.state === "skipped") skipped[e.reason ?? "unknown"] = (skipped[e.reason ?? "unknown"] ?? 0) + 1;
  const { source, pricing } = await resolvePricing(model);
  const Reservations = getSalesIntelligenceAiReservationModel();
  const summaries = { conversations: 0, re_summaries: 0, v3_cache_hits: 0, from_reservation: 0, from_transcript_length: 0, unknown: 0, input_tokens: 0, output_tokens: 0 };
  const findings = { numbers: 0, from_reservation: 0, defaulted: 0, input_tokens: 0, output_tokens: 0 };
  const assessments = { subjects: 0, skipped_identity_review: 0, from_artifact: 0, defaulted: 0, input_tokens: 0, output_tokens: 0,
    billed_to: "company key and the Owner's monthly ceiling: the move_assessment jobs the runs nominate are drained by the production worker" };
  const assessmentSamples: Array<{ input: number; output: number }> = [];
  let pendingAssessments = 0;
  const summaryOutputs: number[] = [], findingsSamples: Array<{ input: number; output: number }> = [];
  const pendingFallback: number[] = [];
  let pendingFindings = 0;
  for (const entry of selected) {
    const conversations = await getLeadConversationModel().find({ contact_number_id: entry.number_id, "analysis_eligibility.status": "eligible",
      latest_transcript_version: { $type: "string" }, content_purged_at: null }).select("_id latest_transcript_version").sort({ _id: 1 }).limit(101).lean();
    for (const conversation of conversations) {
      summaries.conversations++;
      const id = String(conversation._id), version = String(conversation.latest_transcript_version);
      if (await getIntelligenceEvidenceSnapshotModel().exists({ artifact_key: summaryCacheKey(id, version, CASE_FILE_SUMMARY_PROMPT_VERSION, model), ...dataset })) {
        summaries.v3_cache_hits++; continue;
      }
      summaries.re_summaries++;
      const v2 = summaryCacheKey(id, version, SUMMARY_PROMPT_VERSION, model);
      const reservation = await Reservations.findOne({ stage: "analysis", step: { $regex: `^summary:${v2}:` }, observed_steps: { $gt: 0 } })
        .sort({ _id: -1 }).select("input_tokens output_tokens").lean();
      if (reservation && reservation.input_tokens > 0) {
        summaries.from_reservation++; summaries.input_tokens += reservation.input_tokens; summaries.output_tokens += reservation.output_tokens;
        summaryOutputs.push(reservation.output_tokens);
        continue;
      }
      const transcript = await getIntelligenceEvidenceSnapshotModel().findOne({ ...dataset, source_type: "transcript", conversation_id: conversation._id,
        transcript_version: version, purged_at: null }).select("segments.text").lean();
      if (!transcript) { summaries.unknown++; continue; }
      const chars = (transcript.segments ?? []).reduce((n, s) => n + String(s.text ?? "").length, 0);
      summaries.from_transcript_length++;
      summaries.input_tokens += Math.ceil(chars / CHARS_PER_TOKEN) + SUMMARY_OVERHEAD_TOKENS;
      pendingFallback.push(1);
    }
    findings.numbers++;
    const runs = await getIntelligenceRunModel().find({ ...dataset, subject_key: `number:${entry.number_id}`, analysis_pipeline: STRUCTURED_PIPELINE })
      .select("_id").sort({ _id: -1 }).limit(5).lean();
    const reservation = runs.length ? await Reservations.findOne({ run_id: { $in: runs.map(r => r._id) }, step: { $regex: "^findings:" }, observed_steps: { $gt: 0 } })
      .sort({ _id: -1 }).select("input_tokens output_tokens").lean() : null;
    if (reservation && reservation.input_tokens > 0) {
      findings.from_reservation++; findings.input_tokens += reservation.input_tokens; findings.output_tokens += reservation.output_tokens;
      findingsSamples.push({ input: reservation.input_tokens, output: reservation.output_tokens });
    } else pendingFindings++;
    // V-AC N4: `nominateMoveAssessmentForNumber` nominates every non-closed record on the Number (≤ 50) at the summary
    // checkpoint; with the flag on the v2 contract and the new customer-evidence digest miss every stored artifact,
    // so each assessable subject regenerates once. Tokens: the subject's newest generated artifact, else the median.
    const records = await getOutreachRecordModel().find({ primary_contact_number_id: entry.number_id, state: { $ne: "closed" } }).select({ _id: 1, state: 1 }).sort({ _id: 1 }).limit(50).lean();
    for (const record of records) {
      if (record.state === "identity_review") { assessments.skipped_identity_review++; continue; }
      assessments.subjects++;
      const artifact = await getMoveAssessmentArtifactModel().findOne({ ...dataset, outreach_record_id: record._id, shadow: false, "usage.input_tokens": { $gt: 0 } })
        .sort({ _id: -1 }).select({ usage: 1 }).lean();
      const usage = artifact?.usage as { input_tokens?: number; output_tokens?: number } | null | undefined;
      if (usage?.input_tokens) {
        assessments.from_artifact++; assessments.input_tokens += usage.input_tokens; assessments.output_tokens += usage.output_tokens ?? 0;
        assessmentSamples.push({ input: usage.input_tokens, output: usage.output_tokens ?? 0 });
      } else pendingAssessments++;
    }
    options.log?.(JSON.stringify({ progress: findings.numbers, of: selected.length }));
  }
  // Fallback rows take the median observed output (summaries) or the median observed findings call.
  const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  summaries.output_tokens += pendingFallback.length * median(summaryOutputs);
  if (pendingFindings) {
    const input = median(findingsSamples.map(s => s.input)), output = median(findingsSamples.map(s => s.output));
    findings.defaulted = pendingFindings; findings.input_tokens += pendingFindings * input; findings.output_tokens += pendingFindings * output;
  }
  if (pendingAssessments) {
    const input = median(assessmentSamples.map(s => s.input)), output = median(assessmentSamples.map(s => s.output));
    assessments.defaulted = pendingAssessments; assessments.input_tokens += pendingAssessments * input; assessments.output_tokens += pendingAssessments * output;
  }
  const summaryCents = cents(pricing, summaries.input_tokens, summaries.output_tokens), findingsCents = cents(pricing, findings.input_tokens, findings.output_tokens);
  const assessmentCents = cents(pricing, assessments.input_tokens, assessments.output_tokens);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    mode: "estimate", layout: "case_file", database: getMongoDatabaseName(), model,
    findings_prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION, summary_prompt_version: CASE_FILE_SUMMARY_PROMPT_VERSION, summary_cache_prompt_version_now: SUMMARY_PROMPT_VERSION,
    cohort: { numbers_selected: selected.length, numbers_skipped: skipped, truncated: selected.length >= options.limit },
    summaries, findings, assessments,
    pricing: { source, input_cents_per_million: pricing?.input_cents_per_million ?? null, output_cents_per_million: pricing?.output_cents_per_million ?? null },
    projected_cents: { summaries: round(summaryCents), findings: round(findingsCents), assessments: round(assessmentCents), total: round(summaryCents + findingsCents + assessmentCents),
      conservative_total: round(summaryCents * 1.1 + findingsCents * 1.5 + assessmentCents * 1.5) },
    notes: [
      "Token counts are the provider-reported usage of each conversation's current summary / the Number's newest findings call; list-price cents, cache discounts ignored.",
      "conservative_total: summaries x1.1 (call header + Vantage-side clause), findings and assessments x1.5 (Case File up to the 60 KB soft budget).",
      "Assessments run only with SALES_INTELLIGENCE_MOVE_ASSESSMENT on; they are billed to the company key and count against the Owner's monthly ceiling, not the personal ledger.",
      "Runs that fail validation and repair once are not included (see schema_failures on recent runs).",
    ],
  };
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
  if (ESTIMATE_ONLY) {
    if (!CASE_FILE_LAYOUT) throw new Error("--estimate is implemented for --layout case_file");
    const estimate = await estimateCaseFileBackfill({ limit, log: line => console.error(line) });
    console.log(JSON.stringify(estimate, null, 1));
    const out = option("--json");
    if (out) await writeFile(resolve(out), JSON.stringify(estimate, null, 1) + "\n");
    return;
  }
  // CC-00 §5.2: production data is only written by the deployed build (override: --allow-schema-drift).
  await assertProductionWriterMatchesDeployment();
  let manifest: Manifest;
  try { manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    manifest = await selectCohort(limit);
  }
  if (JSON.stringify(manifest.dataset) !== JSON.stringify(csiDataset())) throw new Error("Manifest dataset differs from this database");
  if (manifest.prompt_version !== LAYOUT_FINDINGS_VERSION) throw new Error(`Manifest was selected for ${manifest.prompt_version}; this build is ${LAYOUT_FINDINGS_VERSION}`);
  await save(path, manifest);
  const confirm = process.argv.includes("--confirm-write");
  const count = (state: string) => manifest.entries.filter(e => e.state === state).length;
  console.log(JSON.stringify({ mode: confirm ? "apply" : "dry_run", layout: CASE_FILE_LAYOUT ? "case_file" : "story", cutoff: manifest.cutoff, model: manifest.model, prompt_version: manifest.prompt_version, database, credential: "PERSONAL_AI_GATEWAY_API_KEY",
    selected: count("selected"), skipped: count("skipped"), completed: count("completed"), failed: count("failed"), manifest: path, concurrency }));
  if (!confirm) return;
  const Jobs = getSalesIntelligenceJobModel(), Runs = getIntelligenceRunModel();
  const cutoffKey = manifest.cutoff.slice(0, 10);
  await runBoundedBackfill(manifest.entries.filter(e => ["selected", "queued", "failed"].includes(e.state)), concurrency, async (entry, stop) => {
    try {
      if (!entry.job_id) {
        const job = await withTransaction(session => enqueueCsiJob({ stage: "number_refresh", subject_key: `number:${entry.number_id}`,
          dedupe_key: `${DEDUPE_PREFIX}${entry.number_id}:${cutoffKey}`, input_revision: 1,
          input_refs: [entry.number_id], priority: CSI_BACKFILL_JOB_PRIORITY }, session));
        entry.job_id = String(job._id); entry.state = "queued";
        await save(path, manifest);
      }
      if (entry.state === "failed") await Jobs.updateOne({ _id: entry.job_id, dedupe_key: { $regex: `^${DEDUPE_PREFIX}` }, status: { $in: ["paused", "retry"] } },
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

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ stopped: true, error: error instanceof CsiError ? error.code : error instanceof Error ? error.message.slice(0, 120) : "setup_failed" }));
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
