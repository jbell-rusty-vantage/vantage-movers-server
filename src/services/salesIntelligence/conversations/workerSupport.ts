import mongoose, { type ClientSession } from "mongoose";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { CsiError, csiWorkerActor } from "../auth";
import { appendCsiAudit } from "../transactions";
import type { JobLease } from "../jobs";
import { recordOperationalEvent } from "../../observability";

/** Best-effort telemetry after the authoritative transaction; never retries a committed provider unit. */
export async function recordMediaOutcome(jobId: string, outcome: "media_stored" | "unavailable" | "failed", reason: string | null = null) {
  try {
    await recordOperationalEvent({ level: outcome === "media_stored" ? "info" : "warn",
      eventKey: `sales_intelligence.conversation.${outcome}`, category: "ringcentral", workflow: "sales_intelligence",
      summary: `Conversation media ${outcome}.`, details: { jobId, reason }, notificationCandidate: false, reportable: false, piiPolicy: "none",
    });
  } catch { /* Durable audit remains authoritative if operational telemetry is unavailable. */ }
}

export async function loadCanonicalInteraction(id: string, session?: ClientSession) {
  const seen = new Set<string>();
  let account: string | null = null;
  for (let hop = 0; hop < 20; hop++) {
    if (!mongoose.isValidObjectId(id) || seen.has(id)) throw new CsiError("INVALID_INPUT");
    seen.add(id);
    const row = await getCallInteractionModel().findById(id).session(session ?? null);
    if (!row || (account !== null && row.provider_account_id !== account)) throw new CsiError("INVALID_INPUT");
    account = row.provider_account_id;
    if (!row.merged_into_id) return row;
    id = String(row.merged_into_id);
  }
  throw new CsiError("INVALID_INPUT");
}
export async function auditMediaJob(session: ClientSession, lease: JobLease, now: Date, event: string, current: { [key: string]: string | number | boolean | null }) {
  await appendCsiAudit({ session, command_id: new mongoose.Types.ObjectId(), now, actor: csiWorkerActor(lease.job_id) }, {
    subject_key: `job:${lease.job_id}`, event_kind: event, prior: { lease_epoch: lease.epoch }, current,
    target_id: lease.job_id, revision: lease.epoch, kind: "job",
  });
}
