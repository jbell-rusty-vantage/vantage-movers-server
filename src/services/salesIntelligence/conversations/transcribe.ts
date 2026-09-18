import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { csiDataset, csiFlag, csiProviderConfiguration } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getLeadConversationModel, type LeadConversationDocument } from "../../../models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel, INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES } from "../../../models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceAiBudgetModel } from "../../../models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { readStoredAudio, gatewaySttProvider, validateStoredAudio, TranscriptionProviderError, type BlobAudioReader, type SttProvider } from "../../conversations/transcriptionProvider";
import { publishCaptureProjectionWakeup } from "../../numberActivity/webhookFanout";
import { reserveCsiBudget, reconcileCsiBudget } from "../aiBudget";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob, type JobLease } from "../jobs";
import { resolvePolicy } from "../policy";
import { assertIndexes, payloadHash } from "../transactions";
import { decideAnalysisEligibility, loadEligibilityInputs } from "./eligibility";
import { auditMediaJob, loadCanonicalInteraction } from "./workerSupport";
import { EmptyTranscriptionError, prepareTranscript, transcriptionEstimate, transcriptVersion } from "./transcript";
import { scheduleTranscriptionJobs } from "./transcriptionScheduling";

export type TranscriptionDependencies = {
  owner?: string; now?: () => Date; ttlMs?: number; readAudio?: BlobAudioReader; transcribe?: SttProvider;
  centsPerSecond?: number; publish?: typeof publishCaptureProjectionWakeup;
};

async function currentEligibility(conversation: LeadConversationDocument, session: ClientSession, now: Date) {
  if (!conversation.call_interaction_id || !conversation.provider_account_id) throw new CsiError("INVALID_INPUT");
  const interaction = await loadCanonicalInteraction(String(conversation.call_interaction_id), session);
  if (interaction.provider_account_id !== conversation.provider_account_id || !interaction.recordings.some(r => r.provider_recording_id === conversation.provider_recording_id)) throw new CsiError("INVALID_INPUT");
  return decideAnalysisEligibility(await loadEligibilityInputs(interaction, session), now);
}

/** Repair killed eighth claims, using the same transaction/fence protocol as CSI-11. */
export async function recoverExhaustedTranscriptionJob(jobId?: string) {
  return withTransaction(async session => {
    const Jobs = getSalesIntelligenceJobModel();
    const filter = { ...csiDataset(), stage: "transcription" as const, ...(jobId ? { _id: jobId } : {}),
      "result.failure_projected": { $ne: true }, $or: [
        { status: "leased" as const, leased_until: { $lte: new Date() }, $expr: { $gte: ["$attempts", "$max_attempts"] } },
        { status: "dead_letter" as const, reason: "attempts_exhausted" },
      ] };
    const job = await Jobs.findOne(filter).session(session);
    if (!job) return false;
    const changed = await Jobs.updateOne({ ...filter, _id: job._id, lease_epoch: job.lease_epoch }, { $set: {
      status: "dead_letter", reason: "attempts_exhausted", lease_owner: null, leased_until: null,
      result: { failure_projected: true, conversation_id: job.input_refs[0] },
    } }, { session });
    if (changed.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    const digest = job.dedupe_key.split(":").at(-1)!;
    await getLeadConversationModel().updateOne({ _id: job.input_refs[0], media_digest_sha256: digest, latest_transcript_version: { $ne: transcriptVersion(digest) } },
      { $set: { state: "failed", availability_reason: "attempts_exhausted", pending_stage: "transcription", next_attempt_at: null, unavailable_until: null } }, { session });
    await auditMediaJob(session, { job_id: String(job._id), owner: "transcription-recovery", epoch: job.lease_epoch }, new Date(), "conversation.failed", { reason: "attempts_exhausted" });
    return true;
  });
}

/** Exactly one recording, one provider call, no network inside a Mongo transaction. */
export async function runTranscriptionJob(jobId?: string, deps: TranscriptionDependencies = {}) {
  if (!csiFlag("STT_ENABLED")) return { status: "disabled" as const };
  if (await recoverExhaustedTranscriptionJob(jobId)) return { status: "dead_letter" as const };
  const owner = deps.owner ?? `csi-stt:${randomUUID()}`;
  const job = await claimCsiJob(owner, jobId, deps.ttlMs ?? 300_000, "transcription");
  if (!job) return { status: "not_claimable" as const };
  const lease: JobLease = { job_id: String(job._id), owner, epoch: job.lease_epoch };
  const now = (deps.now ?? (() => new Date()))();
  const conversationId = job.input_refs[0];
  const digest = job.dedupe_key.split(":").at(-1);
  const Conversations = getLeadConversationModel();
  let reservationId: string | null = null;
  let providerReturned = false;
  let providerStarted = false;
  let actualCents: number | null = null;
  const pause = async (reason: "eligibility_pending" | "permission_denied" | "budget_exhausted", detail: string, until?: Date) => {
    await failCsiJob(lease, reason, 0, {
      ...(reason === "budget_exhausted" ? {} : { resumeAt: until ?? new Date(now.getTime() + 600_000) }),
      mutation: async (session, outcome) => {
        await Conversations.updateOne({ _id: conversationId, media_digest_sha256: digest }, { $set: {
          state: "unavailable", availability_reason: detail, unavailable_until: until ?? outcome.next_attempt_at,
          next_attempt_at: until ?? outcome.next_attempt_at, pending_stage: "transcription",
        } }, { session });
      }, result: { reason: detail },
    });
    return { status: reason };
  };
  try {
    if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new CsiError("INVALID_INPUT");
    const version = transcriptVersion(digest);
    const Snapshots = getIntelligenceEvidenceSnapshotModel();
    await assertIndexes(Snapshots.collection, INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES);
    const existing = await Snapshots.findOne({ ...csiDataset(), conversation_id: conversationId, transcript_version: version });
    if (existing) {
      await completeCsiJob(lease, async () => undefined, { result: { transcript_version: version, reason: "already_transcribed" } });
      return { status: "completed" as const };
    }
    const conversation = await Conversations.findById(conversationId).orFail();
    if (conversation.media_digest_sha256 !== digest || conversation.media?.purged_at ||
        (conversation.transcript && !conversation.latest_transcript_version)) {
      await completeCsiJob(lease, async () => undefined, { result: { reason: "stale_or_seed_evidence" } });
      return { status: "completed" as const };
    }
    if (!conversation.media?.blob_pathname || !conversation.media.stored_at || !conversation.media.bytes || !conversation.media.content_type ||
        !["media_stored", "unavailable"].includes(conversation.state)) return await pause("eligibility_pending", "media_pending");
    const eligibility = await withTransaction(session => currentEligibility(conversation, session, now));
    if (eligibility.status === "excluded") {
      await completeCsiJob(lease, async session => {
        await Conversations.updateOne({ _id: conversationId, media_digest_sha256: digest }, { $set: {
          state: "media_stored", analysis_eligibility: eligibility, pending_stage: null, transcription_job_digest: null,
          next_attempt_at: new Date(now.getTime() + 600_000), availability_reason: null, unavailable_until: null, last_error: null,
        } }, { session });
        // The claim performed no provider work. Preserve all previous transient attempts, including seven before this skip.
        await getSalesIntelligenceJobModel().updateOne({ _id: job._id, lease_epoch: lease.epoch }, { $inc: { attempts: -1 } }, { session });
        await auditMediaJob(session, lease, now, "conversation.transcription_skipped", { conversation_id: String(conversationId), reason: "excluded" });
      }, { result: { conversation_id: String(conversationId), reason: "excluded" } });
      return { status: "excluded" as const };
    }
    if (eligibility.eligible !== true) return await pause("eligibility_pending", "eligibility_pending");
    const rate = deps.centsPerSecond ?? csiProviderConfiguration().transcriptionCentsPerSecond;
    const estimate = transcriptionEstimate(conversation.duration_seconds, rate);
    if (estimate === null) return await pause("permission_denied", "stt_pricing_or_duration_missing");
    const budget = await getSalesIntelligenceAiBudgetModel().findOne({ period_start: { $lte: now }, period_end: { $gt: now } }).sort({ period_start: -1 });
    const policy = await resolvePolicy();
    if (!budget || estimate > policy.per_recording_ceiling_cents) return await pause("budget_exhausted", !budget ? "budget_period_missing" : "per_recording_budget_exhausted", budget?.period_end);
    reservationId = `stt:${job._id}:${job.lease_epoch}`;
    try {
      await reserveCsiBudget({ kind: "stt", reservation_id: reservationId, month: budget.month, job_id: String(job._id), run_id: null,
        step: `stt:${job.lease_epoch}`, stage: "transcription", estimated_cents: estimate });
    } catch (error) {
      reservationId = null;
      if (error instanceof CsiError && error.code === "BUDGET_EXHAUSTED") return await pause("budget_exhausted", "budget_exhausted", budget.period_end);
      throw error;
    }
    const model = csiProviderConfiguration().transcriptionModel;
    const signal = AbortSignal.timeout(90_000);
    const media = { pathname: conversation.media.blob_pathname, bytes: conversation.media.bytes, contentType: conversation.media.content_type, digest };
    const audio = await (deps.readAudio ?? readStoredAudio)(media, signal);
    validateStoredAudio(media, audio);
    providerStarted = true;
    const raw = await (deps.transcribe ?? gatewaySttProvider())({ audio, contentType: media.contentType, model, signal });
    providerReturned = true;
    actualCents = raw.actualCents;
    if (actualCents !== null && (!Number.isSafeInteger(actualCents) || actualCents < 0)) actualCents = null;
    const redacted = prepareTranscript(raw);
    const transcript = { text: redacted.text, model, chars: redacted.text.length, redactions: redacted.redactions, created_at: now };
    const analysisId = await completeCsiJob(lease, async session => {
      const current = await Conversations.findById(conversationId).session(session).orFail();
      if (current.media_digest_sha256 !== digest || current.media?.purged_at) throw new CsiError("REVISION_CONFLICT");
      const eligible = await currentEligibility(current, session, new Date());
      const response = { transcript: { ...transcript, created_at: now.toISOString() }, media_digest_sha256: digest, actual_cents: actualCents, reservation_id: reservationId!, pricing: { cents_per_second: rate, estimated_cents: estimate } };
      const [snapshot] = await Snapshots.create([{ ...csiDataset(), conversation_id: current._id, transcript_version: version,
        source_type: "transcript", source_id: String(current._id), source_revision: digest, subject_key: job.subject_key,
        arguments: { model, media_digest_sha256: digest }, response, retrieved_at: now, happened_at: current.started_at,
        content_digest: payloadHash({ transcript, segments: redacted.segments }), completeness: { complete: true, missing_ranges: [] }, segments: redacted.segments,
      }], { session });
      if (actualCents !== null) await reconcileCsiBudget(reservationId!, actualCents, false, session);
      await Conversations.updateOne({ _id: current._id }, { $set: {
        transcript, transcript_segments: redacted.segments, latest_transcript_version: version, state: "transcribed",
        cost_cents: { stt: actualCents, summary: current.cost_cents?.summary ?? 0 }, analysis_eligibility: eligible,
        availability_reason: actualCents === null ? "stt_cost_unreported" : null, unavailable_until: null, last_error: null,
        pending_stage: eligible.status !== "excluded" ? "analysis" : null, next_attempt_at: eligible.status !== "excluded" ? now : null,
      } }, { session, runValidators: true });
      let next: string | null = null;
      if (eligible.status !== "excluded") {
        const analysis = await enqueueCsiJob({ stage: "analysis", subject_key: job.subject_key, input_revision: 1,
          dedupe_key: `csi:analysis:${job.subject_key}:${version}`, input_refs: [String(current._id), String(snapshot!._id)] }, session, now);
        if (eligible.status === "undetermined") {
          await getSalesIntelligenceJobModel().updateOne({ _id: analysis._id }, { $set: { status: "paused", reason: "eligibility_pending" } }, { session });
        } else next = String(analysis._id);
      }
      await auditMediaJob(session, lease, now, "conversation.transcribed", { conversation_id: String(current._id), transcript_version: version, redactions: redacted.redactions, analysis_enqueued: Boolean(next) });
      return next;
    }, { result: { conversation_id: String(conversationId), transcript_version: version, actual_cents: actualCents } });
    if (analysisId) { try { await (deps.publish ?? publishCaptureProjectionWakeup)(analysisId); } catch { /* Durable intent survives wake-up loss. */ } }
    return { status: "completed" as const };
  } catch (error) {
    if (error instanceof EmptyTranscriptionError) {
      try {
        await completeCsiJob(lease, async session => {
          if (actualCents !== null) await reconcileCsiBudget(reservationId!, actualCents, false, session);
          const current = await Conversations.findById(conversationId).session(session).orFail();
          await Conversations.updateOne({ _id: conversationId, media_digest_sha256: digest, latest_transcript_version: { $ne: transcriptVersion(digest!) } }, { $set: {
            state: "unavailable", availability_reason: "empty_transcription", pending_stage: null,
            next_attempt_at: null, unavailable_until: null, cost_cents: { stt: actualCents, summary: current.cost_cents?.summary ?? 0 },
          } }, { session, runValidators: true });
          await auditMediaJob(session, lease, now, "conversation.unavailable", { reason: "empty_transcription" });
        }, { result: { reason: "empty_transcription", actual_cents: actualCents } });
        return { status: "empty_transcription" as const };
      } catch (failure) {
        if (actualCents !== null) await reconcileCsiBudget(reservationId!, actualCents, false);
        if (failure instanceof CsiError && failure.code === "LEASE_LOST") return { status: "lease_lost" as const };
        throw new Error("transcription_persistence_failed");
      }
    }
    // Reconcile reported spend even on a lost lease. Unknown outcome keeps its reservation for cost recovery.
    const knownRejection = error instanceof TranscriptionProviderError && ["permission_denied", "throttled"].includes(error.reason);
    if (reservationId && (!providerStarted || knownRejection || (providerReturned && actualCents !== null))) {
      await reconcileCsiBudget(reservationId, actualCents ?? 0, !providerReturned);
    }
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" as const };
    const reason = error instanceof TranscriptionProviderError && ["permission_denied", "throttled"].includes(error.reason) ? error.reason : "transient";
    try {
      const outcome = await failCsiJob(lease, reason === "permission_denied" ? "permission_denied" : reason === "throttled" ? "throttled" : "transient", 0, {
        ...(reason === "permission_denied" || reason === "throttled" ? { resumeAt: new Date(now.getTime() + (reason === "permission_denied" ? 86_400_000 : 600_000)) } : {}),
        mutation: async (session, outcome) => {
          await Conversations.updateOne({ _id: conversationId, media_digest_sha256: digest, latest_transcript_version: { $ne: transcriptVersion(digest ?? "") } }, { $set: {
            state: outcome.status === "dead_letter" ? "failed" : "unavailable", pending_stage: "transcription",
            availability_reason: outcome.status === "dead_letter" ? "attempts_exhausted" : reason,
            next_attempt_at: outcome.status === "dead_letter" ? null : outcome.next_attempt_at, unavailable_until: outcome.status === "dead_letter" ? null : outcome.next_attempt_at,
            last_error: { code: reason, message: reason, at: now },
          } }, { session });
          await auditMediaJob(session, lease, now, outcome.status === "dead_letter" ? "conversation.failed" : "conversation.unavailable", { reason });
        },
      });
      return { status: outcome.status, reason };
    } catch (failure) {
      if (failure instanceof CsiError && failure.code === "LEASE_LOST") return { status: "lease_lost" as const };
      throw new Error("transcription_persistence_failed");
    }
  }
}

/** At most five durable hook jobs; only one expensive STT unit per invocation. */
export async function drainTranscriptionJobs(deps: TranscriptionDependencies = {}) {
  if (!csiFlag("STT_ENABLED")) return { status: "disabled" as const };
  await resumeTranscriptAnalysisJobs();
  await scheduleTranscriptionJobs(5, deps.publish);
  return runTranscriptionJob(undefined, deps);
}

/** Recover only eligibility-held analysis intents, pinned to their immutable current transcript. */
export async function resumeTranscriptAnalysisJobs() {
  if (!csiFlag("STT_ENABLED")) return 0;
  const Jobs = getSalesIntelligenceJobModel();
  const filter = { ...csiDataset(), stage: "analysis" as const, $or: [
    { status: "paused" as const, reason: "eligibility_pending" },
    { status: "completed" as const, "result.reason": "eligibility_excluded" },
  ] };
  const jobs = await Jobs.find(filter).sort({ next_attempt_at: 1, _id: 1 }).limit(5);
  let resumed = 0;
  for (const job of jobs) {
    resumed += await withTransaction(async session => {
      const current = await getLeadConversationModel().findById(job.input_refs[0]).session(session);
      const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ ...csiDataset(), _id: job.input_refs[1], conversation_id: job.input_refs[0] }).session(session);
      if (!current || !snapshot || current.latest_transcript_version !== snapshot.transcript_version || current.media_digest_sha256 !== snapshot.source_revision) {
        await Jobs.updateOne({ ...filter, _id: job._id }, { $set: { status: "completed", reason: null, completed_at: new Date(), result: { reason: "stale_transcript" } } }, { session });
        return 0;
      }
      const eligibility = await currentEligibility(current, session, new Date());
      const eligible = eligibility.eligible === true, excluded = eligibility.status === "excluded";
      const result = await Jobs.updateOne({ ...filter, _id: job._id }, { $set: {
        status: eligible ? "pending" : excluded ? "completed" : "paused", reason: eligible || excluded ? null : "eligibility_pending",
        result: excluded ? { reason: "eligibility_excluded" } : null, completed_at: excluded ? new Date() : null,
        next_attempt_at: new Date(Date.now() + (eligible ? 0 : 600_000)),
      } }, { session });
      if (result.modifiedCount) await getLeadConversationModel().updateOne({ _id: current._id,
        latest_transcript_version: snapshot.transcript_version, media_digest_sha256: snapshot.source_revision },
        { $set: { analysis_eligibility: eligibility, pending_stage: excluded ? null : "analysis", next_attempt_at: excluded ? null : new Date() } }, { session });
      return eligible ? result.modifiedCount : 0;
    });
  }
  return resumed;
}
