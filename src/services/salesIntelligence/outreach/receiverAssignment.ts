import mongoose, { type ClientSession } from "mongoose";
import { Agent } from "../../../models/Agent";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { ringCentralAnsweredContext, writeReceiverAgent } from "../../leads/receiverAgentWrite";
import type { LeadRef } from "../attachment/suggest";
import type { CsiTransactionContext } from "../transactions";
import { CONTACT_FACTS_SCAN, interactionAttribution, interactionRepIdentity, mappedSalesReps } from "./ensure";
import { refreshRecord, saveFollowup, type recordForUpdate } from "./store";
import { callFacts } from "./transitions";
import { mayReplaceAssignment, receiverAssignmentEnabled, receiverRankKey, subjectKey, WEAKEST_RECEIVER_SOURCE, type FollowupRow, type RecordRow } from "./types";

/**
 * S6-AGENT (assignment addendum §3.1 E5, §3.2 E4/E26), behind SALES_INTELLIGENCE_RECEIVER_ASSIGNMENT.
 * Runs inside `ensureLead`, after the closure and Lead progress, in the caller's transaction:
 *
 * 1. `ringcentral_answered` (E5): a Call Lead with an empty `receiver_agent` whose creating call
 *    (`ringcentral.telephony_session_id`, on the record's primary Number) was answered by exactly one
 *    reviewed rep identity gets that rep, through the normal Lead write (`writeReceiverAgent`). The
 *    Outreach ensure path is the seam because it is where both halves meet: the Lead's creation change
 *    and the call's capture each reach `ensureLead`, in either order, and rep identities are reviewed here.
 * 2. The responsible rep (§3.2): unless the Owner assigned the record, `responsible_agent_id` follows
 *    `receiver_agent` (`crm_receiver`, ranked by its source); when `receiver_agent` is cleared a
 *    `crm_receiver` assignment drops back to the best phone evidence. The Owner's assignment is never
 *    touched (E26/C13), and nothing here writes the Lead except step 1.
 * 3. Open follow-ups with no agent, or one inherited from the record, follow the record's rep;
 *    promises (`rep_promise`, their retry chain) and Owner actions keep theirs.
 */
type RecordDoc = Awaited<ReturnType<typeof recordForUpdate>>;
type ReceiverLead = { receiver_agent?: unknown; receiver_agent_source?: string | null; receiver_agent_name_snapshot?: string | null;
  ringcentral?: { telephony_session_id?: string | null } | null };

export async function applyReceiverAssignment(record: RecordDoc, lead: ReceiverLead, ref: LeadRef, context: CsiTransactionContext, changeId: string | null) {
  if (!receiverAssignmentEnabled()) return;
  let current = lead;
  if (!lead.receiver_agent && ref.model === "CallLead") {
    const filled = await fillRingCentralAnswered(record, lead, ref, context);
    if (filled) { current = { ...lead, ...filled.lead }; changeId = filled.change_id; }
  }
  await followReceiver(record, current, context, changeId);
}

/** E5 (pure half): the one reviewed rep who answered the creating call, or null. */
export async function ringCentralAnsweredAgent(record: Pick<RecordRow, "primary_contact_number_id">, lead: ReceiverLead, session?: ClientSession) {
  const sid = lead.ringcentral?.telephony_session_id;
  if (!sid || !record.primary_contact_number_id) return null;
  const call = await getCallInteractionModel().findOne({ contact_number_id: record.primary_contact_number_id, telephony_session_id: sid, merged_into_id: null })
    .session(session ?? null).lean();
  if (!call) return null;
  const identity = await interactionRepIdentity(call, session as ClientSession);
  const agents = [...new Set(identity.agent_ids)];
  if (agents.length !== 1) return null;
  const agent = await Agent.findById(agents[0]).session(session ?? null).lean();
  if (!agent || agent.active !== true || !agent.name?.trim()) return null;
  return { call_id: String(call._id), telephony_session_id: sid, agent: { id: String(agent._id), name: agent.name } };
}

async function fillRingCentralAnswered(record: RecordDoc, lead: ReceiverLead, ref: LeadRef, context: CsiTransactionContext) {
  const answered = await ringCentralAnsweredAgent(record, lead, context.session);
  if (!answered) return null;
  const stamp = await writeReceiverAgent({ model: ref.model, id: ref.id, agent: answered.agent, source: WEAKEST_RECEIVER_SOURCE, source_value: answered.call_id,
    expected_receiver: null, context: ringCentralAnsweredContext({ lead_id: ref.id, telephony_session_id: answered.telephony_session_id, interaction_id: answered.call_id }),
    command_name: "fillReceiverAgentFromAnsweredCall", session: context.session, now: context.now });
  if (!stamp) return null;
  return { change_id: String(stamp.change_id), lead: { receiver_agent: answered.agent.id, receiver_agent_source: WEAKEST_RECEIVER_SOURCE, receiver_agent_name_snapshot: answered.agent.name } };
}

/**
 * The pure §3.2 decision for one record (E4/E26): `follow` sets `crm_receiver` to the Lead's receiver;
 * `fallback` drops a `crm_receiver` record whose receiver was cleared back to phone evidence; null keeps it.
 * The Owner's assignment (including an Owner unassignment) is never touched. A `crm_receiver` record
 * tracks the current receiver and its source (its rank); any other origin yields only to a strictly
 * stronger rank, so phone evidence keeps a `ringcentral_answered` receiver out.
 */
export function receiverAssignmentPlan(record: Pick<RecordRow, "responsible_agent_id"> & { assignment?: { origin?: string | null; receiver_source?: string | null } | null },
  lead: Pick<ReceiverLead, "receiver_agent" | "receiver_agent_source">): "follow" | "fallback" | null {
  if (record.assignment?.origin === "owner") return null;
  const receiver = lead.receiver_agent ? String(lead.receiver_agent) : null;
  const source = lead.receiver_agent_source ?? null;
  if (!receiver) return record.assignment?.origin === "crm_receiver" ? "fallback" : null;
  if (record.assignment?.origin === "crm_receiver")
    return String(record.responsible_agent_id ?? "") !== receiver || (record.assignment.receiver_source ?? null) !== source ? "follow" : null;
  return mayReplaceAssignment(record, receiverRankKey(source)) ? "follow" : null;
}

/** The `crm_receiver` step of `ensureLead` (§3.2). Writes the record only when its rep or origin changes. */
async function followReceiver(record: RecordDoc, lead: ReceiverLead, context: CsiTransactionContext, changeId: string | null) {
  const plan = receiverAssignmentPlan(record, lead);
  const receiver = lead.receiver_agent ? String(lead.receiver_agent) : null;
  const source = lead.receiver_agent_source ?? null;
  const prior = record.toObject();
  if (plan === "follow" && receiver) {
    const evidence = changeId && mongoose.isValidObjectId(changeId) ? new mongoose.Types.ObjectId(changeId) : await latestReceiverChangeId(record, context.session);
    record.responsible_agent_id = new mongoose.Types.ObjectId(receiver);
    record.assignment = { origin: "crm_receiver", assigned_at: context.now, evidence_id: evidence, ...(source ? { receiver_source: source } : {}) };
  } else if (plan === "fallback") {
    const fallback = await phoneEvidenceAssignment(record, context.session);
    record.responsible_agent_id = fallback ? new mongoose.Types.ObjectId(fallback.agent_id) : null;
    record.assignment = fallback ? { origin: fallback.origin, assigned_at: fallback.at, evidence_id: fallback.evidence_id } : null;
  }
  if (plan) await refreshRecord(record, context, "outreach_receiver_assigned", prior, { receiver_agent: receiver, receiver_agent_source: source, trigger_change_id: changeId });
  if (plan || record.assignment?.origin === "crm_receiver") await followRecordRep(record, context, changeId);
}

/** The newest Lead change that wrote `receiver_agent` (the assignment's evidence when a repair job carries no change id). */
async function latestReceiverChangeId(record: RecordDoc, session: ClientSession) {
  if (record.subject.kind !== "lead" || !record.subject.model || !record.subject.id) return null;
  const change = await getEntityChangeModel().findOne({ "entity.model": record.subject.model, "entity.id": String(record.subject.id), changed_paths: "receiver_agent" })
    .sort({ applied_at: -1, _id: -1 }).select({ _id: 1 }).session(session).lean();
  return change?._id ?? null;
}

/**
 * When `receiver_agent` is cleared: the best phone evidence (E4's lower tier). The earlier of the first
 * attributable human conversation with one reviewed rep (bounded: the first `CONTACT_FACTS_SCAN` calls
 * since the trigger) and the earliest `rep_promise` with a promiser. Null when there is neither.
 */
export async function phoneEvidenceAssignment(record: RecordDoc | RecordRow, session: ClientSession) {
  const row = record as RecordRow;
  const candidates: Array<{ origin: "first_conversation" | "rep_promise"; agent_id: string; at: Date; evidence_id: mongoose.Types.ObjectId | null }> = [];
  if (row.primary_contact_number_id) {
    const calls = await getCallInteractionModel().find({ contact_number_id: row.primary_contact_number_id, merged_into_id: null, direction: { $in: ["Inbound", "Outbound"] },
      started_at: { $gte: row.trigger_at }, contact_type: "human_conversation" }).sort({ started_at: 1, _id: 1 }).limit(CONTACT_FACTS_SCAN).session(session).lean();
    for (const call of calls) {
      const reps = await mappedSalesReps(call, session);
      if (callFacts(row, call, await interactionAttribution(call, session), reps).human && reps.length === 1) {
        candidates.push({ origin: "first_conversation", agent_id: reps[0]!, at: call.started_at, evidence_id: call._id }); break;
      }
    }
  }
  const promise = await getOutreachFollowupModel().findOne({ outreach_record_id: row._id, origin: "rep_promise", promised_by_agent_id: { $ne: null } })
    .sort({ _id: 1 }).session(session).lean();
  if (promise?.promised_by_agent_id) candidates.push({ origin: "rep_promise", agent_id: String(promise.promised_by_agent_id),
    at: promise.date_resolution?.anchor ?? promise._id.getTimestamp(), evidence_id: promise.source_interaction_id ?? null });
  return candidates.sort((a, b) => +a.at - +b.at)[0] ?? null;
}

/**
 * §3.2 follow-ups (pure): an open action follows the record's rep when it has no agent (and no origin of its
 * own) or one inherited from the record. `rep_promise` and Owner actions, and a promise's retry chain, keep theirs.
 */
export function followsRecordRep(action: Pick<FollowupRow, "origin" | "responsible_agent_id" | "promised_by_agent_id" | "promise_chain"> & { assignment?: { origin?: string | null } | null }): boolean {
  if (action.origin === "rep_promise" || action.origin === "owner") return false;
  if (action.promised_by_agent_id || action.promise_chain?.root_id) return false;
  const origin = action.assignment?.origin ?? null;
  return origin === "inherited_outreach" || (!action.responsible_agent_id && !origin);
}

async function followRecordRep(record: RecordDoc, context: CsiTransactionContext, changeId: string | null) {
  const agent = record.responsible_agent_id ?? null;
  const key = subjectKey(record.subject);
  for (const action of await getOutreachFollowupModel().find({ outreach_record_id: record._id, status: "open" }).sort({ _id: 1 }).session(context.session)) {
    if (!followsRecordRep(action) || String(action.responsible_agent_id ?? "") === String(agent ?? "")) continue;
    const before = action.toObject();
    action.responsible_agent_id = agent;
    action.assignment = agent ? { origin: "inherited_outreach", assigned_at: context.now, evidence_id: changeId && mongoose.isValidObjectId(changeId) ? new mongoose.Types.ObjectId(changeId) : null } : null;
    await saveFollowup(action, before, context, key, "followup_receiver_inherited");
  }
}
