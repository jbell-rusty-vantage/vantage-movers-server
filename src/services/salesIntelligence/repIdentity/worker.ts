import { randomUUID } from "node:crypto";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob } from "../jobs";
import { payloadHash } from "../transactions";
import { decideAnalysisEligibility, loadEligibilityInputs } from "../conversations/eligibility";
import { scheduleRepIdentityReevaluation } from "./scheduling";
import { lockRepExtension } from "./propose";
import { auditMediaJob } from "../conversations/workerSupport";

export const REP_REEVALUATION_PAGE_SIZE = 25;
export async function runRepIdentityReevaluationJob(jobId?: string) {
  if (!csiFlag("ENABLED")) return { status: "disabled" };
  const job = await claimCsiJob(`rep-identity:${randomUUID()}`, jobId, 300_000, "rep_identity_reevaluate");
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  try {
    const result = await completeCsiJob(lease, async session => {
      if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
      if (!job.rep_identity_window) throw new CsiError("INVALID_INPUT");
      const { account, extension, from: start, through: end, change_id, after, after_at } = job.rep_identity_window;
      if (!account || !extension || !start || !end || !change_id) throw new CsiError("INVALID_INPUT");
      const from = new Date(start), through = new Date(end);
      if (!Number.isFinite(+from) || !Number.isFinite(+through)) throw new CsiError("INVALID_INPUT");
      await lockRepExtension(account, extension, session);
      const calls = await getCallInteractionModel().find({ provider_account_id: account, "parties.extension_id": extension,
        merged_into_id: null, started_at: { $gte: from, $lte: through }, ...(after && after_at ? {
          $or: [{ started_at: { $gt: new Date(after_at) } }, { started_at: new Date(after_at), _id: { $gt: after } }],
        } : {}) }).sort({ started_at: 1, _id: 1 }).limit(REP_REEVALUATION_PAGE_SIZE).session(session).lean();
      for (const call of calls) {
        const fingerprint = payloadHash([change_id, String(call._id), call.projection_revision]);
        // Existing stage flags govern execution; keeping the intent while disabled avoids losing the change.
        await enqueueCsiJob({ stage: "outreach_ensure", subject_key: `number:${call.contact_number_id ?? call._id}`,
          dedupe_key: `csi:rep-outreach:${fingerprint}`, input_revision: call.projection_revision, input_refs: [String(call._id)] }, session);
        const eligibility = decideAnalysisEligibility(await loadEligibilityInputs(call, session));
        await getLeadConversationModel().updateMany({ call_interaction_id: call._id, provider_account_id: account },
          { $set: { analysis_eligibility: eligibility } }, { session });
        // Discovery uses the existing revisioned excluded-job recovery; no media is fetched here.
        if (call.recordings.length) await enqueueCsiJob({ stage: "recording_discovery", subject_key: `number:${call.contact_number_id ?? call._id}`,
          dedupe_key: `csi:rep-discovery:${fingerprint}`, input_revision: call.projection_revision, input_refs: [String(call._id)] }, session);
        // CSI-12's existing bounded scheduler owns admission/dedupe. Only make its deferred rows due.
        await getLeadConversationModel().updateMany({ call_interaction_id: call._id, provider_account_id: account, state: "media_stored",
          "media.purged_at": null, $expr: { $ne: [{ $ifNull: ["$transcription_job_digest", null] }, "$media_digest_sha256"] } },
          { $set: { next_attempt_at: new Date() } }, { session });
      }
      if (calls.length === REP_REEVALUATION_PAGE_SIZE) await scheduleRepIdentityReevaluation({ account, extension, from, through, change_id,
        after: String(calls.at(-1)!._id), after_at: calls.at(-1)!.started_at }, session);
      await auditMediaJob(session, lease, new Date(), "rep_identity.reevaluated", { scanned: calls.length, continued: calls.length === REP_REEVALUATION_PAGE_SIZE });
      return { scanned: calls.length, continued: calls.length === REP_REEVALUATION_PAGE_SIZE };
    }, { resultFrom: value => value });
    return { status: "completed", ...result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await failCsiJob(lease, "transient"); return { status: "retry" };
  }
}
export async function drainRepIdentityReevaluationJobs(max = 5) {
  const outcomes: string[] = [], deadline = Date.now() + 20_000;
  for (let i = 0; i < Math.min(5, max) && Date.now() < deadline; i++) {
    const result = await runRepIdentityReevaluationJob(); outcomes.push(result.status);
    if (["disabled", "not_claimable", "lease_lost"].includes(result.status)) break;
  }
  return { outcomes };
}
