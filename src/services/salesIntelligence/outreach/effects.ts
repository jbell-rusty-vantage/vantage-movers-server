import mongoose from "mongoose";
import { z } from "zod";
import { csiFlag, CSI_ACTION_KINDS } from "../../../config/domain/salesIntelligence";
import { csiIdSchema as id, csiDateSchema as date } from "../../../validation/v1/salesIntelligence";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { CsiError, assertTrustedActor } from "../auth";
import { payloadHash, type CsiTransactionContext } from "../transactions";
import { resolvePolicy } from "../policy";
import { openReview } from "../review/items";
import { ensureLead, ensureInteraction, interactionAttribution, mappedSalesReps } from "./ensure";
import { subjectKey, type RecordRow, type FollowupRow } from "./types";
import { callFacts, fulfilledByCall } from "./transitions";
import { resolveActionDate, resolveActionDateText } from "./staffing";
import { recordForUpdate, refreshRecord, saveFollowup, jsonValue } from "./store";
import { applySpokenRestriction } from "../review/restrictions";

/** Server-resolved intent, never an HTTP/model write schema. D validates snapshots and resolves date wording first. */
export const outreachEffectInputSchema = z.object({ run_id: id, finding_id: id, finding_key: z.string().min(1), outreach_record_id: id,
  interaction_id: id, expected_revision: z.number().int().positive(), expected_action_revision: z.number().int().positive().optional(),
  kind: z.enum(["create_followup", "revise_followup", "complete_followup", "pause_channel", "set_contact_type", "open_review"]),
  target_followup_id: id.nullable().default(null), action_kind: z.enum(CSI_ACTION_KINDS).optional(), description: z.string().min(1).max(500).optional(),
  origin: z.enum(["rep_promise", "customer_request", "customer_wait"]).optional(), date: z.object({ exact: date.optional(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict().optional(),
  date_text: z.string().max(120).nullable().optional(), promising_agent_id: id.nullable().optional(),
  contact_type: z.enum(["human_conversation", "voicemail", "unknown"]).optional(), channels: z.array(z.enum(["call", "text"])).min(1).max(2).optional(),
  clear: z.boolean(), history_complete: z.boolean(), model_strategy: z.boolean().default(false) }).strict();
export type OutreachEffectInput = z.infer<typeof outreachEffectInputSchema>;
export type EffectPlan = { status: "applied" | "no_change" | "blocked_owner" | "blocked_identity" | "blocked_closed" | "needs_review" | "stale"; reason: string };
function contactTypePlan(input: { clear: boolean; model_strategy: boolean }, owner: boolean, changed: boolean): EffectPlan {
  if (input.model_strategy) return { status: "no_change", reason: "strategy_requires_owner_apply" };
  if (!input.clear) return { status: "needs_review", reason: "unclear_commitment" };
  return owner ? { status: "blocked_owner", reason: "owner_contact_type" } : changed ? { status: "stale", reason: "live_revision_changed" } : { status: "applied", reason: "number_contact_evidence" };
}
/** Pure decision seam; application re-loads all live facts and repeats this decision. */
export function planOutreachEffect(input: OutreachEffectInput, live: { record: RecordRow; action?: FollowupRow | null; identityAllowed: boolean; ownerProtected: boolean }): EffectPlan {
  if (input.model_strategy) return { status: "no_change", reason: "strategy_requires_owner_apply" };
  if (!input.clear) return { status: "needs_review", reason: "unclear_commitment" };
  if (input.kind === "pause_channel" || input.kind === "open_review") return { status: "applied", reason: "number_evidence" };
  if (input.kind === "set_contact_type") return contactTypePlan(input, live.ownerProtected, input.expected_revision !== live.record.revision);
  if (!live.identityAllowed) return { status: "blocked_identity", reason: "event_identity" };
  if (live.record.state === "closed") return { status: "blocked_closed", reason: "closed_work_request" };
  if (live.ownerProtected) return { status: "blocked_owner", reason: "owner_instruction" };
  if (input.expected_revision !== live.record.revision || (live.action && input.expected_action_revision !== live.action.revision)) return { status: "stale", reason: "live_revision_changed" };
  if (!input.history_complete) return { status: "needs_review", reason: "incomplete_history" };
  if (live.action && live.action.status !== "open") return { status: "stale", reason: "action_not_open" };
  return { status: "applied", reason: "clear_current_evidence" };
}
/** One transactional application path for CSI-13. Caller holds its leased application-job fence. No provider calls. */
export async function applyOutreachEffect(raw: OutreachEffectInput, context: CsiTransactionContext) {
  assertTrustedActor(context.actor);
  if (!context.session.inTransaction()) throw new CsiError("INVALID_INPUT");
  if (!csiFlag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
  const input = outreachEffectInputSchema.parse(raw);
  const record = await recordForUpdate(input.outreach_record_id, context);
  const key = subjectKey(record.subject);
  const finding = await getIntelligenceFindingModel().findOne({ _id: input.finding_id, run_id: input.run_id, key: input.finding_key }).session(context.session).lean();
  const run = await getIntelligenceRunModel().findById(input.run_id).session(context.session).lean();
  const call = await getCallInteractionModel().findById(input.interaction_id).session(context.session);
  if (!finding || !run || !call || String(run.contact_number_id) !== String(call.contact_number_id)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  if (run.subject_key !== key) {
    // CSI-12 conversation jobs retain their immutable subject. A persisted pointer is not sufficient:
    // the exact source conversation and current event attachment must still authorize this record.
    const conversation = run.conversation_id && run.subject_key === `conversation:${run.conversation_id}`
      ? await getLeadConversationModel().findOne({ _id: run.conversation_id, call_interaction_id: call._id,
        contact_number_id: run.contact_number_id }).session(context.session).lean() : null;
    if (!conversation || String(record.primary_contact_number_id) !== String(run.contact_number_id)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    if (record.subject.kind === "lead") {
      if (String(run.outreach_record_id) !== String(record._id)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      const attribution = await interactionAttribution(call, context.session);
      const attached = await getNumberLeadAttachmentModel().exists({ contact_number_id: run.contact_number_id,
        "lead_ref.id": record.subject.id, "lead_ref.model": record.subject.model, state: "attached" }).session(context.session);
      if (!attached || !attribution.lead_effects_allowed || attribution.certainty === "likely" ||
        attribution.lead_ref?.id !== String(record.subject.id) || attribution.lead_ref.model !== record.subject.model) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    } else if (String(record.subject.contact_number_id) !== String(run.contact_number_id) ||
      (run.outreach_record_id && String(run.outreach_record_id) !== String(record._id))) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  }
  const targetKey = input.target_followup_id ?? `interaction:${call._id}:${input.finding_key}`;
  const existing = await getIntelligenceEffectModel().findOne({ run_id: input.run_id, finding_key: input.finding_key, effect_kind: input.kind, target_key: targetKey }).session(context.session).lean();
  if (existing) {
    if (payloadHash(existing.current.input) !== payloadHash(jsonValue(input))) throw new CsiError("SUBMISSION_CONFLICT");
    return { status: existing.status, target_id: existing.target_id ? String(existing.target_id) : null, reason: existing.reason };
  }
  if (record.subject.kind === "lead") await ensureLead({ model: record.subject.model!, id: String(record.subject.id) }, context);
  const current = await recordForUpdate(String(record._id), context);
  const attribution = await interactionAttribution(call, context.session);
  const identityAllowed = current.subject.kind === "lead" ? attribution.lead_effects_allowed && attribution.lead_ref?.id === String(current.subject.id) && attribution.lead_ref.model === current.subject.model : attribution.blocked_reason === "unlinked";
  let action = input.target_followup_id ? await getOutreachFollowupModel().findOne({ _id: input.target_followup_id, outreach_record_id: current._id }).session(context.session) : null;
  if (input.target_followup_id && !action) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  const protectedFields: Array<"due_at" | "description" | "status"> = input.kind === "revise_followup" ? ["due_at", ...(input.description ? ["description" as const] : [])] : ["status"];
  const ownerProtected = Boolean(action && (action.origin === "owner" || await getSalesIntelligenceOwnerInstructionModel().exists({ followup_id: action._id, field: { $in: protectedFields }, state: "active" }).session(context.session))) ||
    (input.kind === "set_contact_type" && call.contact_type_basis === "owner");
  let plan = planOutreachEffect(input, { record: current, action, identityAllowed, ownerProtected });
  if (plan.status === "applied" && action && ["revise_followup", "complete_followup"].includes(input.kind) && action.date_resolution?.anchor && call.started_at <= action.date_resolution.anchor)
    plan = { status: "stale", reason: "not_after_commitment" };
  if (call.started_at < current.trigger_at && input.kind !== "pause_channel") plan = { status: "stale", reason: "before_work_trigger" };
  const prior = current.toObject(), policy = await resolvePolicy();
  let effectTargetId = String(current._id);
  const reps = await mappedSalesReps(call, context.session);
  // The submitted id cannot turn an ambiguous/name-only speaker into an Agent.
  const promising = input.promising_agent_id && reps.length === 1 && reps[0] === input.promising_agent_id ? input.promising_agent_id : null;
  if (plan.status === "applied" && input.kind === "create_followup") {
    if (!input.action_kind || !input.description || !input.origin) throw new CsiError("INVALID_INPUT");
    const resolved = input.date ? resolveActionDate({ ...input.date, wait: input.action_kind === "wait" }, policy, call.started_at) : resolveActionDateText(input.date_text, policy, call.started_at, input.action_kind === "wait");
    const promisedBy = input.origin === "rep_promise" ? promising : null;
    const assigned = input.origin === "rep_promise" ? promising : current.responsible_agent_id ? String(current.responsible_agent_id) : promising;
    const matches = action ? [action] : await getOutreachFollowupModel().find({ outreach_record_id: current._id, source_interaction_id: call._id,
      // Speaker uncertainty/review changes cannot manufacture a second obligation from the same source/date.
      kind: input.action_kind, origin: input.origin,
      $or: [{ source_due_at: resolved.due_at }, { due_at: resolved.due_at }] }).session(context.session);
    if (matches.length === 1) {
      action = matches[0]!;
      const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
      const sameDate = +(action.source_due_at ?? action.due_at ?? 0) === +(resolved.due_at ?? 0);
      if (action.kind !== input.action_kind || !sameDate || (!input.target_followup_id && normalize(action.description) !== normalize(input.description))) {
        plan = { status: "needs_review", reason: "ambiguous_commitment" };
      } else {
        plan = { status: "no_change", reason: "existing_commitment" };
        if (!action.source_finding_ids.some(id => String(id) === input.finding_id)) {
          const before = action.toObject(); action.source_finding_ids.push(new mongoose.Types.ObjectId(input.finding_id));
          await saveFollowup(action, before, context, key, "intelligence_commitment_evidence");
        }
      }
    }
    else if (matches.length > 1) plan = { status: "needs_review", reason: "ambiguous_commitment" };
    else {
      action = new (getOutreachFollowupModel())({ outreach_record_id: current._id,
        commitment_key: `commitment:${payloadHash({ record: String(current._id), source: String(call._id), kind: input.action_kind, origin: input.origin, agent: promising, due: resolved.due_at, description: input.description.trim().toLowerCase() })}`,
        kind: input.action_kind, description: input.description, ...resolved, source_due_at: resolved.due_at, date_text: input.date_text, origin: input.origin,
        requested_by: input.origin === "rep_promise" ? "rep" : "customer", source_interaction_id: call._id,
        responsible_agent_id: assigned, promised_by_agent_id: promisedBy, source_finding_ids: [input.finding_id], origin_run_id: input.run_id,
        assignment: assigned ? { origin: input.origin === "rep_promise" ? "rep_promise" : "inherited_outreach", assigned_at: call.started_at, evidence_id: call._id } : null });
      // Reconcile later calls before activating an old callback/wait, independent of ingestion order.
      const later = await getCallInteractionModel().find({ contact_number_id: call.contact_number_id, merged_into_id: null, started_at: { $gt: call.started_at } }).sort({ started_at: 1 }).limit(501).session(context.session).lean();
      if (later.length > 500) plan = { status: "needs_review", reason: "history_window_incomplete" };
      else for (const next of later) {
        const facts = callFacts(current, next, await interactionAttribution(next, context.session), await mappedSalesReps(next, context.session));
        if (fulfilledByCall(action, next, facts)) {
          const competing = await getOutreachFollowupModel().find({ outreach_record_id: current._id, kind: action.kind, missed_episode_key: null,
            $or: [{ status: "open" }, { evidence_interaction_id: next._id, completion_basis: "call_attempt" }] }).session(context.session);
          if (competing.some(other => other.evidence_interaction_id?.equals(next._id) || fulfilledByCall(other, next, facts))) {
            await openReview(context, key, "completion_target", `callback:${next._id}`, [input.finding_id]); continue;
          }
          action.status = "completed"; action.disposition = action.kind === "wait" ? "customer_called" : facts.outcome; action.completed_at = next.started_at;
          action.evidence_interaction_id = next._id; action.completion_basis = "call_attempt"; break;
        }
      }
      if (plan.status === "applied") {
        await saveFollowup(action, null, context, key, "intelligence_followup_created");
        if (!resolved.due_at) await openReview(context, key, "missing_date", String(action._id), [input.finding_id]);
        if (!assigned) await openReview(context, key, "missing_responsibility", String(action._id), [input.finding_id]);
        if (promising && (input.origin === "rep_promise" || call.contact_type === "human_conversation") && !current.responsible_agent_id && current.assignment?.origin !== "owner") {
          current.responsible_agent_id = new mongoose.Types.ObjectId(promising); current.assignment = { origin: "rep_promise", assigned_at: call.started_at, evidence_id: call._id };
        }
        if (input.action_kind === "wait" && resolved.due_at && current.state === "unworked") current.state = "open";
      }
    }
  } else if (plan.status === "applied" && (input.kind === "revise_followup" || input.kind === "complete_followup")) {
    if (!action) plan = { status: "needs_review", reason: "completion_target" };
    else {
      const before = action.toObject();
      if (input.kind === "complete_followup") { action.status = "completed"; action.completed_at = call.started_at; action.disposition = "completed"; action.completion_basis = "customer_confirmation"; }
      else { const date = input.date ? resolveActionDate({ ...input.date, wait: action.kind === "wait" }, policy, call.started_at) : resolveActionDateText(input.date_text, policy, call.started_at, action.kind === "wait"); action.set(date); action.date_text = input.date_text ?? null; if (input.description) action.description = input.description; }
      action.snoozed_until = null; action.source_finding_ids.push(new mongoose.Types.ObjectId(input.finding_id));
      await saveFollowup(action, before, context, key, input.kind);
    }
  } else if (plan.status === "applied" && input.kind === "pause_channel") {
    if (!input.channels?.length) throw new CsiError("INVALID_INPUT");
    if (!call.contact_number_id) throw new CsiError("INVALID_INPUT");
    const restriction = await applySpokenRestriction({ number_id: String(call.contact_number_id), interaction_id: String(call._id), channels: input.channels,
      until: input.date?.exact ? new Date(input.date.exact) : null, run_id: input.run_id, finding_id: input.finding_id }, context);
    plan = restriction; effectTargetId = restriction.target_id;
  } else if (plan.status === "applied" && input.kind === "set_contact_type") {
    if (!input.contact_type) throw new CsiError("INVALID_INPUT");
    call.contact_type = input.contact_type; call.contact_type_basis = `finding:${input.finding_id}`; call.projection_revision++;
    await call.save({ session: context.session }); await ensureInteraction(call, context);
    if (run.conversation_id) await getLeadConversationModel().updateOne({ _id: run.conversation_id, call_interaction_id: call._id },
      { $set: { contact_type: call.contact_type, contact_type_basis: call.contact_type_basis } }, { session: context.session });
    effectTargetId = String(call._id);
  }
  if (["needs_review", "blocked_closed", "blocked_identity", "blocked_owner"].includes(plan.status) || input.kind === "open_review") {
    const review = await openReview(context, key, plan.status === "blocked_closed" ? "closed_work_request" : plan.status === "blocked_identity" ? "identity" : plan.status === "blocked_owner" ? "owner_conflict" : "unclear_commitment", input.finding_key, [input.finding_id]);
    if (input.kind === "open_review") effectTargetId = String(review._id);
  }
  if (action && !action.isNew) effectTargetId = String(action._id);
  if (plan.status === "applied" && input.kind !== "set_contact_type") await refreshRecord(current, context, "intelligence_effect", prior);
  await getIntelligenceEffectModel().create([{ run_id: input.run_id, finding_id: input.finding_id, finding_key: input.finding_key, effect_kind: input.kind, target_key: targetKey,
    target_id: effectTargetId, commitment_key: action?.commitment_key ?? null, status: plan.status, reason: plan.reason,
    revision_before: prior.revision, revision_after: current.revision, previous: jsonValue(prior), current: jsonValue({ input, status: plan.status }), applied_at: context.now }], { session: context.session });
  return { status: plan.status, reason: plan.reason, target_id: effectTargetId };
}

/** Contact evidence can precede Outreach creation. Reuse the same decision and transition authority. */
export async function applyUnboundContactTypeEffect(input: { run_id: string; finding_id: string; finding_key: string; interaction_id: string;
  contact_type: "human_conversation" | "voicemail" | "unknown"; clear: boolean; model_strategy: boolean; expected_revision: number }, context: CsiTransactionContext) {
  assertTrustedActor(context.actor);
  if (!context.session.inTransaction() || !csiFlag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
  const run = await getIntelligenceRunModel().findById(input.run_id).session(context.session).lean();
  const finding = await getIntelligenceFindingModel().findOne({ _id: input.finding_id, run_id: input.run_id, key: input.finding_key }).session(context.session).lean();
  const call = await getCallInteractionModel().findById(input.interaction_id).session(context.session).orFail();
  const conversation = run?.conversation_id ? await getLeadConversationModel().findOne({ _id: run.conversation_id,
    call_interaction_id: call._id, contact_number_id: call.contact_number_id }).session(context.session).lean() : null;
  if (!run || !finding || !conversation || run.outreach_record_id || run.subject_key !== `conversation:${conversation._id}` || String(run.contact_number_id) !== String(call.contact_number_id)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  const prior = await getIntelligenceEffectModel().findOne({ run_id: run._id, finding_key: input.finding_key, effect_kind: "set_contact_type", target_key: `interaction:${call._id}` }).session(context.session).lean();
  if (prior) return { status: prior.status, reason: prior.reason, target_id: String(prior.target_id) };
  const plan = contactTypePlan(input, call.contact_type_basis === "owner", call.projection_revision !== input.expected_revision);
  const before = call.contact_type;
  if (plan.status === "applied") {
    call.contact_type = input.contact_type; call.contact_type_basis = `finding:${finding._id}`; call.projection_revision++;
    await call.save({ session: context.session });
    await getLeadConversationModel().updateOne({ _id: conversation._id }, { $set: { contact_type: call.contact_type, contact_type_basis: call.contact_type_basis } }, { session: context.session });
    await ensureInteraction(call, context);
  } else if (plan.status !== "no_change") await openReview(context, run.subject_key, plan.status === "blocked_owner" ? "owner_conflict" : "unclear_commitment", input.finding_key, [input.finding_id]);
  await getIntelligenceEffectModel().create([{ run_id: run._id, finding_id: finding._id, finding_key: input.finding_key,
    effect_kind: "set_contact_type", target_key: `interaction:${call._id}`, target_id: call._id, status: plan.status, reason: plan.reason,
    previous: { contact_type: before }, current: { contact_type: call.contact_type }, applied_at: context.now }], { session: context.session });
  return { ...plan, target_id: String(call._id) };
}
