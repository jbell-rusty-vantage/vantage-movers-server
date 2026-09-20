import { randomUUID } from "node:crypto";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { storeRecordingStream, MediaValidationError, type ImmutableUpload } from "../../conversations/streamingMedia";
import { recordingProvider, RecordingReadError, retryAfterMs, type RecordingProvider } from "../../ringcentral/recordings";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, failCsiJob } from "../jobs";
import { decideAnalysisEligibility, loadEligibilityInputs } from "./eligibility";
import { mediaMaxBytes, MEDIA_FETCH_STAGE, recordingPendingDelay, recordingWindowExhausted } from "./mediaPolicy";
import { auditMediaJob, loadCanonicalInteraction, recordMediaOutcome } from "./workerSupport";
import { deletePendingStoredAudio } from "../retention";

export type MediaDependencies = { now?: () => Date; owner?: string; provider?: RecordingProvider; upload?: ImmutableUpload; ttlMs?: number; deleteUpload?: (pathname: string) => Promise<void> };
/** CSI-12 consumes this state/digest. No STT or analysis job is created by CSI-11. */
export const MEDIA_STORED_NEXT_STAGE = "transcription" as const;

/** A killed eighth invocation cannot run its catch block. Repair its failure projection atomically with the exhausted job fence. */
export async function recoverExhaustedMediaJob(jobId?: string) {
  const Jobs = getSalesIntelligenceJobModel();
  const repaired = await withTransaction(async session => {
    const exhausted = { ...csiDataset(), stage: MEDIA_FETCH_STAGE, ...(jobId ? { _id: jobId } : {}),
      "result.failure_projected": { $ne: true },
      $or: [
        { status: "leased" as const, leased_until: { $lte: new Date() }, $expr: { $gte: ["$attempts", "$max_attempts"] } },
        { status: "dead_letter" as const, reason: "attempts_exhausted" },
      ],
    };
    const job = await Jobs.findOne(exhausted).session(session);
    if (!job) return null;
    const result = await Jobs.updateOne({ ...exhausted, _id: job._id, lease_epoch: job.lease_epoch }, { $set: {
      status: "dead_letter", reason: "attempts_exhausted", lease_owner: null, leased_until: null,
      result: { conversation_id: String(job.input_refs[0]), reason: "attempts_exhausted", failure_projected: true },
    } }, { session });
    if (result.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    await getLeadConversationModel().updateOne({ _id: job.input_refs[0], "media.blob_pathname": null }, { $set: {
      state: "failed", availability_reason: "attempts_exhausted", next_attempt_at: null, unavailable_until: null, pending_stage: MEDIA_FETCH_STAGE,
    } }, { session });
    await auditMediaJob(session, { job_id: String(job._id), owner: "media-recovery", epoch: job.lease_epoch }, new Date(), "conversation.failed", {
      conversation_id: String(job.input_refs[0]), reason: "attempts_exhausted",
    });
    return String(job._id);
  });
  if (repaired) await recordMediaOutcome(repaired, "failed", "attempts_exhausted");
  return Boolean(repaired);
}

export async function runMediaFetchJob(jobId?: string, deps: MediaDependencies = {}) {
  if (!csiFlag("MEDIA_ENABLED")) return { status: "disabled" as const };
  if (await recoverExhaustedMediaJob(jobId)) return { status: "dead_letter" as const, reason: "attempts_exhausted" };
  const owner = deps.owner ?? `csi-media:${randomUUID()}`;
  const job = await claimCsiJob(owner, jobId, deps.ttlMs ?? 300_000, MEDIA_FETCH_STAGE);
  if (!job) return { status: "not_claimable" as const };
  const lease = { job_id: String(job._id), owner, epoch: job.lease_epoch };
  const now = (deps.now ?? (() => new Date()))();
  const conversationId = job.input_refs[0];
  const Conversations = getLeadConversationModel();
  try {
    const context = await withTransaction(async session => {
      const conversation = await Conversations.findById(conversationId).session(session);
      if (!conversation?.call_interaction_id || !conversation.provider_account_id) throw new CsiError("INVALID_INPUT");
      const interaction = await loadCanonicalInteraction(String(conversation.call_interaction_id), session);
      if (interaction.provider_account_id !== conversation.provider_account_id || !interaction.recordings.some(r => r.provider_recording_id === conversation.provider_recording_id)) throw new CsiError("INVALID_INPUT");
      const eligibility = decideAnalysisEligibility(await loadEligibilityInputs(interaction, session), now);
      return { conversation, eligibility };
    });
    const { conversation, eligibility } = context;
    if (conversation.content_purged_at || conversation.media?.blob_pathname || conversation.media?.purged_at || eligibility.status === "excluded") {
      const reason = conversation.content_purged_at || conversation.media?.purged_at ? "purged" : conversation.media?.blob_pathname ? "already_stored" : "excluded";
      await completeCsiJob(lease, async session => {
        await Conversations.updateOne({ _id: conversationId }, { $set: { analysis_eligibility: eligibility } }, { session });
        await auditMediaJob(session, lease, now, "conversation.media_skipped", { conversation_id: String(conversationId), reason });
      }, { result: { conversation_id: String(conversationId), reason } });
      return { status: "completed" as const };
    }
    if (eligibility.status === "undetermined") {
      await failCsiJob(lease, "eligibility_pending", 0, { resumeAt: new Date(now.getTime() + 600_000), mutation: async (session, outcome) => {
        await Conversations.updateOne({ _id: conversationId }, { $set: { analysis_eligibility: eligibility, pending_stage: MEDIA_FETCH_STAGE, next_attempt_at: outcome.next_attempt_at } }, { session });
      } });
      return { status: "eligibility_pending" as const };
    }
    // One bounded provider unit, outside every Mongo transaction. The signal covers metadata, stream and Blob.
    const signal = AbortSignal.timeout(90_000);
    const provider = deps.provider ?? recordingProvider();
    const account = conversation.provider_account_id!;
    const metadata = await provider.metadata(account, conversation.provider_recording_id, signal);
    const response = await provider.content(account, conversation.provider_recording_id, signal);
    const stored = await storeRecordingStream({ response, metadataContentType: metadata.contentType, accountId: account,
      recordingId: conversation.provider_recording_id, maxBytes: mediaMaxBytes(), signal, upload: deps.upload });
    const purgedDuringUpload = await completeCsiJob(lease, async session => {
      const current = await Conversations.findById(conversationId).session(session);
      if (!current) throw new CsiError("INVALID_INPUT");
      if (current.content_purged_at || current.media?.purged_at) return true;
      const canonical = await loadCanonicalInteraction(String(current.call_interaction_id), session);
      const currentEligibility = decideAnalysisEligibility(await loadEligibilityInputs(canonical, session), now);
      // Never replace successful evidence (including seed artifacts or a concurrently stored digest).
      if (!current.content_purged_at && !current.media?.blob_pathname && !current.media?.purged_at) {
        await Conversations.updateOne({ _id: conversationId }, { $set: {
          state: "media_stored", media: { blob_pathname: stored.blob_pathname, bytes: stored.bytes, content_type: stored.content_type, stored_at: now },
          media_digest_sha256: stored.media_digest_sha256, availability_reason: null, unavailable_until: null,
          next_attempt_at: now, pending_stage: currentEligibility.eligible ? MEDIA_STORED_NEXT_STAGE : null, last_error: null, analysis_eligibility: currentEligibility,
        } }, { session, runValidators: true });
      }
      await auditMediaJob(session, lease, now, "conversation.media_stored", { conversation_id: String(conversationId), bytes: stored.bytes, media_digest_sha256: stored.media_digest_sha256 });
      return false;
    }, { resultFrom: purged => ({ conversation_id: String(conversationId), state: purged ? "purged" : "media_stored", media_digest_sha256: stored.media_digest_sha256, ...(purged ? { pending_blob_delete: stored.blob_pathname } : {}) }) });
    if (purgedDuringUpload) {
      try { await deletePendingStoredAudio(lease.job_id, stored.blob_pathname, deps.deleteUpload); }
      catch { return { status: "completed" as const, reason: "purged_cleanup_pending" }; }
      return { status: "completed" as const, reason: "purged" };
    }
    await recordMediaOutcome(lease.job_id, "media_stored");
    return { status: "completed" as const };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" as const };
    const conversation = await Conversations.findById(conversationId);
    const firstObserved = conversation?.createdAt ?? now;
    const status = error instanceof RecordingReadError ? error.status : null;
    const noRecording = status === 404 && recordingWindowExhausted(firstObserved, now);
    const invalid = error instanceof MediaValidationError;
    if (noRecording || invalid) {
      const reason = noRecording ? "availability_window_exhausted" : (error as MediaValidationError).code;
      await completeCsiJob(lease, async session => {
        await Conversations.updateOne({ _id: conversationId, "media.blob_pathname": null }, { $set: {
          state: noRecording ? "no_recording" : "unavailable", availability_reason: reason, unavailable_until: null, pending_stage: null, next_attempt_at: null,
        } }, { session });
        await auditMediaJob(session, lease, now, "conversation.unavailable", { conversation_id: String(conversationId), reason });
      }, { result: { reason } });
      await recordMediaOutcome(lease.job_id, "unavailable", reason);
      return { status: "unavailable" as const, reason };
    }
    const reason = status === 401 || status === 403 ? "permission_denied" : status === 429 ? "throttled" : status === 404 ? "recording_pending" : "transient";
    const delay = status === 401 || status === 403 ? 86_400_000 : status === 429 ? retryAfterMs((error as RecordingReadError).retryAfter, now) : status === 404 ? recordingPendingDelay(firstObserved, now) : null;
    try {
      const outcome = await failCsiJob(lease, reason, reason === "throttled" ? (delay ?? 600_000) : 0, {
        ...(delay === null ? {} : reason === "permission_denied" ? { resumeAt: new Date(now.getTime() + delay) } : {}),
        result: { conversation_id: String(conversationId), reason },
        mutation: async (session, outcome) => {
          await Conversations.updateOne({ _id: conversationId, "media.blob_pathname": null }, { $set: {
            state: outcome.status === "dead_letter" ? "failed" : reason === "recording_pending" ? "discovered" : "unavailable",
            availability_reason: outcome.status === "dead_letter" ? "attempts_exhausted" : reason,
            unavailable_until: outcome.status === "dead_letter" ? null : outcome.next_attempt_at,
            next_attempt_at: outcome.status === "dead_letter" ? null : outcome.next_attempt_at, pending_stage: MEDIA_FETCH_STAGE,
            last_error: { code: reason, message: reason, at: now },
          } }, { session });
          await auditMediaJob(session, lease, now, outcome.status === "dead_letter" ? "conversation.failed" : "conversation.unavailable", { conversation_id: String(conversationId), reason, status: outcome.status });
        },
      });
      await recordMediaOutcome(lease.job_id, outcome.status === "dead_letter" ? "failed" : "unavailable", reason);
      return { status: outcome.status, reason };
    } catch (failure) {
      if (failure instanceof CsiError && failure.code === "LEASE_LOST") return { status: "lease_lost" as const };
      throw failure;
    }
  }
}

/** Queue and cron use exactly the same one-recording unit. */
export const drainMediaFetchJobs = () => runMediaFetchJob();
