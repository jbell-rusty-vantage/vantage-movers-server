import { randomUUID } from "node:crypto";
import { csiDataset, csiFlag, CSI_BACKFILL_JOB_PRIORITY, CSI_LIVE_JOB_PRIORITY } from "../../../config/domain/salesIntelligence";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getLeadConversationModel, LEAD_CONVERSATION_INDEXES } from "../../../models/LeadConversation";
import { publishCaptureProjectionWakeup } from "../../numberActivity/webhookFanout";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob } from "../jobs";
import { assertIndexes } from "../transactions";
import { decideAnalysisEligibility, loadEligibilityInputs } from "./eligibility";
import { MEDIA_FETCH_STAGE, recordingPendingDelay, recordingWindowExhausted } from "./mediaPolicy";
import { auditMediaJob, loadCanonicalInteraction } from "./workerSupport";

class PendingRecording extends Error { constructor(readonly firstObserved: Date, readonly interactionId: string) { super("recording_pending"); } }

function pipelineJobPriority(sources: readonly string[] | undefined): number {
  const list = sources ?? [];
  const historicalOnly = list.includes("backfill") && !list.some((s) => s === "webhook" || s === "call_log_reconcile");
  return historicalOnly ? CSI_BACKFILL_JOB_PRIORITY : CSI_LIVE_JOB_PRIORITY;
}
export type DiscoveryDependencies = { now?: () => Date; owner?: string; publish?: (jobId: string) => Promise<unknown> };

export async function runRecordingDiscoveryJob(jobId?: string, deps: DiscoveryDependencies = {}) {
  if (!csiFlag("MEDIA_ENABLED")) return { status: "disabled" as const };
  const owner = deps.owner ?? `csi-discovery:${randomUUID()}`;
  const job = await claimCsiJob(owner, jobId, 300_000, "recording_discovery");
  if (!job) return { status: "not_claimable" as const };
  const lease = { job_id: String(job._id), owner, epoch: job.lease_epoch };
  const now = (deps.now ?? (() => new Date()))();
  try {
    await assertIndexes(getLeadConversationModel().collection, LEAD_CONVERSATION_INDEXES);
    const result = await completeCsiJob(lease, async session => {
      const interaction = await loadCanonicalInteraction(String(job.input_refs[0] ?? ""), session);
      if (interaction.purged_at) return { conversations: 0, media_job_ids: [] as string[], state: "purged" };
      const firstObserved = interaction.first_observed_at;
      if (!interaction.recordings.length) {
        if (!recordingWindowExhausted(firstObserved, now)) throw new PendingRecording(firstObserved, String(interaction._id));
        await getCallInteractionModel().updateOne({ _id: interaction._id, merged_into_id: null }, {
          $set: { recording_discovery: { state: "no_recording", reason: "availability_window_exhausted", checked_at: now, next_attempt_at: null } },
        }, { session });
        await auditMediaJob(session, lease, now, "recording_discovery.no_recording", { interaction_id: String(interaction._id), reason: "availability_window_exhausted" });
        return { conversations: 0, media_job_ids: [] as string[], state: "no_recording" };
      }
      const inputs = await loadEligibilityInputs(interaction, session);
      const eligibility = decideAnalysisEligibility(inputs, now);
      const lead = eligibility.scope === "lead" ? inputs.leads[0]! : null;
      const mediaJobs: string[] = [];
      for (const recording of interaction.recordings) {
        const key = { provider: "ringcentral" as const, provider_account_id: interaction.provider_account_id, provider_recording_id: recording.provider_recording_id };
        const existing = await getLeadConversationModel().findOne(key).session(session);
        const row = await getLeadConversationModel().findOneAndUpdate(key, {
          $setOnInsert: { state: "discovered", next_attempt_at: now },
          $set: {
            call_interaction_id: interaction._id, contact_number_id: interaction.contact_number_id,
            account_attribution_evidence_ref: `interaction:${interaction._id}`,
            call_log_id: interaction.call_log_ids[0] ?? null, telephony_session_id: interaction.telephony_session_id,
            direction: interaction.direction, started_at: interaction.started_at, duration_seconds: interaction.duration_seconds,
            rc_result: interaction.provider_result, contact_type: interaction.contact_type, contact_type_basis: interaction.contact_type_basis,
            analysis_eligibility: eligibility,
            ...(existing?.match_method === "owner_manual_attach" ? {} : {
              lead_ref: lead, match_method: lead ? "call_interaction_number_candidate" : inputs.ambiguous || inputs.leads.length > 1 ? "ambiguous_number_context" : "number_only",
              match_confidence: lead ? "medium" : "low",
            }),
          },
        }, { upsert: true, returnDocument: "after", session, runValidators: true });
        if (!row) throw new CsiError("INVALID_INPUT");
        recording.lead_conversation_id = row._id;
        if (eligibility.status !== "excluded" && !row.content_purged_at && !row.media?.blob_pathname && !row.media?.purged_at) {
          const subject = `conversation:${row._id}`;
          const latest = await getSalesIntelligenceJobModel().findOne({ ...csiDataset(), stage: MEDIA_FETCH_STAGE, subject_key: subject })
            .sort({ input_revision: -1 }).session(session);
          if (latest && latest.dedupe_key !== `csi:media_fetch:${subject}:${latest.input_revision}`) throw new CsiError("IDEMPOTENCY_CONFLICT");
          // Only an eligibility skip may reopen. Active waits and terminal provider failures keep their original attempt policy.
          const revision = latest ? latest.input_revision + (latest.status === "completed" && latest.result?.reason === "excluded" ? 1 : 0) : 1;
          const mediaJob = await enqueueCsiJob({
            stage: MEDIA_FETCH_STAGE, dedupe_key: `csi:media_fetch:${subject}:${revision}`,
            subject_key: subject, input_revision: revision, input_refs: [String(row._id)],
            priority: pipelineJobPriority(interaction.sources),
          }, session, now);
          mediaJobs.push(String(mediaJob._id));
        }
      }
      // Updating the canonical row in this transaction conflicts with a concurrent capture/merge; retry reloads all evidence.
      await getCallInteractionModel().updateOne({ _id: interaction._id, merged_into_id: null }, {
        $set: { recordings: interaction.recordings, recording_discovery: { state: "discovered", checked_at: now, next_attempt_at: null } },
      }, { session, runValidators: true });
      await auditMediaJob(session, lease, now, "recording_discovery.completed", { interaction_id: String(interaction._id), conversations: interaction.recordings.length });
      return { conversations: interaction.recordings.length, media_job_ids: mediaJobs, state: "discovered" };
    }, { resultFrom: result => result });
    for (const id of result.media_job_ids) {
      // A failed doorbell never turns a committed discovery into a failed lease.
      try { await (deps.publish ?? publishCaptureProjectionWakeup)(id); } catch { /* cron recovers */ }
    }
    return { status: "completed" as const, result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" as const };
    if (error instanceof PendingRecording) {
      const next = new Date(now.getTime() + recordingPendingDelay(error.firstObserved, now));
      await failCsiJob(lease, "recording_pending", 0, { resumeAt: next, result: { state: "pending" }, mutation: async session => {
        await getCallInteractionModel().updateOne({ _id: error.interactionId, merged_into_id: null, recordings: { $size: 0 } }, {
          $set: { recording_discovery: { state: "pending", reason: "recording_id_not_observed", checked_at: now, next_attempt_at: next } },
        }, { session });
      } });
      return { status: "pending" as const };
    }
    const errorCode = error instanceof CsiError ? error.code : "discovery_failed";
    await failCsiJob(lease, "transient", 0, { result: { error_code: errorCode } });
    return { status: "failed" as const, error_code: errorCode };
  }
}

export async function drainRecordingDiscoveryJobs(max = 25, deps: DiscoveryDependencies = {}) {
  let processed = 0;
  const deadline = Date.now() + 20_000;
  while (processed < max && Date.now() < deadline) {
    const result = await runRecordingDiscoveryJob(undefined, deps);
    if (result.status === "disabled" || result.status === "not_claimable") break;
    processed++;
  }
  return { processed };
}

