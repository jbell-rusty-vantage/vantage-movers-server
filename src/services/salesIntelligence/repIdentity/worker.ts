import { randomUUID } from "node:crypto";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, failCsiJob } from "../jobs";

/**
 * `rep_identity_reevaluate` has no retained consumer: a call's rep is resolved at read time from
 * the Rep Identity Link effective at the call (`numberActivity/timeline.ts`), so a review needs no
 * recomputation. Review commands no longer enqueue it; a job queued by an earlier release is
 * completed without effects, and never re-nominates Outreach, discovery or analysis work.
 */
export async function runRepIdentityReevaluationJob(jobId?: string) {
  if (!csiFlag("ENABLED")) return { status: "disabled" };
  const job = await claimCsiJob(`rep-identity:${randomUUID()}`, jobId, 60_000, "rep_identity_reevaluate");
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  try {
    await completeCsiJob(lease, async () => undefined, { result: { retired: true } });
    return { status: "completed" };
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
