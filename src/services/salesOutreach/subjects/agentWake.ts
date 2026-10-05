import mongoose, { type ClientSession } from "mongoose";
import { getCallLeadModel } from "../../../models/CallLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { getSalesOutreachSubjectModel } from "../../../models/salesOutreach";
import { enqueueCsiJob } from "../../salesIntelligence/jobs";

/**
 * Desk wake for a Rep Identity Link change (all-numbers CONTRACT, alignment item 2; IMPL-01).
 *
 * A desk subject is assigned to its Lead's `receiver_agent` only while that Agent has a reviewed
 * `sales_rep` link, and the assignment is computed when the subject syncs. Connecting, changing or
 * disconnecting an Account therefore has to re-sync every open subject the Agent receives or is
 * assigned, or those Leads stay Unassigned (connect) or on the old desk (disconnect) until each Lead
 * changes again. In the command's transaction this nominates one `outreach_lead_change` job per such
 * subject. The Lead-revision identity (`sod:lead-change:<model>:<id>:r<revision>`) would dedupe
 * against the completed job of the same revision, so the identity carries `tag` (one per command).
 * Returns the subject ids, for the caller's post-commit live invalidation.
 */
export async function enqueueDeskResyncForAgents(agentIds: ReadonlyArray<string | null | undefined>, tag: string, session: ClientSession, now: Date): Promise<string[]> {
  const ids = [...new Set(agentIds.filter((id): id is string => typeof id === "string" && /^[a-f\d]{24}$/.test(id)))].map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return [];
  const subjects = (await getSalesOutreachSubjectModel()
    .find({ status: { $ne: "closed" } }, { lead_model: 1, lead_id: 1, assigned_agent_id: 1 })
    .session(session)
    .lean()) as unknown as Array<{ _id: unknown; lead_model: "FormLead" | "CallLead"; lead_id: mongoose.Types.ObjectId; assigned_agent_id?: unknown }>;
  if (!subjects.length) return [];
  const leadIds = (model: "FormLead" | "CallLead") => subjects.filter((s) => s.lead_model === model).map((s) => s.lead_id);
  const received = new Set<string>();
  for (const [model, Model] of [["FormLead", getFormLeadModel()], ["CallLead", getCallLeadModel()]] as const) {
    const scope = leadIds(model);
    if (!scope.length) continue;
    const rows = (await (Model as mongoose.Model<unknown>).find({ _id: { $in: scope }, receiver_agent: { $in: ids } }, { _id: 1 }).session(session).lean()) as unknown as Array<{ _id: unknown }>;
    for (const row of rows) received.add(`${model}:${String(row._id)}`);
  }
  const agents = new Set(ids.map(String));
  const affected = subjects.filter((s) => received.has(`${s.lead_model}:${String(s.lead_id)}`) || (s.assigned_agent_id && agents.has(String(s.assigned_agent_id))));
  for (const subject of affected) {
    const id = String(subject.lead_id);
    await enqueueCsiJob({
      stage: "outreach_lead_change",
      subject_key: `outreach-lead:${subject.lead_model}:${id}`,
      dedupe_key: `sod:lead-change:${subject.lead_model}:${id}:${tag}`,
      input_revision: 1,
      input_refs: [id],
    }, session, now);
  }
  return affected.map((subject) => String(subject._id));
}
