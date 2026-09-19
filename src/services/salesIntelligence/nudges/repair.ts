import { randomUUID } from "node:crypto";
import { withTransaction } from "../../../db";
import { csiDataset, csiFlag, csiNudgeConfiguration } from "../../../config/domain/salesIntelligence";
import { getOwnerRepNudgeModel } from "../../../models/OwnerRepNudge";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { CsiError, csiWorkerActor } from "../auth";
import { claimCsiJob, completeCsiJob, failCsiJob } from "../jobs";
import { createNudgeAdapter, type NudgeAdapter } from "./adapters";
import { finishNudgeInTransaction, nudgeOperational, scheduleNudgeRepair } from "./commands";

const enabled = () => csiFlag("ENABLED") && csiFlag("NUDGE_ENABLED");
/** Recovery can ONLY reconcile. No import/call of the Owner send command and no submit path. */
export async function runNudgeRepairJob(jobId?: string, adapter: NudgeAdapter = createNudgeAdapter()) {
  if (!enabled()) return { status: "disabled" };
  const job = await claimCsiJob(`nudge-repair:${randomUUID()}`, jobId, 60_000, "nudge_repair");
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  try {
    const row = await getOwnerRepNudgeModel().findById(job.input_refs[0]).lean();
    let status: "failed" | "sent" | "fallback_sent" | "unknown_delivery" = "unknown_delivery";
    let code: string | null = "delivery_unestablished";
    if (row?.status === "pending") {
      if (+row.createdAt > Date.now() - 120_000 || (row.send_expires_at && row.send_expires_at > new Date())) throw new CsiError("LEASE_LOST");
      if (!row.submission_started_at) { status = "failed"; code = "not_submitted"; }
      else if (row.provider_message_id) {
        const config = csiNudgeConfiguration();
        let verified = false;
        if (config.account === row.provider_account_id && config.senderExtension === row.sender_extension_id && config.senderPerson === row.sender_person_id) {
          try { verified = await adapter.receipt({ channel: row.channel, destination: row.destination, body: row.body_as_sent, messageId: row.provider_message_id,
            account: row.provider_account_id!, extension: "", person: row.recipient_person_id ?? null, senderExtension: row.sender_extension_id!, senderExtensionNumber: row.sender_extension_number ?? "", senderPerson: row.sender_person_id!, senderDid: row.sender_did ?? "" }); }
          catch { code = "receipt_unavailable"; }
        } else code = "receipt_configuration_unavailable";
        if (verified) { status = row.fallback_channel === "pager" ? "fallback_sent" : "sent"; code = null; }
      }
    }
    const changed = await completeCsiJob(lease, async session => {
      if (!enabled()) throw new CsiError("FEATURE_DISABLED");
      const current = row ? await getOwnerRepNudgeModel().findById(row._id).session(session).lean() : null;
      if (!current || current.status !== "pending") return false;
      if (current.revision !== row!.revision || current.provider_message_id !== row!.provider_message_id) throw new CsiError("REVISION_CONFLICT");
      return finishNudgeInTransaction(current, status, code, { session, command_id: current.command_id ?? current._id, now: new Date(), actor: csiWorkerActor(String(job._id)) });
    });
    if (changed && row) await nudgeOperational(String(row._id), status, code);
    return { status: "completed", repaired: Boolean(changed) };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await failCsiJob(lease, "transient"); return { status: "retry" };
  }
}
/** Bounded orphan/exhausted-job recovery; generation is derived from the durable preceding job. */
export async function recoverNudgeRepairJobs(max = 25) {
  if (!enabled()) return 0;
  const rows = await getOwnerRepNudgeModel().find({ status: "pending", createdAt: { $lte: new Date(Date.now() - 120_000) } }).sort({ createdAt: 1, _id: 1 }).limit(Math.min(25, Math.max(1, max))).lean();
  let scheduled = 0;
  for (const row of rows) {
    await withTransaction(async session => {
      const previous = await getSalesIntelligenceJobModel().findOne({ ...csiDataset(), stage: "nudge_repair", subject_key: `nudge:${row._id}` }).sort({ input_revision: -1 }).session(session).lean();
      if (!previous || ["completed", "dead_letter", "excluded"].includes(previous.status)) {
        await scheduleNudgeRepair(String(row._id), session, new Date(), previous?.input_revision ?? 0); scheduled++;
      }
    });
  }
  return scheduled;
}
export async function drainNudgeRepairJobs(max = 5, adapter?: NudgeAdapter) {
  if (!enabled()) return { status: "disabled", scheduled: 0, outcomes: [] as string[] };
  const scheduled = await recoverNudgeRepairJobs();
  const outcomes: string[] = [], deadline = Date.now() + 30_000;
  for (let i = 0; i < Math.min(5, Math.max(1, max)) && Date.now() < deadline; i++) {
    const result = await runNudgeRepairJob(undefined, adapter); outcomes.push(result.status);
    if (["disabled", "not_claimable", "lease_lost"].includes(result.status)) break;
  }
  return { status: "completed", scheduled, outcomes };
}
