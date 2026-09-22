import { readFile, writeFile } from "node:fs/promises";
import { withTransaction } from "../src/db";
import { csiDataset, csiFlag, CSI_BACKFILL_JOB_PRIORITY, CSI_LIVE_JOB_PRIORITY } from "../src/config/domain/salesIntelligence";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { BookedLead } from "../src/models/BookedLead";
import { normalizeJobNo } from "../src/services/bookings/bookingIdentity";
import { loadLead } from "../src/services/salesIntelligence/attachment/sources";
import { persistLeadAttachments } from "../src/services/salesIntelligence/attachment/store";
import { ensureLead, ensureInteraction, interactionAttribution, workerContext } from "../src/services/salesIntelligence/outreach/ensure";
import { officialClosure } from "../src/services/salesIntelligence/outreach/transitions";
import { toOutreachDto } from "../src/services/salesIntelligence/outreach/reads";
import { publishAttentionSnapshot } from "../src/services/salesIntelligence/outreach/attention";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import { enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import { payloadHash } from "../src/services/salesIntelligence/transactions";
import { runIntelligenceJob, analysisRuntimeConfiguration, isHistoricalBackfillOnly } from "../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../src/services/salesIntelligence/analysis/apply";
import { scheduleNumberIntelligence } from "../src/services/salesIntelligence/analysis/scheduling";
import { runMediaFetchJob } from "../src/services/salesIntelligence/conversations/media";
import { runTranscriptionJob } from "../src/services/salesIntelligence/conversations/transcribe";
import { inventorySchema, selectCandidates, type Candidate } from "./outreach-backfill-plan";
import { backfillEvent } from "./outreach-backfill-history";

const OUTPUT = "scripts/output/outreach-backfill";
const label = `outreach-seed-2026-09-21${process.argv.includes("--citation-repair") ? ":citation-guidance-v1" : ""}`;
const noPublish = async () => ({ published: false, error_code: null });

async function runWhenClaimable(jobId: string, stage: "analysis" | "number_refresh", recovery = false) {
  const config = analysisRuntimeConfiguration();
    const job = await getSalesIntelligenceJobModel().findById(jobId).lean();
    if (!job) return { status: "job_missing" };
    if (job.status === "completed") return typeof job.result?.run_id === "string"
      ? { status: "submitted", run_id: job.result.run_id }
      : { status: "completed_without_submission", reason: String(job.result?.reason ?? "no_receipt") };
    if (["paused", "dead_letter"].includes(job.status)) return { status: job.status, reason: String(job.result?.reason ?? job.reason) };
    if (process.argv.includes("--prepare-only")) return { status: "queued", job_id: jobId };
    if (job.status === "leased" && job.leased_until && job.leased_until > new Date()) return { status: "leased", job_id: jobId };
    if (job.next_attempt_at > new Date()) return { status: "retry_scheduled", job_id: jobId };
    const result = await runIntelligenceJob(jobId, stage, { publish: noPublish,
      ...(recovery ? { limits: { ...config.limits, steps: 8, context_tokens: 192_000, elapsed_ms: 240_000 } } : {}),
      beforeProvider: async () => { backfillEvent({ phase: "provider", job_id: jobId, stage }); },
    });
    return result;
}

async function revalidate(candidate: Candidate) {
  return withTransaction(async session => {
    const ref = { model: candidate.model, id: candidate.lead_id };
    const lead = await loadLead(ref, session);
    if (!lead || officialClosure(lead)) return false;
    const job = normalizeJobNo(lead.job_no);
    if (await BookedLead.exists({ $or: [{ lead_model: ref.model, lead_ref: ref.id }, ...(job ? [{ normalized_job_no: job }] : [])] }).session(session)) return false;
    const closed = await getOutreachRecordModel().exists({ "subject.model": ref.model, "subject.id": ref.id, state: "closed" }).session(session);
    if (closed) return false;
    return true;
  });
}

async function seed(candidate: Candidate) {
  if (!await revalidate(candidate)) return { status: "no_longer_eligible" };
  await withTransaction(async session => {
    const lead = await loadLead({ model: candidate.model, id: candidate.lead_id }, session);
    if (!lead || officialClosure(lead)) return;
    await persistLeadAttachments(lead, candidate.model, session, payloadHash(label).slice(0, 24));
    // Only event attribution can select a number. A phone match alone does not pin it.
    await ensureLead({ model: candidate.model, id: candidate.lead_id }, workerContext(session, label));
  });
  let replayed = 0;
  // Newest first; ensureInteraction checks later fulfillment before opening old missed episodes.
  const calls = getCallInteractionModel().find({ contact_number_id: { $in: candidate.number_ids }, merged_into_id: null, purged_at: null,
    started_at: { $gte: candidate.arrived_at } }).sort({ started_at: -1, _id: -1 }).cursor();
  for await (const call of calls) {
    await withTransaction(async session => {
      const current = await getCallInteractionModel().findOne({ _id: call._id, merged_into_id: null, purged_at: null }).session(session).lean();
      if (!current) return;
      const attribution = await interactionAttribution(current, session);
      if (attribution.lead_ref?.model !== candidate.model || attribution.lead_ref.id !== candidate.lead_id || !attribution.lead_effects_allowed) return;
      await ensureInteraction(current, workerContext(session, label));
    });
    replayed++;
  }
  return { status: "seeded", calls_examined: replayed };
}

async function applyRun(runId: string) {
  const job = await getSalesIntelligenceJobModel().findOne({ ...csiDataset(), stage: "application", "input_refs.0": runId }).sort({ _id: -1 }).lean();
  if (!job) return "application_missing";
  if (job.status === "completed") return "already_applied";
  return (await runIntelligenceApplicationJob(String(job._id))).status;
}

async function processConversation(id: string, candidate: Candidate) {
  let conversation = await getLeadConversationModel().findById(id).lean();
  if (!conversation || conversation.content_purged_at || conversation.media?.purged_at) return { status: "unavailable" };
  const matches = await withTransaction(async session => {
    const call = await getCallInteractionModel().findOne({ _id: conversation!.call_interaction_id, merged_into_id: null, purged_at: null }).session(session).lean();
    if (!call) return false;
    const attribution = await interactionAttribution(call, session);
    return attribution.lead_effects_allowed && attribution.lead_ref?.model === candidate.model && attribution.lead_ref.id === candidate.lead_id;
  });
  if (!matches || !await revalidate(candidate)) return { status: "identity_or_eligibility_changed" };
  const source = await getCallInteractionModel().findById(conversation.call_interaction_id).select({ sources: 1 }).lean();
  // Match the normal pipeline: imported historical-only calls are lower priority;
  // repairing previously captured live calls preserves their existing live priority.
  const priority = isHistoricalBackfillOnly(source?.sources) ? CSI_BACKFILL_JOB_PRIORITY : CSI_LIVE_JOB_PRIORITY;
  if (conversation.latest_completed_run_id) {
    const prior = await getIntelligenceRunModel().findById(conversation.latest_completed_run_id).select({ status: 1, job_id: 1 }).lean();
    const priorJob = prior ? await getSalesIntelligenceJobModel().findById(prior.job_id).select({ input_refs: 1 }).lean() : null;
    const sameTranscript = priorJob?.input_refs[1] ? await getIntelligenceEvidenceSnapshotModel().exists({ _id: priorJob.input_refs[1],
      conversation_id: id, transcript_version: conversation.latest_transcript_version, source_revision: conversation.media_digest_sha256,
      purged_at: null, "completeness.complete": true }) : false;
    if (prior?.status === "completed" && sameTranscript) return { status: "already_analyzed", run_id: String(prior._id) };
  }
  if (!conversation.media?.blob_pathname) {
    const job = await getSalesIntelligenceJobModel().findOne({ ...csiDataset(), stage: "media_fetch", subject_key: `conversation:${id}` }).sort({ _id: -1 }).lean();
    if (!job) return { status: "media_job_missing" };
    const media = await runMediaFetchJob(String(job._id));
    conversation = await getLeadConversationModel().findById(id).lean();
    if (!conversation?.media?.blob_pathname) return { status: "media_pending", outcome: media.status };
  }
  if (!conversation.latest_transcript_version) {
    if (!conversation.media_digest_sha256) return { status: "media_digest_missing" };
    const job = await withTransaction(session => enqueueCsiJob({ stage: "transcription", subject_key: `conversation:${id}`,
      dedupe_key: `csi:transcription:conversation:${id}:${conversation!.media_digest_sha256}`, input_revision: 1, input_refs: [id], priority }, session));
    const stt = await runTranscriptionJob(String(job._id), { publish: noPublish });
    conversation = await getLeadConversationModel().findById(id).lean();
    if (!conversation?.latest_transcript_version) return { status: "transcription_pending", outcome: stt.status };
  }
  const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ ...csiDataset(), conversation_id: id, source_type: "transcript",
    transcript_version: conversation.latest_transcript_version, purged_at: null, "completeness.complete": true }).lean();
  if (!snapshot) return { status: "transcript_snapshot_missing" };
  let job = await withTransaction(session => enqueueCsiJob({ stage: "analysis", subject_key: `conversation:${id}`,
    dedupe_key: `csi:analysis:conversation:${id}:${conversation!.latest_transcript_version}`, input_revision: 1,
    input_refs: [id, String(snapshot._id)], priority }, session));
  if (job.status === "completed" && typeof job.result?.run_id === "string") return { status: "already_submitted", run_id: job.result.run_id, application: await applyRun(job.result.run_id) };
  // One explicit recovery per transcript for old bounded model failures. The old
  // run remains immutable; budget, permissions and exhausted retries are not reset.
  const recovery = job.status === "paused" && ["schema_exhausted", "bounds_exhausted"].includes(String(job.result?.reason));
  if (recovery) job = await withTransaction(session => enqueueCsiJob({ stage: "analysis", subject_key: `conversation:${id}`,
    dedupe_key: `csi:analysis:conversation:${id}:${conversation!.latest_transcript_version}:${label}`, input_revision: 1,
    input_refs: [id, String(snapshot._id)], priority }, session));
  if (recovery && job.status === "pending" && job.attempts === 0 && job.priority !== priority) {
    await getSalesIntelligenceJobModel().updateOne({ _id: job._id, ...csiDataset(), status: "pending", attempts: 0 }, { $set: { priority } });
    backfillEvent({ phase: "source_priority_corrected", job_id: String(job._id), priority });
  }
  const result = await runWhenClaimable(String(job._id), "analysis", recovery);
  const runId = "run_id" in result && typeof result.run_id === "string" ? result.run_id : null;
  return { status: result.status, reason: "reason" in result ? result.reason : null, job_id: String(job._id), run_id: runId, application: runId ? await applyRun(runId) : null };
}

export async function executeBackfill(limit: number, apply: boolean) {
  const inventory = inventorySchema.parse(JSON.parse(await readFile(`${OUTPUT}/inventory.json`, "utf8")));
  if (inventory.database !== csiDataset().database) throw new Error("Inventory database does not match current scope");
  if (+new Date() - +inventory.now > 86400000) throw new Error("Inventory is older than 24 hours; rerun inventory");
  const selected = selectCandidates(inventory.candidates, limit);
  await writeFile(`${OUTPUT}/selection.json`, JSON.stringify(selected, null, 2));
  backfillEvent({ phase: "selected", apply, count: selected.length, channels: selected.map(c => c.model), recorded: selected.filter(c => c.conversations.length).length });
  if (!apply) return;
  if (!csiFlag("ENABLED") || !csiFlag("OUTREACH_ENSURE") || !csiFlag("ATTACHMENT_REFRESH") || !csiFlag("EXTRACTION_ENABLED")) throw new Error("Required CSI feature flag is disabled");
  const results = [];
  const coverage = await readCaptureCoverage();
  const seenConversations = new Set<string>();
  for (const candidate of selected) {
    backfillEvent({ phase: "candidate", model: candidate.model, lead_id: candidate.lead_id });
    const beforeRow = await getOutreachRecordModel().findOne({ "subject.model": candidate.model, "subject.id": candidate.lead_id }).lean();
    const before = beforeRow ? (await toOutreachDto(beforeRow, new Date(), coverage)).derived : null;
    const seeded = await seed(candidate);
    const analyses = [];
    if (seeded.status === "seeded" && await revalidate(candidate)) {
      // Most recent recordings preserve promise chronology. Limit provider spend to two per opportunity.
      const conversations = candidate.conversations.filter(c => c.eligibility !== "excluded" && !seenConversations.has(c.id))
        .sort((a, b) => +b.started_at - +a.started_at || (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0))
        .filter((c, i, all) => all.findIndex(other => other.interaction_id === c.interaction_id) === i).slice(0, 2);
      for (const conversation of conversations) {
        seenConversations.add(conversation.id);
        const analysis = { conversation_id: conversation.id, ...await processConversation(conversation.id, candidate) };
        analyses.push(analysis);
        backfillEvent({ phase: "analysis_result", lead_id: candidate.lead_id, analysis });
      }
    }
    const numberResults = [];
    if (analyses.some(a => ["submitted", "already_submitted", "already_analyzed"].includes(a.status))) {
      for (const numberId of candidate.number_ids) {
        const number = await getContactNumberModel().findById(numberId).select({ running_summary: 1 }).lean();
        const jobId = await withTransaction(session => scheduleNumberIntelligence(numberId, session));
        if (jobId) {
          const result = await runWhenClaimable(jobId, "number_refresh");
          const runId = "run_id" in result && typeof result.run_id === "string" ? result.run_id : null;
          numberResults.push({ number_id: numberId, status: result.status, application: runId ? await applyRun(runId) : null });
        } else numberResults.push({ number_id: numberId, status: number?.running_summary ? "current_or_pending" : "not_scheduled" });
      }
    }
    const afterRow = await getOutreachRecordModel().findOne({ "subject.model": candidate.model, "subject.id": candidate.lead_id }).lean();
    const dto = afterRow ? await toOutreachDto(afterRow, new Date(), coverage) : null;
    const result = { model: candidate.model, lead_id: candidate.lead_id, outreach_id: afterRow ? String(afterRow._id) : null, seeded,
      before, after: dto?.derived, analyses, number_results: numberResults,
      followups: dto?.followups.map(a => ({ id: a.id, kind: a.kind, status: a.status, due_at: a.due_at, origin: a.origin })) };
    results.push(result);
    backfillEvent({ phase: "candidate_result", result });
    await writeFile(`${OUTPUT}/results.json`, JSON.stringify({ from: inventory.from, started_at: inventory.now, updated_at: new Date(), results }, null, 2));
    backfillEvent({ phase: "candidate_complete", lead_id: candidate.lead_id, band: dto?.derived.attention_band, analyses: analyses.map(a => a.status) });
  }
  await publishBackfillAttention();
}

export async function publishBackfillAttention() {
  // An offline operator can allow more build time while retaining the complete,
  // atomic canonical snapshot and its unchanged five-minute expiration.
  const publication = await publishAttentionSnapshot({ deadlineMs: 180_000 });
  await writeFile(`${OUTPUT}/publication.json`, JSON.stringify(publication, null, 2));
  backfillEvent({ phase: "publication", publication });
  return publication;
}
