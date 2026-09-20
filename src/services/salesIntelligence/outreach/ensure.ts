import mongoose, { type ClientSession } from "mongoose";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { resolveRepIdentities } from "../repIdentity/resolve";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { csiWorkerActor } from "../auth";
import { appendCsiAudit, payloadHash, type CsiTransactionContext } from "../transactions";
import { resolvePolicy } from "../policy";
import { loadLead } from "../attachment/sources";
import { attachmentPolicyInput } from "../attachment/store";
import { resolveAtInteraction, type LeadRef } from "../attachment/suggest";
import { openReview } from "../review/items";
import { addStaffedMinutes } from "./staffing";
import { callFacts, fulfilledByCall, officialClosure } from "./transitions";
import { closeRecord, refreshRecord, saveFollowup } from "./store";
import { subjectKey, type InteractionRow } from "./types";
import { historicalCaptureReady, historicalAttachmentsReady } from "../backfill/readiness";

export function workerContext(session: ClientSession, requestId: string, now = new Date()): CsiTransactionContext {
  return { session, actor: csiWorkerActor(/^[a-f\d]{24}$/i.test(requestId) ? requestId : payloadHash(requestId).slice(0, 24)), command_id: new mongoose.Types.ObjectId(), now };
}
export async function ensureLead(ref: LeadRef, context: CsiTransactionContext, numberId?: string) {
  const lead = await loadLead(ref, context.session);
  if (!lead) return null;
  const Model = getOutreachRecordModel();
  let row = await Model.findOne({ "subject.kind": "lead", "subject.model": ref.model, "subject.id": ref.id }).session(context.session);
  const policy = await resolvePolicy();
  if (!row) {
    row = new Model({ subject: { kind: "lead", model: ref.model, id: ref.id }, trigger_kind: "lead_arrival", trigger_at: lead.timestamp,
      primary_contact_number_id: numberId ?? null, policy_version: policy.version,
      first_action_due_at: ref.model === "FormLead" ? addStaffedMinutes(lead.timestamp, policy.first_action_due_staffed_minutes, policy) : null,
      deadline_resolution: { precision: "exact", timezone: policy.timezone, assumption: "Staffed first-call deadline", anchor: lead.timestamp, policy_version: policy.version } });
    await refreshRecord(row, context, "outreach_created", null);
  } else if (numberId && !row.primary_contact_number_id) {
    const prior = row.toObject(); row.primary_contact_number_id = new mongoose.Types.ObjectId(numberId);
    await refreshRecord(row, context, "outreach_number_linked", prior);
  }
  const reason = officialClosure(lead);
  if (reason) await closeRecord(row, reason, "official", context);
  if (numberId) {
    const numberReview = await Model.findOne({ "subject.kind": "number_review", "subject.contact_number_id": numberId, state: { $ne: "closed" } }).session(context.session);
    if (numberReview) await closeRecord(numberReview, "lead_context_available", "official", context);
  }
  return row;
}
export async function interactionAttribution(call: InteractionRow, session: ClientSession) {
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: call.contact_number_id }).session(session).lean();
  return resolveAtInteraction(edges.map(attachmentPolicyInput), { id: String(call._id), provider_account_id: call.provider_account_id, started_at: call.started_at,
    telephony_session_id: call.telephony_session_id, session_id: call.session_id, call_log_ids: call.call_log_ids });
}
/** Read-only consumption of reviewed effective-dated identities; CSI-10 owns their creation/review. */
export async function mappedSalesReps(call: InteractionRow, session: ClientSession): Promise<string[]> {
  return (await interactionRepIdentity(call, session)).agent_ids;
}
export async function interactionRepIdentity(call: InteractionRow, session: ClientSession) {
  const ids = call.parties.filter(p => p.role === "user" && p.extension_id && p.connected).map(p => p.extension_id!);
  const resolved = await resolveRepIdentities(call.provider_account_id, ids, call.started_at, session);
  // One known participant beside an unknown/conflicting participant is not a reliably identified sole rep.
  if (resolved.resolutions.some(r => ["unknown", "proposed_only", "conflicting"].includes(r.status))) resolved.agent_ids = [];
  return resolved;
}
export async function ensureInteraction(call: InteractionRow, context: CsiTransactionContext) {
  if ("purged_at" in call && call.purged_at) return null;
  if (call.sources.includes("backfill") && (!await historicalCaptureReady(call.started_at, context.session) ||
    !await historicalAttachmentsReady(String(call.contact_number_id), context.session))) return null;
  if (!call.contact_number_id || call.direction === "Internal" || call.monitoring) return null;
  const numberId = String(call.contact_number_id), key = `number:${numberId}`;
  const number = await getContactNumberModel().findById(numberId).session(context.session).lean();
  if (!number || number.kind !== "external" || ["company", "non_customer"].includes(number.classification)) return null;
  const attribution = await interactionAttribution(call, context.session);
  const policy = await resolvePolicy();
  const missed = call.direction === "Inbound" && call.terminal && !call.provider_connected && call.contact_type !== "human_conversation";
  let record = attribution.lead_ref ? await ensureLead(attribution.lead_ref, context, numberId) : null;
  if (!attribution.lead_effects_allowed && attribution.blocked_reason !== "unlinked") {
    await openReview(context, key, "identity", numberId, [String(call._id)]);
    for (const ref of attribution.applicable_leads) {
      const blocked = await ensureLead(ref, context, numberId);
      if (blocked && !["closed", "identity_review"].includes(blocked.state)) {
        const prior = blocked.toObject(); blocked.state_before_identity_review = blocked.state; blocked.state = "identity_review";
        await refreshRecord(blocked, context, "identity_blocked", prior);
      }
    }
    return null;
  }
  if (!record && attribution.blocked_reason === "unlinked") {
    // Related official closure must not be escaped via a Number Review, including outside matching windows.
    const related = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId, state: { $ne: "rejected" } }).session(context.session).lean();
    for (const edge of related) {
      const lead = await loadLead({ model: edge.lead_ref.model, id: String(edge.lead_ref.id) }, context.session);
      const closed = await getOutreachRecordModel().findOne({ "subject.model": edge.lead_ref.model, "subject.id": edge.lead_ref.id, state: "closed" }).session(context.session).lean();
      if (closed || (lead && officialClosure(lead))) {
        if (missed && (!closed?.closed_at || call.started_at > closed.closed_at))
          await openReview(context, closed ? subjectKey(closed.subject) : key, "closed_work_request", String(call._id), [String(call._id)]);
        return null;
      }
    }
    record = await getOutreachRecordModel().findOne({ "subject.kind": "number_review", "subject.contact_number_id": numberId }).session(context.session);
    if (!record && missed && call.inbound_route_id && number.contact_eligibility.state !== "suppressed") {
      record = new (getOutreachRecordModel())({ subject: { kind: "number_review", contact_number_id: numberId }, primary_contact_number_id: numberId,
        trigger_kind: "unanswered_inbound", trigger_at: call.started_at, policy_version: policy.version });
      await refreshRecord(record, context, "number_review_opened", null);
    }
  }
  if (!record) return null;
  const recordKey = subjectKey(record.subject);
  const repIdentity = await interactionRepIdentity(call, context.session);
  const previousCall = await getSalesIntelligenceAuditEventModel().exists({ subject_key: recordKey, event_kind: "outreach_call_applied",
    "current.interaction_id": String(call._id), "current.projection_revision": call.projection_revision }).session(context.session);
  const seen = await getSalesIntelligenceAuditEventModel().exists({ subject_key: recordKey, event_kind: "outreach_call_applied",
    "current.interaction_id": String(call._id), "current.projection_revision": call.projection_revision,
    "current.rep_identity_fingerprint": repIdentity.fingerprint }).session(context.session);
  if (record.state === "closed") {
    if (missed && (!record.closed_at || call.started_at > record.closed_at)) await openReview(context, recordKey, "closed_work_request", String(call._id), [String(call._id)]);
    return record;
  }
  if (record.state === "identity_review" && attribution.lead_effects_allowed) {
    const before = record.toObject();
    record.state = record.state_before_identity_review ?? "unworked"; record.state_before_identity_review = null;
    await refreshRecord(record, context, "identity_resolved", before);
  }
  if (seen) return record;
  const prior = record.toObject(), reps = repIdentity.agent_ids;
  const facts = callFacts(record, call, attribution, reps);
  if (!facts.identityAllowed) return record;
  if (facts.outboundAttempt || facts.human) {
    if (record.state === "unworked") record.state = "open";
    if (facts.outboundAttempt && (!record.first_attributable_outbound_at || record.first_attributable_outbound_at > call.started_at)) record.first_attributable_outbound_at = call.started_at;
    if (facts.human) {
      if (!record.first_human_conversation_at || record.first_human_conversation_at > call.started_at) record.first_human_conversation_at = call.started_at;
      if (!record.last_meaningful_contact_at || record.last_meaningful_contact_at < call.started_at) record.last_meaningful_contact_at = call.started_at;
      if (!record.responsible_agent_id && record.assignment?.origin !== "owner" && reps.length === 1) {
        record.responsible_agent_id = new mongoose.Types.ObjectId(reps[0]); record.assignment = { origin: "first_conversation", assigned_at: call.started_at, evidence_id: call._id };
      }
    }
  }
  if (call.contact_type_basis === "owner" || previousCall) {
    const calls = await getCallInteractionModel().find({ contact_number_id: call.contact_number_id, merged_into_id: null, started_at: { $gte: record.trigger_at }, contact_type: "human_conversation" }).sort({ started_at: 1 }).session(context.session).lean();
    const humanDates: Date[] = [];
    for (const candidate of calls) if (callFacts(record, candidate, await interactionAttribution(candidate, context.session), await mappedSalesReps(candidate, context.session)).human) humanDates.push(candidate.started_at);
    record.first_human_conversation_at = humanDates[0] ?? null; record.last_meaningful_contact_at = humanDates.at(-1) ?? null;
    if (!humanDates.length && !record.first_attributable_outbound_at && record.state === "open" &&
      !await getSalesIntelligenceOwnerInstructionModel().exists({ subject_key: recordKey, field: "status", followup_id: null }).session(context.session)) record.state = "unworked";
  }
  const actions = await getOutreachFollowupModel().find({ outreach_record_id: record._id, status: "open" }).session(context.session);
  let waitOwner: mongoose.Types.ObjectId | null = null;
  const waits = actions.filter(a => a.kind === "wait" && fulfilledByCall(a, call, facts));
  const callbacks = actions.filter(a => a.kind === "call" && !a.missed_episode_key && fulfilledByCall(a, call, facts));
  for (const action of actions) {
    if (!fulfilledByCall(action, call, facts) || (action.kind === "wait" && waits.length !== 1)) continue;
    if (action.kind === "call" && !action.missed_episode_key && callbacks.length !== 1) continue;
    const before = action.toObject();
    if (action.kind === "wait") waitOwner = action.responsible_agent_id ?? null;
    action.status = "completed"; action.disposition = action.kind === "wait" ? "customer_called" : facts.outcome;
    action.completion_basis = "call_attempt"; action.completed_at = call.started_at; action.evidence_interaction_id = call._id; action.snoozed_until = null;
    await saveFollowup(action, before, context, recordKey, "call_fulfilled_action");
  }
  if (waits.length > 1) await openReview(context, recordKey, "completion_target", `wait:${call._id}`, [String(call._id)]);
  if (callbacks.length > 1) await openReview(context, recordKey, "completion_target", `callback:${call._id}`, [String(call._id)]);
  // Identity-only replay can fulfill still-open work, but cannot recreate an already applied missed-call episode.
  if (missed && call.inbound_route_id && !previousCall) {
    const episodeKey = numberId;
    let episode = actions.find(a => a.status === "open" && a.missed_episode_key === episodeKey);
    const before = episode?.toObject() ?? null;
    if (!episode) episode = new (getOutreachFollowupModel())({ outreach_record_id: record._id, commitment_key: `missed:${record._id}:${call._id}`,
      kind: "call", description: "Return missed customer call", origin: "system_default", requested_by: "customer", missed_episode_key: episodeKey,
      first_missed_at: call.started_at, due_at: addStaffedMinutes(call.started_at, policy.missed_callback_due_staffed_minutes, policy),
      date_resolution: { precision: "exact", timezone: policy.timezone, assumption: "Staffed missed-call deadline", anchor: call.started_at, policy_version: policy.version },
      responsible_agent_id: waitOwner ?? record.responsible_agent_id,
      assignment: { origin: "inherited_outreach", assigned_at: context.now, evidence_id: call._id } });
    else if (episode.first_missed_at && episode.first_missed_at > call.started_at) {
      // Out-of-order earlier miss moves the episode earlier, never later; preserve Owner date correction.
      episode.first_missed_at = call.started_at;
      if (!episode.owner_instruction_ids.length) episode.due_at = addStaffedMinutes(call.started_at, policy.missed_callback_due_staffed_minutes, policy);
    }
    if (!episode.trigger_interaction_ids.some(id => String(id) === String(call._id))) episode.trigger_interaction_ids.push(call._id);
    if (!episode.base_attention_due_at || (episode.due_at && episode.due_at < episode.base_attention_due_at)) episode.base_attention_due_at = episode.due_at;
    await saveFollowup(episode, before, context, recordKey, "missed_call_episode");
    // An older miss arriving after its callback must not resurrect already fulfilled work.
    const later = await getCallInteractionModel().find({ contact_number_id: call.contact_number_id, merged_into_id: null, started_at: { $gt: call.started_at }, terminal: true }).sort({ started_at: 1 }).session(context.session).lean();
    for (const next of later) {
      const nextFacts = callFacts(record, next, await interactionAttribution(next, context.session), await mappedSalesReps(next, context.session));
      if (!fulfilledByCall(episode, next, nextFacts)) continue;
      const old = episode.toObject(); episode.status = "completed"; episode.disposition = nextFacts.outcome;
      episode.completed_at = next.started_at; episode.completion_basis = "call_attempt"; episode.evidence_interaction_id = next._id;
      await saveFollowup(episode, old, context, recordKey, "historical_missed_fulfilled"); break;
    }
  }
  await refreshRecord(record, context, "outreach_interaction", prior);
  await appendCsiAudit(context, { kind: "interaction", subject_key: recordKey, target_id: String(call._id), revision: call.projection_revision,
    happened_at: call.started_at,
    event_kind: "outreach_call_applied", prior: {}, current: { interaction_id: String(call._id), projection_revision: call.projection_revision,
      rep_identity_fingerprint: repIdentity.fingerprint, happened_at: call.started_at.toISOString(), ...facts } });
  return record;
}
/** Same-transaction reaction to CSI-05. Recheck official closure BEFORE identity state restoration. */
export async function reactToAttachmentChanged(change: { number_id: string; revision: number }, session: ClientSession) {
  if (!csiFlag("OUTREACH_ENSURE")) return;
  const context = workerContext(session, `attachment:${change.number_id}:${change.revision}`);
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: change.number_id }).session(session).lean();
  const latest = await getCallInteractionModel().findOne({ contact_number_id: change.number_id, merged_into_id: null }).sort({ started_at: -1, _id: -1 }).session(session).lean();
  if (latest?.sources.includes("backfill") && (!await historicalCaptureReady(latest.started_at, session) ||
    !await historicalAttachmentsReady(change.number_id, session))) return;
  for (const edge of edges) {
    const record = await ensureLead({ model: edge.lead_ref.model, id: String(edge.lead_ref.id) }, context, change.number_id);
    if (!record || record.state === "closed") continue;
    const identity = latest ? { ...latest, id: String(latest._id) } : { id: "", provider_account_id: "", call_log_ids: [], started_at: record.trigger_at };
    const attribution = resolveAtInteraction(edges.map(attachmentPolicyInput), identity);
    const blocked = ["ambiguous_attachment", "competing_attached"].includes(attribution.blocked_reason ?? "");
    const prior = record.toObject();
    if (blocked && record.state !== "identity_review") { record.state_before_identity_review = record.state; record.state = "identity_review"; }
    else if (!blocked && record.state === "identity_review") { record.state = record.state_before_identity_review ?? "unworked"; record.state_before_identity_review = null; }
    if (prior.state !== record.state) await refreshRecord(record, context, "attachment_identity_changed", prior);
  }
  if (latest) await ensureInteraction(latest, context);
}
