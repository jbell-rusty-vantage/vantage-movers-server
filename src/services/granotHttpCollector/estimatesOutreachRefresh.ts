import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { getSalesOutreachSubjectModel } from "../../models/salesOutreach";
import { enqueueCsiJob, type JobInput } from "../salesIntelligence/jobs";
import type { GranotAutomationActionReceipt } from "../granotLifecycle/automationApply";
import type { DeskLeadRef } from "../salesOutreach/subjects/leadFacts";

type RefreshDecision = { execution_mode: string; outcome: string; target?: { model: string; id: string } };
export type EstimatesOutreachRefreshDeps = {
  transaction: <T>(work: (session: ClientSession) => Promise<T>) => Promise<T>;
  decision: (id: string, session: ClientSession) => Promise<RefreshDecision | null>;
  openSubject: (lead: DeskLeadRef, session: ClientSession) => Promise<boolean>;
  enqueue: (job: JobInput, session: ClientSession) => Promise<unknown>;
};

const defaults: EstimatesOutreachRefreshDeps = {
  transaction: withTransaction,
  decision: async (id, session) => getSynchronizationDecisionModel().findById(id).select({ execution_mode: 1, outcome: 1, target: 1 }).session(session).lean().exec(),
  openSubject: async (lead, session) => Boolean(await getSalesOutreachSubjectModel().exists({ lead_model: lead.model, lead_id: new Types.ObjectId(lead.id), status: { $in: ["active", "review"] } }).session(session)),
  enqueue: enqueueCsiJob,
};
const successful = (outcome: string) => ["applied", "linked", "already_current"].includes(outcome);

/** Receipt-authoritative repair of existing subjects, including canonical no-op snapshots. */
export async function refreshExistingEstimatesOutreach(
  receipt: GranotAutomationActionReceipt,
  deps: EstimatesOutreachRefreshDeps = defaults,
): Promise<"enqueued" | "skipped"> {
  if (!receipt.decision_id || !receipt.lifecycle_receipt_id || !successful(receipt.outcome)) return "skipped";
  return deps.transaction(async (session) => {
    const decision = await deps.decision(receipt.decision_id!, session);
    if (!decision || decision.execution_mode !== "live" || !successful(decision.outcome)) return "skipped";
    const target = decision.target;
    if (!target || (target.model !== "FormLead" && target.model !== "CallLead") || !/^[a-f\d]{24}$/i.test(target.id)) return "skipped";
    const lead: DeskLeadRef = { model: target.model, id: target.id };
    if (!await deps.openSubject(lead, session)) return "skipped";
    await deps.enqueue({
      stage: "outreach_lead_change",
      subject_key: `outreach-lead:${lead.model}:${lead.id}`,
      dedupe_key: `sod:lead-change:${lead.model}:${lead.id}:estimates-refresh:${receipt.lifecycle_receipt_id}`,
      input_revision: 1,
      input_refs: [lead.id],
    }, session);
    // The existing every-minute lead-change cron drains this retained stage.
    return "enqueued";
  });
}
