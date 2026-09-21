import { withTransaction } from "../../../db";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../../models/IntelligenceSubmission";
export const applicationReady = () => csiFlag("ENABLED") && csiFlag("EXTRACTION_ENABLED") && csiFlag("OUTREACH_ENSURE");
/** Only this consumer's compatible paused receipts are resumed. Other reasons/attempts stay untouched. */
export async function resumeApplicationIntents() {
  if (!applicationReady()) return { resumed: 0, job_ids: [] as string[] };
  return withTransaction(async session => {
    const jobs = await getSalesIntelligenceJobModel().find({ ...csiDataset(), stage: "application", status: "paused",
      $or: [{ reason: { $in: ["consumer_unavailable", "invocation_pending"] } }, { reason: "permission_denied", "result.reason": "application_disabled" }] }).sort({ _id: 1 }).limit(25).session(session).lean();
    let resumed = 0;
    const job_ids: string[] = [];
    for (const job of jobs) {
      if (job.input_refs.length !== 2) continue;
      const run = await getIntelligenceRunModel().findOne({ _id: job.input_refs[0], ...csiDataset(), status: "submitted" }).session(session).lean();
      const submission = await getIntelligenceSubmissionModel().findOne({ _id: job.input_refs[1], run_id: run?._id, application_job_id: job._id }).session(session).lean();
      if (!run || !submission || run.subject_key !== job.subject_key) continue;
      // Old CSI-17 receipts have no invocation owner; receipt provenance is still validated by application.
      if (job.reason === "invocation_pending" && !run.invocation_complete) continue;
      const result = await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: "paused", reason: job.reason },
        { $set: { status: "pending", reason: null, next_attempt_at: new Date() } }, { session });
      resumed += result.modifiedCount;
      if (result.modifiedCount === 1) job_ids.push(String(job._id));
    }
    return { resumed, job_ids };
  });
}
