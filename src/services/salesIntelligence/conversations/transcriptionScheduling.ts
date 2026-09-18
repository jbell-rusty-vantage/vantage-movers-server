import { csiFlag } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { enqueueCsiJob } from "../jobs";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { publishCaptureProjectionWakeup } from "../../numberActivity/webhookFanout";
import { decideAnalysisEligibility, loadEligibilityInputs } from "./eligibility";
import { loadCanonicalInteraction } from "./workerSupport";

/** Close CSI-11's durable hook→job gap. The marker and job commit together; digest changes alone create a new STT unit. */
export async function scheduleTranscriptionJobs(max = 5, publish = publishCaptureProjectionWakeup) {
  if (!csiFlag("STT_ENABLED")) return [];
  if (!Number.isFinite(max)) return [];
  const limit = Math.min(5, Math.max(0, Math.floor(max)));
  if (!limit) return [];
  const Conversations = getLeadConversationModel();
  const now = new Date();
  const filter = {
    state: "media_stored" as const,
    media_digest_sha256: { $type: "string" as const }, "media.blob_pathname": { $type: "string" as const },
    "media.stored_at": { $type: "date" as const }, "media.purged_at": null,
    $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
    $expr: { $ne: [{ $ifNull: ["$transcription_job_digest", null] }, "$media_digest_sha256"] },
  };
  const rows = await Conversations.find(filter).sort({ next_attempt_at: 1, _id: 1 }).limit(limit).select({ _id: 1 }).lean();
  const ids: string[] = [];
  for (const row of rows) {
    const id = await withTransaction(async session => {
      const current = await Conversations.findOne({ ...filter, _id: row._id }).session(session);
      if (!current) return null;
      // Move every unresolved row out of this scan's due set, so old waits never starve new media.
      const defer = { next_attempt_at: new Date(now.getTime() + 600_000) };
      if (!/^[a-f0-9]{64}$/.test(current.media_digest_sha256!) || !current.call_interaction_id || !current.provider_account_id) {
        await Conversations.updateOne({ _id: current._id }, { $set: defer }, { session });
        return null;
      }
      const interaction = await loadCanonicalInteraction(String(current.call_interaction_id), session);
      if (interaction.provider_account_id !== current.provider_account_id || !interaction.recordings.some(r => r.provider_recording_id === current.provider_recording_id)) {
        await Conversations.updateOne({ _id: current._id }, { $set: defer }, { session });
        return null;
      }
      const eligibility = decideAnalysisEligibility(await loadEligibilityInputs(interaction, session), now);
      if (eligibility.eligible !== true) {
        await Conversations.updateOne({ _id: current._id }, { $set: { ...defer, analysis_eligibility: eligibility,
          pending_stage: eligibility.status === "undetermined" ? "transcription" : null } }, { session });
        return null;
      }
      const digest = current.media_digest_sha256!;
      const subject = `conversation:${current._id}`;
      const job = await enqueueCsiJob({ stage: "transcription", subject_key: subject,
        dedupe_key: `csi:transcription:${subject}:${digest}`, input_revision: 1, input_refs: [String(current._id)] }, session);
      // Only a non-provider exclusion skip may reopen; successful and exhausted jobs remain terminal.
      if (job.status === "completed" && job.result?.reason === "excluded") {
        await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: "completed", "result.reason": "excluded" },
          { $set: { status: "pending", reason: null, completed_at: null, result: null, next_attempt_at: now } }, { session });
      }
      const resumable = !["completed", "dead_letter"].includes(job.status) || job.result?.reason === "excluded";
      await Conversations.updateOne({ _id: current._id }, { $set: { transcription_job_digest: digest,
        pending_stage: resumable ? "transcription" : null, analysis_eligibility: eligibility } }, { session });
      return resumable ? String(job._id) : null;
    });
    if (id) ids.push(id);
  }
  for (const id of ids) { try { await publish(id); } catch { /* Mongo cron recovery is authoritative. */ } }
  return ids;
}
