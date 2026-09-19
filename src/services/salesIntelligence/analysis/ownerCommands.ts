import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { applyOwnerCommandInTransaction } from "../followups/commands";
import { jsonValue, type JsonValue } from "../outreach/store";
import { subjectKey } from "../outreach/types";
import { newObjectIdHex } from "../../../utils/objectId";
import { scheduleOwnerReanalysis } from "./ownerReanalysis";
import { csiCommandSchema, csiIdSchema, type CsiCommand } from "../../../validation/v1/salesIntelligence";
import { CsiError, type CsiActor } from "../auth";
import { appendCsiAudit, csiCas, executeCsiCommand, payloadHash, type CsiTransactionContext } from "../transactions";

type Run = { _id: unknown; conversation_id?: unknown; contact_number_id?: unknown };

/** Fence the published pointer as well as the run: publication cannot race a review. */
async function fenceCurrentRun(run: Run, context: CsiTransactionContext) {
  const result = run.conversation_id
    ? await getLeadConversationModel().updateOne({ _id: String(run.conversation_id), latest_completed_run_id: String(run._id) }, { $inc: { __v: 1 } }, { session: context.session })
    : await getContactNumberModel().updateOne({ _id: String(run.contact_number_id), "running_summary.run_id": String(run._id) }, { $inc: { revision: 1 } }, { session: context.session });
  if (result.matchedCount !== 1) throw new CsiError("REVISION_CONFLICT");
}

export async function commandAnalysis(input: { actor: CsiActor; target_id: string; idempotency_key: string; command: CsiCommand }) {
  const command = csiCommandSchema.parse(input.command), target = csiIdSchema.parse(input.target_id);
  return executeCsiCommand({ actor: input.actor, command: command.command, idempotency_key: input.idempotency_key,
    payload: { target_id: target, command }, operation: async (context): Promise<JsonValue> => {
      if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
      if (command.command === "reanalyze") {
        const sourceId = command.source_run_id ?? (await getLeadConversationModel().findById(target).session(context.session).lean())?.latest_completed_run_id
          ?? (await getContactNumberModel().findById(target).session(context.session).lean())?.running_summary?.run_id ?? target;
        const source = await getIntelligenceRunModel().findOne({ _id: sourceId, ...csiDataset() }).session(context.session);
        if (!source || (target !== String(source._id) && target !== String(source.conversation_id) && target !== String(source.contact_number_id))) throw new CsiError("RUN_SCOPE_DENIED");
        if (source.revision !== command.expected_revision || command.expected_revisions?.length) throw new CsiError("REVISION_CONFLICT");
        const result = await scheduleOwnerReanalysis(String(source._id), command.mode, command.owner_correction_ids, context);
        await csiCas(getIntelligenceRunModel(), String(source._id), source.revision, {}, context.session);
        await appendCsiAudit(context, { kind: "analysis", target_id: String(source._id), subject_key: source.subject_key, revision: source.revision + 1,
          event_kind: "analysis.reanalysis_requested", prior: {}, current: { ...result, mode: command.mode, reason: command.reason } });
        return result;
      }
      if (!["confirm_run", "confirm_finding", "correct_finding", "retract_finding", "apply_suggestion"].includes(command.command)) throw new CsiError("INVALID_INPUT");
      const findingCommand = ["confirm_finding", "correct_finding", "retract_finding"].includes(command.command);
      const finding = findingCommand ? await getIntelligenceFindingModel().findById(target).session(context.session) : null;
      if (findingCommand && (!finding || finding.revision !== command.expected_revision)) throw new CsiError("REVISION_CONFLICT");
      const run = await getIntelligenceRunModel().findOne({ _id: finding?.run_id ?? target, ...csiDataset() }).session(context.session);
      if (!run?.output || run.status !== "completed") throw new CsiError("REVISION_CONFLICT");
      const digest = payloadHash(run.output);
      if (!finding && run.revision !== command.expected_revision) throw new CsiError("REVISION_CONFLICT");
      if ("expected_output_digest" in command && digest !== command.expected_output_digest) throw new CsiError("REVISION_CONFLICT");
      await fenceCurrentRun(run, context);
      if (command.command === "correct_finding" || command.command === "retract_finding") {
        if (!finding) throw new CsiError("INVALID_INPUT");
        if (command.command === "correct_finding" && (command.replacement.key !== finding.key || command.replacement.kind !== finding.kind)) throw new CsiError("INVALID_INPUT");
        const effects = await getIntelligenceEffectModel().find({ run_id: run._id, finding_id: finding._id }).session(context.session).lean();
        const outcomes: Array<{ target_id: string; status: string; reason: string | null }> = [];
        const used = new Set<string>();
        const fences = command.expected_revisions ?? [];
        const selected = command.command === "correct_finding" && command.target_effect_id
          ? effects.filter(e => String(e._id) === command.target_effect_id) : effects;
        if (command.command === "correct_finding" && command.target_effect_id && !selected.length) throw new CsiError("EVIDENCE_SCOPE_INVALID");
        if (command.command === "correct_finding" && command.action_changes && !command.target_followup_id) throw new CsiError("INVALID_INPUT");
        const ids = [...new Set(selected.filter(e => e.target_id && ["applied", "no_change"].includes(e.status) && ["create_followup", "revise_followup", "complete_followup"].includes(e.effect_kind)).map(e => String(e.target_id)))];
        if (command.command === "correct_finding" && command.target_followup_id && !ids.includes(command.target_followup_id)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
        for (const id of ids) {
          if (command.command === "correct_finding" && id !== command.target_followup_id) continue;
          const action = await getOutreachFollowupModel().findById(id).session(context.session);
          if (!action || !action.source_finding_ids.some(ref => String(ref) === String(finding._id))) throw new CsiError("EVIDENCE_SCOPE_INVALID");
          const fence = fences.find(f => f.target === "followup" && f.id === id);
          if (!fence || fence.revision !== action.revision) throw new CsiError("REVISION_CONFLICT");
          used.add(`followup:${id}`);
          const outreach = await getOutreachRecordModel().findById(action.outreach_record_id).session(context.session).lean();
          if (!outreach || outreach.state === "closed") {
            outcomes.push({ target_id: id, status: "blocked", reason: outreach?.closure_origin === "official" ? "official_closure" : "closed_work" });
            continue;
          }
          const ownerChanged = action.origin === "owner" || Boolean(await getSalesIntelligenceOwnerInstructionModel().exists({ followup_id: action._id, state: "active" }).session(context.session));
          const createdHere = selected.some(e => e.effect_kind === "create_followup" && e.status === "applied" && String(e.target_id) === id);
          const laterEffect = await getIntelligenceEffectModel().exists({ target_id: action._id, finding_id: { $ne: finding._id },
            status: "applied", applied_at: { $gte: finding.createdAt } }).session(context.session);
          if (action.status !== "open" || (command.command === "retract_finding" && (ownerChanged || laterEffect || !createdHere))) {
            outcomes.push({ target_id: id, status: "blocked", reason: action.status !== "open" ? "action_already_resolved" : ownerChanged ? "later_owner_work" : "reversal_requires_explicit_owner_action" });
            continue;
          }
          if (command.command === "correct_finding" && !command.action_changes) throw new CsiError("INVALID_INPUT");
          const result = await applyOwnerCommandInTransaction(id, command.command === "retract_finding"
            ? { command: "cancel_followup", expected_revision: action.revision, reason: command.reason }
            : { command: "patch_followup", expected_revision: action.revision, changes: command.action_changes!, reason: command.reason }, context);
          const blocked = typeof result === "object" && result !== null && !Array.isArray(result) && "blocked" in result;
          outcomes.push({ target_id: id, status: blocked ? "blocked" : "applied", reason: blocked ? "official_closure" : null });
        }
        for (const fence of fences) if (!used.has(`${fence.target}:${fence.id}`)) throw new CsiError("INVALID_INPUT");
        for (const effect of selected.filter(e => e.status === "applied" && !["create_followup", "revise_followup", "complete_followup", "open_review"].includes(e.effect_kind)))
          outcomes.push({ target_id: String(effect.target_id), status: "blocked", reason: "reversal_requires_explicit_owner_action" });
        const instructionId = newObjectIdHex();
        const record = finding.outreach_record_id ? await getOutreachRecordModel().findById(finding.outreach_record_id).session(context.session).lean() : null;
        const instructionSubject = record ? subjectKey(record.subject) : run.subject_key;
        await getSalesIntelligenceOwnerInstructionModel().create([{ _id: instructionId, instruction_id: instructionId, subject_key: instructionSubject,
          finding_id: finding._id, followup_id: command.command === "correct_finding" ? command.target_followup_id : null, field: "assertion",
          prior: jsonValue(finding.assertion), current: { review_state: command.command === "correct_finding" ? "corrected" : "retracted",
            replacement: command.command === "correct_finding" ? jsonValue(command.replacement) : null,
            action_changes: command.command === "correct_finding" ? jsonValue(command.action_changes ?? {}) : null, reason: command.reason, outcomes },
          actor: context.actor, happened_at: context.now, state: "active" }], { session: context.session });
        const reviewState = command.command === "correct_finding" ? "corrected" as const : "retracted" as const;
        await csiCas(getIntelligenceFindingModel(), String(finding._id), finding.revision, { review_state: reviewState }, context.session);
        // Only assertion-specific decisions are resolved here; restrictions and identity keep their own commands.
        const reviews = await getSalesIntelligenceReviewItemModel().find({ state: "open", evidence_ids: finding._id,
          cause_kind: { $in: ["unclear_commitment", "owner_conflict"] } }).session(context.session);
        if (!outcomes.some(o => o.status === "blocked")) for (const review of reviews) {
          const before = review.toObject(); review.state = "resolved"; review.resolution_actor = { ...context.actor, run_id: null }; review.resolved_at = context.now;
          review.resolution_reason = command.reason; review.revision++; await review.save({ session: context.session });
          await appendCsiAudit(context, { kind: "review", target_id: String(review._id), subject_key: review.subject_key,
            revision: review.revision, event_kind: "finding.review_resolved", prior: jsonValue(before), current: jsonValue(review.toObject()) });
        }
        await csiCas(getIntelligenceRunModel(), String(run._id), run.revision, {}, context.session);
        await appendCsiAudit(context, { kind: "analysis", target_id: String(finding._id), subject_key: run.subject_key, revision: finding.revision + 1,
          event_kind: `finding.${reviewState}`, prior: { review_state: finding.review_state }, current: { review_state: reviewState, instruction_id: instructionId, output_digest: digest, outcomes } });
        let reanalysis: JsonValue = null;
        {
          try { reanalysis = await scheduleOwnerReanalysis(String(run._id), command.reanalysis_mode ?? "current_context", [instructionId], context); }
          catch (error) {
            if (!(error instanceof CsiError) || error.code !== "ORIGINAL_EVIDENCE_UNAVAILABLE") throw error;
            reanalysis = { status: "unavailable", reason: error.code };
          }
        }
        return { id: target, revision: finding.revision + 1, run_id: String(run._id), instruction_id: instructionId, outcomes, reanalysis };
      }
      if (command.command === "apply_suggestion") {
        if (command.run_id !== String(run._id) || command.suggestion_output_digest !== payloadHash(run.output.next_step_suggestion)) throw new CsiError("REVISION_CONFLICT");
        const suggestion = run.output.next_step_suggestion;
        const record = run.outreach_record_id ? await getOutreachRecordModel().findById(run.outreach_record_id).session(context.session)
          : await getOutreachRecordModel().findOne({ "subject.kind": "number_review", "subject.contact_number_id": run.contact_number_id }).session(context.session);
        if (!suggestion || !record) throw new CsiError("ILLEGAL_TRANSITION");
        const fences = command.expected_revisions ?? [];
        if (fences.length !== 1 || fences[0].target !== "outreach" || fences[0].id !== String(record._id) || fences[0].revision !== record.revision) throw new CsiError("REVISION_CONFLICT");
        const result = await applyOwnerCommandInTransaction(String(record._id), { command: "create_followup", outreach_record_id: String(record._id), expected_revision: record.revision,
          action: { kind: suggestion.action_kind, description: suggestion.description, due_at: command.due_at ?? null,
            ...(command.responsible_agent_id !== undefined ? { responsible_agent_id: command.responsible_agent_id } : {}) } }, context);
        const blocked = typeof result === "object" && result !== null && !Array.isArray(result) && "blocked" in result;
        await csiCas(getIntelligenceRunModel(), String(run._id), run.revision, {}, context.session);
        await appendCsiAudit(context, { kind: "analysis", target_id: String(run._id), subject_key: run.subject_key, revision: run.revision + 1,
          event_kind: blocked ? "analysis.suggestion_blocked" : "analysis.suggestion_applied", prior: {}, current: { suggestion_output_digest: command.suggestion_output_digest, result } });
        return { id: target, revision: run.revision + 1, status: blocked ? "blocked" : "applied", result };
      }
      if (command.expected_revisions?.length) throw new CsiError("INVALID_INPUT");
      const findings = finding ? [finding] : await getIntelligenceFindingModel().find({ run_id: run._id }).session(context.session);
      if (findings.some(row => row.review_state === "corrected" || row.review_state === "retracted")) throw new CsiError("ILLEGAL_TRANSITION");
      for (const row of findings) {
        await csiCas(getIntelligenceFindingModel(), String(row._id), row.revision, { review_state: "confirmed" }, context.session);
        await appendCsiAudit(context, { kind: "analysis", target_id: String(row._id), subject_key: run.subject_key,
          revision: row.revision + 1, event_kind: "finding.confirmed", prior: { review_state: row.review_state },
          current: { review_state: "confirmed", run_id: String(run._id), output_digest: digest } });
      }
      await csiCas(getIntelligenceRunModel(), String(run._id), run.revision, {}, context.session);
      await appendCsiAudit(context, { kind: "analysis", target_id: String(run._id), subject_key: run.subject_key,
        revision: run.revision + 1, event_kind: command.command === "confirm_run" ? "analysis.confirmed" : "analysis.finding_confirmed",
        prior: {}, current: { output_digest: digest, finding_ids: findings.map(row => String(row._id)) } });
      return { id: target, run_id: String(run._id), revision: finding ? finding.revision + 1 : run.revision + 1, output_digest: digest };
    } });
}
