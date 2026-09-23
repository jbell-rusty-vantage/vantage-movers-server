import mongoose from "mongoose";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getSalesIntelligenceCommandExecutionModel } from "../../../models/SalesIntelligenceCommandExecution";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { csiCommandSchema, csiIdSchema, type CsiCommand } from "../../../validation/v1/salesIntelligence";
import { assertTrustedActor, CsiError, type CsiActor } from "../auth";
import { executeCsiCommand, appendCsiAudit, type CsiTransactionContext } from "../transactions";
import { resolvePolicy } from "../policy";
import { loadLead } from "../attachment/sources";
import { lockNumber, attachmentPolicyInput } from "../attachment/store";
import { resolveAtInteraction } from "../attachment/suggest";
import { ensureInteraction } from "../outreach/ensure";
import { authoritativeClosure } from "../outreach/transitions";
import { isTerminal, type LeadProgressRow } from "../outreach/leadProgress";
import { subjectKey, type RecordRow } from "../outreach/types";
import { auditChange, closeRecord, ownerInstruction, recordForUpdate, refreshRecord, saveFollowup, jsonValue, queueNumberRollupRebuild } from "../outreach/store";
import { enqueueCsiJob } from "../jobs";
import { ensureNumberReview } from "../outreach/numberReview";

export const OUTREACH_COMMANDS = ["mark_worked", "assign", "set_waiting", "start_call", "end_call", "add_note", "close", "reopen", "override_disposition", "create_followup", "patch_followup", "complete_followup", "snooze_followup", "cancel_followup", "resolve_restriction", "resolve_review", "set_contact_type", "open_number_review"] as const;
type ActionInput = Extract<CsiCommand, { command: "create_followup" }>["action"];
export async function createOwnerFollowup(record: Awaited<ReturnType<typeof recordForUpdate>>, input: ActionInput, context: CsiTransactionContext, suffix = "action") {
  const policy = await resolvePolicy();
  const due = input.due_at ? new Date(input.due_at) : null;
  const agent = input.responsible_agent_id === undefined ? record.responsible_agent_id : input.responsible_agent_id;
  const row = new (getOutreachFollowupModel())({ outreach_record_id: record._id, commitment_key: `owner:${context.command_id}:${suffix}`,
    kind: input.kind, description: input.description, due_at: due, base_attention_due_at: due, date_text: input.date_note ?? null,
    date_resolution: { precision: due ? "exact" : "unresolved", timezone: policy.timezone, anchor: context.now, policy_version: policy.version },
    origin: "owner", requested_by: "owner", responsible_agent_id: agent,
    assignment: { origin: input.responsible_agent_id === undefined ? "inherited_outreach" : "owner", actor_id: context.actor.id, assigned_at: context.now } });
  const instruction = await ownerInstruction(context, record, "status", null, { created: true }, String(row._id));
  row.owner_instruction_ids.push(instruction);
  await saveFollowup(row, null, context, subjectKey(record.subject), "owner_followup_created");
  return row;
}
async function validateFences(command: CsiCommand, record: RecordRow, action: { _id: unknown; revision: number } | null) {
  for (const fence of command.expected_revisions ?? []) {
    const actual = fence.target === "outreach" && fence.id === String(record._id) ? record : fence.target === "followup" && fence.id === String(action?._id) ? action : null;
    if (!actual) throw new CsiError("INVALID_INPUT");
    if (actual.revision !== fence.revision) throw new CsiError("REVISION_CONFLICT");
  }
}
/** D's correction/retract routes may call this inside their command transaction, with a trusted Owner. */
export async function applyOwnerCommandInTransaction(targetId: string, command: CsiCommand, context: CsiTransactionContext): Promise<import("../outreach/store").JsonValue> {
  assertTrustedActor(context.actor, "owner");
  csiIdSchema.parse(targetId);
  if (!csiFlag("ENABLED") || !csiFlag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
  if (!(OUTREACH_COMMANDS as readonly string[]).includes(command.command)) throw new CsiError("INVALID_INPUT");
  if (command.command === "open_number_review") {
    const number = await getContactNumberModel().findById(targetId).session(context.session);
    if (!number || number.revision !== command.expected_revision) throw new CsiError("REVISION_CONFLICT");
    if (command.expected_revisions?.length) throw new CsiError("INVALID_INPUT");
    const record = await ensureNumberReview(targetId, "owner_open", context);
    return { id: String(record._id), revision: record.revision };
  }
  if (["set_contact_type", "resolve_restriction", "resolve_review"].includes(command.command)) return applyEvidenceCommand(targetId, command, context);
  const isAction = ["patch_followup", "complete_followup", "snooze_followup", "cancel_followup"].includes(command.command);
  const action = isAction ? await getOutreachFollowupModel().findById(targetId).session(context.session) : null;
  if (isAction && !action) throw new CsiError("INVALID_INPUT");
  const recordId = action ? String(action.outreach_record_id) : command.command === "create_followup" ? command.outreach_record_id : targetId;
  const record = await recordForUpdate(recordId, context, action ? undefined : command.expected_revision);
  if (action && action.revision !== command.expected_revision) throw new CsiError("REVISION_CONFLICT");
  await validateFences(command, record, action);
  const prior = record.toObject(), key = subjectKey(record.subject);
  if (record.subject.kind === "lead") {
    const ref = { model: record.subject.model!, id: String(record.subject.id) };
    const lead = await loadLead(ref, context.session);
    // §11.1: an exact Booking relationship rejects the command even when the Lead mirror is delayed.
    const reason = lead ? await authoritativeClosure(lead, ref, context.session) : "lead_unavailable";
    if (reason) {
      await closeRecord(record, reason, "official", context);
      if (command.command !== "add_note") return { id: recordId, revision: record.revision, blocked: "official_closure", reason };
    }
  }
  if (record.state === "closed" && !["reopen", "add_note", "close", "override_disposition"].includes(command.command)) throw new CsiError("ILLEGAL_TRANSITION");
  const progress = record.lead_progress as LeadProgressRow | null;
  const terminalNow = Boolean(progress && isTerminal(progress.disposition) && progress.provenance === "accepted" && !progress.override);
  // A terminal CRM disposition that is not overridden blocks new sales execution on an open record too (§3.3 guards).
  if (terminalNow && record.state !== "closed" && ["create_followup", "set_waiting", "start_call", "mark_worked"].includes(command.command)) throw new CsiError("CRM_DISPOSITION_CLOSED");
  if (progress && record.state !== "closed" && await getSalesIntelligenceReviewItemModel().exists({ subject_key: key, cause_kind: "disposition_review", state: "open" }).session(context.session) &&
    ["create_followup", "set_waiting", "start_call"].includes(command.command)) throw new CsiError("DISPOSITION_REVIEW");
  if (command.command === "close") {
    await ownerInstruction(context, record, "closure", prior, { reason: command.reason });
    await closeRecord(record, command.reason, "owner", context, { note: command.note ?? null });
    if (command.reason === "suppressed" && record.primary_contact_number_id) {
      const lock = await lockNumber(String(record.primary_contact_number_id), context.session);
      await getContactNumberModel().updateOne({ _id: record.primary_contact_number_id }, { $set: { contact_eligibility: { state: "suppressed", reason: command.note ?? command.reason, set_by: context.actor.id, set_at: context.now } } }, { session: context.session });
      await appendCsiAudit(context, { kind: "number", target_id: String(record.primary_contact_number_id), subject_key: `number:${record.primary_contact_number_id}`,
        revision: lock.revision, event_kind: "owner_permanent_suppression", prior: {}, current: { state: "suppressed", reason: command.note ?? command.reason } });
    }
    return { id: recordId, revision: record.revision, state: record.state };
  }
  if (command.command === "reopen" || command.command === "override_disposition") {
    if (command.command === "override_disposition") {
      // §3.3: explicit, audited, revision-scoped. Identical redelivery keeps it; a semantic change expires it.
      if (!csiFlag("LEAD_PROGRESS")) throw new CsiError("FEATURE_DISABLED");
      if (!progress) throw new CsiError("ILLEGAL_TRANSITION");
      if (progress.disposition_revision !== command.disposition_revision) throw new CsiError("REVISION_CONFLICT");
      if (!terminalNow) throw new CsiError("ILLEGAL_TRANSITION");
      if (record.state === "closed" && record.closure_origin !== "crm_disposition") throw new CsiError("ILLEGAL_TRANSITION");
    } else {
      if (record.state !== "closed") throw new CsiError("ILLEGAL_TRANSITION");
      // Work closed by the CRM disposition stays closed until the disposition moved on; otherwise the Owner overrides explicitly.
      if (record.closure_origin === "crm_disposition" && terminalNow && !progress?.reopen_review_id) throw new CsiError("CRM_DISPOSITION_CLOSED");
    }
    const number = record.primary_contact_number_id ? await getContactNumberModel().findById(record.primary_contact_number_id).session(context.session).lean() : null;
    if (number?.contact_eligibility.state === "suppressed" || (number && ["company", "non_customer"].includes(number.classification))) throw new CsiError("ILLEGAL_TRANSITION");
    // A suppression on any attached Number, not only the primary, keeps CRM-closed work closed.
    if (record.subject.kind === "lead") {
      const attachedNumbers = (await getNumberLeadAttachmentModel().find({ "lead_ref.model": record.subject.model, "lead_ref.id": record.subject.id, state: "attached" }).select({ contact_number_id: 1 }).session(context.session).lean()).map(e => e.contact_number_id);
      if (attachedNumbers.length && await getContactNumberModel().exists({ _id: { $in: attachedNumbers }, "contact_eligibility.state": "suppressed" }).session(context.session)) throw new CsiError("ILLEGAL_TRANSITION");
    }
    const wasClosed = record.state === "closed";
    if (wasClosed) { record.state = "open"; record.closed_at = null; record.closed_reason = null; record.closed_by = null; record.closure_origin = null; record.state_before_identity_review = null; }
    if (wasClosed && record.primary_contact_number_id) {
      const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: record.primary_contact_number_id }).session(context.session).lean();
      const latest = await getCallInteractionModel().findOne({ contact_number_id: record.primary_contact_number_id, merged_into_id: null }).sort({ started_at: -1 }).session(context.session).lean();
      const identity = latest ? { ...latest, id: String(latest._id) } : { id: "", provider_account_id: "", call_log_ids: [], started_at: record.trigger_at };
      if (["ambiguous_attachment", "competing_attached"].includes(resolveAtInteraction(edges.map(attachmentPolicyInput), identity).blocked_reason ?? "")) {
        record.state = "identity_review"; record.state_before_identity_review = "open";
      }
    }
    const instruction = await ownerInstruction(context, record, "closure", prior, command.command === "override_disposition"
      ? { state: record.state, override: true, reason: command.reason, disposition_revision: command.disposition_revision } : { state: "open", reason: command.reason });
    if (progress) {
      const next: LeadProgressRow = { ...progress, reopen_review_id: null, override: command.command === "override_disposition"
        ? { reason: command.reason, instruction_id: instruction, disposition_revision: command.disposition_revision, decided_at: context.now, decided_by: context.actor.id } : progress.override };
      record.lead_progress = next;
      // The reopen review is answered by this explicit Owner decision.
      for (const review of await getSalesIntelligenceReviewItemModel().find({ subject_key: key, cause_kind: "disposition_reopen", state: "open" }).session(context.session)) {
        review.state = "resolved"; review.resolution_actor = { ...context.actor, run_id: null }; review.resolved_at = context.now; review.resolution_reason = command.command; review.revision++;
        await review.save({ session: context.session });
      }
    }
  } else if (command.command === "mark_worked") {
    if (record.state === "identity_review") record.state_before_identity_review = "open";
    if (record.state === "unworked") record.state = "open";
    await ownerInstruction(context, record, "status", prior.state, { state: record.state, note: command.note ?? null });
  } else if (command.command === "assign") {
    const instruction = await ownerInstruction(context, record, "assignment", record.responsible_agent_id, command.responsible_agent_id);
    record.responsible_agent_id = command.responsible_agent_id ? new mongoose.Types.ObjectId(command.responsible_agent_id) : null;
    record.assignment = { origin: "owner", assigned_at: context.now, actor_id: context.actor.id, instruction_id: instruction };
  } else if (command.command === "add_note") {
    await ownerInstruction(context, record, "description", null, { note: command.text });
  } else if (command.command === "set_waiting") {
    if (new Date(command.until) <= context.now || record.state === "identity_review") throw new CsiError("INVALID_INPUT");
    await createOwnerFollowup(record, { kind: "wait", description: command.reason, due_at: command.until }, context);
    if (record.state === "unworked") record.state = "open";
  } else if (command.command === "start_call" || command.command === "end_call") {
    // Call progress is its own field: `record_closed` is already rejected above, and the
    // remaining blockers are an in-flight call and the restriction that gates calling.
    if (command.command === "start_call") {
      if (record.call_progress?.state === "in_progress") throw new CsiError("ILLEGAL_TRANSITION");
      if (record.primary_contact_number_id && await getSalesIntelligenceContactRestrictionModel().exists({ contact_number_id: record.primary_contact_number_id,
        state: "active", channels: "call", $or: [{ until: null }, { until: { $gt: context.now } }] }).session(context.session)) throw new CsiError("CONTACT_RESTRICTED");
      // Starting again after an ended call replaces the field; the audit stream is the history.
      record.call_progress = { state: "in_progress", started_at: context.now, started_by: context.actor.id,
        ended_at: null, ended_by: null, note: command.note ?? null, interaction_id: null };
    } else {
      if (record.call_progress?.state !== "in_progress") throw new CsiError("ILLEGAL_TRANSITION");
      record.call_progress.state = "ended"; record.call_progress.ended_at = context.now; record.call_progress.ended_by = context.actor.id;
      if (command.note) record.call_progress.note = command.note;
    }
    await ownerInstruction(context, record, "status", prior.call_progress ?? null, record.call_progress);
  } else if (command.command === "create_followup") {
    await createOwnerFollowup(record, command.action, context);
  } else if (action) {
    if (action.status !== "open") throw new CsiError("ILLEGAL_TRANSITION");
    const before = action.toObject();
    if (command.command === "patch_followup") {
      for (const [field, value] of Object.entries(command.changes)) {
        if (field === "date_note") { action.date_text = String(value); continue; }
        const instructionField = field === "responsible_agent_id" ? "assignment" : field as "due_at" | "description" | "kind";
        const instruction = await ownerInstruction(context, record, instructionField, before, value, String(action._id));
        action.owner_instruction_ids.push(instruction);
        if (field === "responsible_agent_id") { action.responsible_agent_id = value ? new mongoose.Types.ObjectId(String(value)) : null; action.assignment = { origin: "owner", actor_id: context.actor.id, assigned_at: context.now, instruction_id: instruction }; }
        else if (field === "due_at") { action.due_at = value ? new Date(String(value)) : null; action.base_attention_due_at = action.due_at; action.snoozed_until = null; action.wait_expired_at = null; }
        else action.set(field, value);
      }
    } else if (command.command === "snooze_followup") {
      if (!action.due_at || new Date(command.until) <= context.now) throw new CsiError("INVALID_INPUT");
      action.snoozed_until = new Date(command.until);
      action.owner_instruction_ids.push(await ownerInstruction(context, record, "due_at", before, { snoozed_until: command.until, due_at: action.due_at.toISOString() }, String(action._id)));
    } else if (command.command === "complete_followup" || command.command === "cancel_followup") {
      action.status = command.command === "complete_followup" ? "completed" : "cancelled"; action.snoozed_until = null;
      if (command.command === "complete_followup") {
        action.disposition = command.disposition; action.completion_basis = "owner"; action.completed_at = context.now; action.completed_by = context.actor.id;
        if (command.next) await createOwnerFollowup(record, command.next, context, "next");
      } else action.cancel_reason = command.reason;
      action.owner_instruction_ids.push(await ownerInstruction(context, record, "status", before.status, action.status, String(action._id)));
    }
    await saveFollowup(action, before, context, key, command.command);
  }
  await refreshRecord(record, context, command.command, prior, {
    ...(command.command === "add_note" ? { note: command.text } : "note" in command ? { note: command.note ?? null } : {}),
    ...("reason" in command ? { reason: command.reason ?? null } : {}),
  });
  await enqueueCsiJob({ stage: "number_refresh", subject_key: key, input_revision: record.revision, dedupe_key: `csi:owner-outreach:${context.command_id}`, input_refs: [recordId] }, context.session);
  return { id: action ? String(action._id) : recordId, revision: action?.revision ?? record.revision, outreach_revision: record.revision, state: record.state };
}
async function applyEvidenceCommand(id: string, command: CsiCommand, context: CsiTransactionContext): Promise<import("../outreach/store").JsonValue> {
  if (command.expected_revisions?.length) throw new CsiError("INVALID_INPUT");
  if (command.command === "set_contact_type") {
    const call = await getCallInteractionModel().findById(id).session(context.session);
    if (!call || call.projection_revision !== command.expected_revision) throw new CsiError("REVISION_CONFLICT");
    const prior = { contact_type: call.contact_type, contact_type_basis: call.contact_type_basis };
    call.contact_type = command.contact_type; call.contact_type_basis = "owner"; call.projection_revision++;
    await call.save({ session: context.session });
    await queueNumberRollupRebuild(call, prior.contact_type, call.contact_type, context.session);
    await getSalesIntelligenceOwnerInstructionModel().create([{ instruction_id: new mongoose.Types.ObjectId(), subject_key: `number:${call.contact_number_id}`, field: "contact_type",
      prior, current: { contact_type: call.contact_type, interaction_id: id, reason: command.reason }, actor: context.actor, happened_at: context.now, state: "active" }], { session: context.session });
    await auditChange(context, "interaction", `number:${call.contact_number_id}`, { _id: id, revision: call.projection_revision }, prior, { contact_type: call.contact_type, reason: command.reason }, "owner_contact_type");
    await ensureInteraction(call, { ...context, command_id: new mongoose.Types.ObjectId() });
    return { id, revision: call.projection_revision };
  }
  if (command.command === "resolve_restriction") {
    const row = await getSalesIntelligenceContactRestrictionModel().findById(id).session(context.session);
    if (!row || row.revision !== command.expected_revision) throw new CsiError("REVISION_CONFLICT");
    await lockNumber(String(row.contact_number_id), context.session);
    const prior = row.toObject(); row.channels = command.channels; row.until = command.until ? new Date(command.until) : null;
    row.state = command.resolution === "lift" ? "resolved" : "active"; row.resolution_actor = { ...context.actor, run_id: null };
    row.resolved_at = context.now; row.resolution_reason = command.reason; row.revision++;
    await row.save({ session: context.session });
    await auditChange(context, "restriction", `number:${row.contact_number_id}`, row, prior, row.toObject(), "restriction_resolved");
    return { id, revision: row.revision, state: row.state };
  }
  if (command.command === "resolve_review") {
    const row = await getSalesIntelligenceReviewItemModel().findById(id).session(context.session);
    if (!row || row.revision !== command.expected_revision) throw new CsiError("REVISION_CONFLICT");
    // Dismissal never substitutes for attachment/restriction resolution; those services own blockers.
    if (row.cause_kind === "restriction") {
      const restriction = await getSalesIntelligenceContactRestrictionModel().findById(row.cause_key).session(context.session);
      if (restriction?.state === "active" && (!restriction.until || restriction.until > context.now)) throw new CsiError("ILLEGAL_TRANSITION");
    }
    if (row.cause_kind === "identity") {
      const numberId = row.subject_key.startsWith("number:") ? row.subject_key.slice(7) : null;
      const lead = /^lead:(FormLead|CallLead):([a-fA-F0-9]{24})$/.exec(row.subject_key);
      if (!numberId && !lead) throw new CsiError("ILLEGAL_TRANSITION");
      const leadModel = lead?.[1] === "FormLead" ? "FormLead" as const : "CallLead" as const;
      const subjectFilter = numberId ? { primary_contact_number_id: numberId } : { "subject.model": leadModel, "subject.id": lead![2] };
      const attachmentFilter = numberId ? { contact_number_id: numberId } : { "lead_ref.model": leadModel, "lead_ref.id": lead![2] };
      if (await getOutreachRecordModel().exists({ ...subjectFilter, state: "identity_review" }).session(context.session) ||
        await getNumberLeadAttachmentModel().exists({ ...attachmentFilter, state: "ambiguous" }).session(context.session)) throw new CsiError("ILLEGAL_TRANSITION");
    }
    if (command.resolution === "command_completed" && (!command.completed_command_id || !await getSalesIntelligenceCommandExecutionModel().exists({ _id: command.completed_command_id, "actor.id": context.actor.id }).session(context.session))) throw new CsiError("INVALID_INPUT");
    const prior = row.toObject(); row.state = command.resolution === "no_action" ? "dismissed" : "resolved";
    row.resolution_actor = { ...context.actor, run_id: null }; row.resolved_at = context.now; row.resolution_reason = command.reason; row.revision++;
    await row.save({ session: context.session });
    await appendCsiAudit(context, { kind: "review", target_id: id, subject_key: row.subject_key, revision: row.revision, event_kind: "review_resolved", prior: jsonValue(prior), current: jsonValue(row.toObject()) });
    return { id, revision: row.revision, state: row.state };
  }
  throw new CsiError("INVALID_INPUT");
}
export async function commandOutreach(input: { actor: CsiActor; idempotency_key: string; target_id: string; command: CsiCommand }) {
  const command = csiCommandSchema.parse(input.command);
  return executeCsiCommand({ actor: input.actor, idempotency_key: input.idempotency_key, command: command.command,
    payload: { target_id: input.target_id, command }, operation: context => applyOwnerCommandInTransaction(input.target_id, command, context) });
}

