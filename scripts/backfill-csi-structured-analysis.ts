/**
 * Retained summary replay through the supported Owner reanalysis command.
 * Dry-run: node --env-file=.env --import tsx scripts/backfill-csi-structured-analysis.ts --manifest <file>
 * Shadow: add --shadow --confirm-write (use a separate manifest from application runs).
 * Apply: add --confirm-write. --limit N / --conversation-id ID pin a canary cohort; --concurrency 1..4 defaults to 1.
 * Manifests contain identifiers and operational outcomes, never transcript or summary text.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../src/db";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { requireCsiOwner, CsiError } from "../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { commandAnalysis } from "../src/services/salesIntelligence/analysis/ownerCommands";
import { runIntelligenceJob } from "../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../src/services/salesIntelligence/analysis/apply";
import { continueStructuredAnalysis, runBoundedBackfill, waitForBackfillPeer } from "./backfill-csi-structured-analysis.lib";

class BackfillError extends Error {}
const pipeline = "csi-analysis-steps-v1";
const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const entrySchema = z.object({
  conversation_id: idSchema, source_run_id: idSchema, source_revision: z.number().int().positive(),
  transcript_snapshot_id: idSchema, transcript_version: z.string(), idempotency_key: z.string(),
  job_id: idSchema.optional(), run_id: idSchema.optional(),
  state: z.enum(["selected", "queued", "submitted", "completed", "shadow_complete", "skipped", "failed"]),
  reason: z.string().optional(), analysis_status: z.string().optional(), application_status: z.string().optional(),
  application_job_status: z.string().optional(), application_job_reason: z.string().nullable().optional(),
  application_run_status: z.string().optional(),
  actual_cents: z.number().nullable().optional(), usage_complete: z.boolean().optional(),
  applied: z.number().optional(), blocked: z.number().optional(), review: z.number().optional(),
});
const manifestSchema = z.object({
  version: z.literal(pipeline), cutoff: z.string().datetime(), shadow: z.boolean(),
  dataset: z.object({ deployment: z.string(), database: z.string() }),
  owner_id: idSchema.optional(), entries: z.array(entrySchema),
});
type Manifest = z.infer<typeof manifestSchema>;

function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new BackfillError(`Missing ${name} value`);
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

async function ownerActor(manifest: Manifest) {
  const secret = process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  if (!secret) throw new BackfillError("Owner actor signing is not configured");
  const candidates = await mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true })
    .collection("extension_users").find({ active: true,
      ...(manifest.owner_id ? { _id: new mongoose.Types.ObjectId(manifest.owner_id) } : {}),
      $or: [{ roles: "owner" }, { role: "owner", roles: { $exists: false } }],
    }, { projection: { _id: 1, email: 1 } }).limit(2).toArray();
  if (candidates.length !== 1) throw new BackfillError("Select one active Owner with --owner-id");
  const owner = candidates[0];
  manifest.owner_id = String(owner._id);
  const fields = { adminId: String(owner._id), email: String(owner.email), role: "owner",
    timestamp: String(Date.now()), requestId: `csi-structured-backfill:${manifest.cutoff}`,
    method: "POST", path: "/api/v1/admin/sales-intelligence/analysis-runs" };
  const request: Request = Object.assign(Object.create(express.request), {
    method: fields.method, originalUrl: fields.path,
    vantageAuth: { kind: "user", userId: fields.adminId, email: fields.email, roles: ["owner"] },
    headers: { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email,
      "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
      "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, secret) },
  });
  return requireCsiOwner(request);
}

async function selectCohort(shadow: boolean): Promise<Manifest> {
  const cutoff = option("--cutoff") ?? new Date().toISOString();
  const date = new Date(cutoff);
  if (!Number.isFinite(date.getTime())) throw new BackfillError("Invalid cutoff date");
  const limit = Number(option("--limit") ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new BackfillError("--limit must be a positive integer");
  const conversationId = option("--conversation-id");
  if (conversationId) idSchema.parse(conversationId);
  const manifest: Manifest = { version: pipeline, cutoff: date.toISOString(), shadow, dataset: csiDataset(),
    owner_id: option("--owner-id"), entries: [] };
  const conversations = getLeadConversationModel().find({
    latest_completed_run_id: { $ne: null }, latest_transcript_version: { $ne: null },
    ...(conversationId ? { _id: conversationId } : {}),
  }).select({ latest_completed_run_id: 1, latest_transcript_version: 1 }).sort({ _id: 1 }).lean().cursor();
  for await (const conversation of conversations) {
    const source = await getIntelligenceRunModel().findOne({ _id: conversation.latest_completed_run_id,
      conversation_id: conversation._id, status: "completed", completed_at: { $lte: date },
      output: { $ne: null }, purged_at: null, purge_started_at: null, ...csiDataset(),
    }).select({ revision: 1, analysis_pipeline: 1 }).lean();
    if (!source || source.analysis_pipeline === pipeline) continue;
    const transcript = await getIntelligenceEvidenceSnapshotModel().findOne({
      conversation_id: conversation._id, transcript_version: conversation.latest_transcript_version,
      source_type: "transcript", purged_at: null, purge_started_at: null, ...csiDataset(),
    }).select({ transcript_version: 1 }).lean();
    if (!transcript) continue;
    const digest = createHash("sha256").update(JSON.stringify({ cutoff: manifest.cutoff,
      shadow, source: String(source._id), transcript: String(transcript._id), dataset: manifest.dataset })).digest("hex");
    manifest.entries.push({ conversation_id: String(conversation._id), source_run_id: String(source._id),
      source_revision: source.revision, transcript_snapshot_id: String(transcript._id),
      transcript_version: transcript.transcript_version!, idempotency_key: `csi-steps-backfill:${digest}`, state: "selected" });
    if (manifest.entries.length >= limit) break;
  }
  return manifestSchema.parse(manifest);
}

async function main() {
  const path = resolve(option("--manifest") ?? "csi-structured-backfill-report.json");
  const shadow = process.argv.includes("--shadow");
  const concurrency = Number(option("--concurrency") ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new BackfillError("--concurrency must be 1..4");
  await connectMongo();
  let manifest: Manifest;
  try { manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    manifest = await selectCohort(shadow);
  }
  if (manifest.shadow !== shadow || JSON.stringify(manifest.dataset) !== JSON.stringify(csiDataset()))
    throw new BackfillError("Manifest dataset/mode differs; use the original flags or a separate manifest");
  if (option("--owner-id") && manifest.owner_id && option("--owner-id") !== manifest.owner_id)
    throw new BackfillError("Manifest Owner differs from --owner-id");
  manifest.owner_id ??= option("--owner-id");
  await save(path, manifest);
  console.log(JSON.stringify({ mode: shadow ? "shadow" : "apply", cutoff: manifest.cutoff,
    selected: manifest.entries.length, manifest: path, concurrency, confirm_write: process.argv.includes("--confirm-write") }));
  if (!process.argv.includes("--confirm-write")) return;
  await runBoundedBackfill(manifest.entries, concurrency, async (entry, stop) => {
    if (["completed", "shadow_complete", "skipped"].includes(entry.state)) return true;
    try {
      if (!entry.job_id) {
        const conversation = await getLeadConversationModel().findById(entry.conversation_id)
          .select({ latest_completed_run_id: 1, latest_transcript_version: 1 }).lean();
        if (!conversation || conversation.latest_transcript_version !== entry.transcript_version)
          throw new BackfillError("Pinned transcript changed");
        const latest = await getIntelligenceRunModel().findById(conversation.latest_completed_run_id)
          .select({ analysis_pipeline: 1, status: 1 }).lean();
        if (latest?.analysis_pipeline === pipeline && latest.status === "completed") {
          entry.state = "skipped"; entry.reason = "already_completed_structured_analysis";
          await save(path, manifest); return true;
        }
        const actor = await ownerActor(manifest);
        await save(path, manifest); // Pin actor identity before the idempotent command.
        const command = await commandAnalysis({ actor, target_id: entry.conversation_id,
          idempotency_key: entry.idempotency_key, application_disabled: shadow,
          command: { command: "reanalyze", expected_revision: entry.source_revision,
            source_run_id: entry.source_run_id, mode: "current_context", owner_correction_ids: [],
            reason: "Owner-requested structured summary and findings backfill" } });
        const scheduled = z.object({ run_id: idSchema, job_id: idSchema }).parse(command.response);
        entry.run_id = scheduled.run_id; entry.job_id = scheduled.job_id; entry.state = "queued";
        await save(path, manifest);
      }
      const scheduledJob = await getSalesIntelligenceJobModel().findOne({ _id: entry.job_id,
        stage: "analysis", ...csiDataset() }).lean();
      if (!scheduledJob || String(scheduledJob.input_refs[0]) !== entry.conversation_id ||
          String(scheduledJob.input_refs[1]) !== entry.transcript_snapshot_id)
        throw new BackfillError("Scheduled input differs from pinned transcript");
      if (shadow && !scheduledJob.owner_reanalysis?.application_disabled)
        throw new BackfillError("Shadow job fence missing");
      const analysis = await continueStructuredAnalysis(() => runIntelligenceJob(entry.job_id, "analysis", { publish: async () => ({ published: false, error_code: null }) }),
        () => getSalesIntelligenceJobModel().findById(entry.job_id).select("status next_attempt_at result").lean().exec());
      entry.analysis_status = analysis.status;
      if (analysis.status === "not_claimable") await waitForBackfillPeer(() =>
        getSalesIntelligenceJobModel().findById(entry.job_id).select("status leased_until").lean().exec(), sleep);
      const run = await getIntelligenceRunModel().findById(entry.run_id).lean();
      if (!run || run.analysis_pipeline !== pipeline) throw new BackfillError("Structured pipeline did not run");
      entry.actual_cents = run.usage?.actual_cents ?? null;
      entry.usage_complete = run.usage?.usage_complete ?? false;
      if (!["submitted", "completed"].includes(run.status)) throw new BackfillError("Analysis did not submit");
      const application = await getSalesIntelligenceJobModel().findOne({ stage: "application",
        "input_refs.0": entry.run_id, ...csiDataset() }).lean();
      if (!application) throw new BackfillError("Application intent missing");
      if (shadow) {
        if (!run.application_disabled || application.status !== "paused" || application.reason !== "permission_denied" ||
            !z.object({ reason: z.literal("shadow_analysis") }).safeParse(application.result).success)
          throw new BackfillError("Shadow application fence missing");
        entry.state = "shadow_complete"; entry.application_status = "disabled";
      } else {
        entry.state = "submitted"; await save(path, manifest);
        const applied = await runIntelligenceApplicationJob(String(application._id));
        entry.application_status = applied.status;
        if (applied.status === "not_claimable") await waitForBackfillPeer(() =>
          getSalesIntelligenceJobModel().findById(application._id).select("status leased_until").lean().exec(), sleep);
        const completed = await getIntelligenceRunModel().findById(entry.run_id).lean();
        const currentApplication = await getSalesIntelligenceJobModel().findById(application._id).select("status reason").lean();
        entry.application_job_status = currentApplication?.status;
        entry.application_job_reason = currentApplication?.reason ?? null;
        entry.application_run_status = completed?.status;
        if (completed?.status !== "completed") throw new BackfillError("Application did not complete");
        entry.applied = completed.result_counts?.applied ?? 0;
        entry.blocked = completed.result_counts?.blocked ?? 0;
        entry.review = completed.result_counts?.review ?? 0;
        entry.state = "completed";
      }
      delete entry.reason;
      await save(path, manifest);
      console.log(JSON.stringify(entry));
    } catch (error) {
      stop();
      entry.state = "failed";
      // Provider exceptions may contain source content; persist only a known code/type.
      entry.reason = error instanceof CsiError ? error.code : error instanceof BackfillError ? error.message : error instanceof Error ? error.name : "unknown_error";
      await save(path, manifest);
      console.error(JSON.stringify({ ...entry, stopped: true }));
      process.exitCode = 1;
      return false;
    }
    return true;
  });
  console.log(JSON.stringify({ completed: manifest.entries.filter(entry => entry.state === "completed").length,
    shadow_completed: manifest.entries.filter(entry => entry.state === "shadow_complete").length,
    failed: manifest.entries.filter(entry => entry.state === "failed").length,
    actual_cents: manifest.entries.reduce((sum, entry) => sum + (entry.actual_cents ?? 0), 0),
    usage_complete: manifest.entries.every(entry => entry.usage_complete === true) }));
}

main().catch(error => {
  console.error(JSON.stringify({ stopped: true, error: error instanceof CsiError ? error.code : error instanceof BackfillError ? error.message : "backfill_setup_failed" }));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
