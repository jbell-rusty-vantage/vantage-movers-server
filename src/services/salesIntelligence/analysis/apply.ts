import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../../models/IntelligenceSubmission";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getIntelligenceOwnerAssessmentModel } from "../../../models/IntelligenceOwnerAssessment";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { intelligenceEnvelopeSchema, type IntelligenceEnvelope } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, checkpointCsiJob, failCsiJob } from "../jobs";
import { appendCsiAudit, payloadHash } from "../transactions";
import { applyOutreachEffect, applyUnboundContactTypeEffect, type OutreachEffectInput } from "../outreach/effects";
import { workerContext, mappedSalesReps } from "../outreach/ensure";
import { ensureNumberReview } from "../outreach/numberReview";
import { resolveActionDateText } from "../outreach/staffing";
import { openReview } from "../review/items";
import { applySpokenRestriction } from "../review/restrictions";
import { resolvePolicy } from "../policy";
import { applicationReady, resumeApplicationIntents } from "./readiness";
import { readContentSchema } from "./reads";
import { renderEnvelopeSummary } from "../dto";
import { scheduleNumberIntelligence } from "./scheduling";
import { capturedTranscriptsComplete } from "./coverage";

type Finding = IntelligenceEnvelope["findings"][number];
export function resolveQuotedMoney(text: string, currency: string | null): number | null {
  if (currency && !["USD", "usd", "$"].includes(currency)) return null;
  const match = /^\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:dollars|USD)?\s*$/i.exec(text);
  if (!match) return null;
  const cents = Number(match[1].replaceAll(",", "")) * 100;
  return Number.isSafeInteger(Math.round(cents)) ? Math.round(cents) : null;
}
export function effectKind(finding: Finding): OutreachEffectInput["kind"] | null {
  if (["promised_callback", "customer_requested_callback", "customer_will_call", "next_step"].includes(finding.kind)) return finding.action_status === "completed" ? "complete_followup" : "create_followup";
  if (finding.kind === "completion_claim") return "complete_followup";
  if (finding.kind === "reschedule") return "revise_followup";
  if (finding.kind === "contact_type") return "set_contact_type";
  if (finding.kind === "contact_restriction") return "pause_channel";
  if (["booking_claim", "payment_claim", "objection", "competitor_mention"].includes(finding.kind) || (finding.kind === "intent" && finding.value.intent === "not_sales")) return "open_review";
  return null;
}
/** Bounded batches are committed under the same application lease; finding cursor and effects commit together. */
export async function runIntelligenceApplicationJob(jobId?: string, deps: { beforeBatch?: () => Promise<void>; afterBatch?: () => Promise<void>; beforePublication?: () => Promise<void>; onError?: (error: unknown) => void } = {}) {
  if (!applicationReady()) return { status: "disabled" };
  await resumeApplicationIntents();
  const job = await claimCsiJob(`csi-apply:${randomUUID()}`, jobId, 300_000, "application");
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  try {
    if (job.input_refs.length !== 2) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    const run = await getIntelligenceRunModel().findOne({ _id: job.input_refs[0], subject_key: job.subject_key, ...csiDataset(), finalized_at: { $ne: null } }).orFail();
    const submission = await getIntelligenceSubmissionModel().findOne({ _id: job.input_refs[1], run_id: run._id, application_job_id: job._id }).orFail();
    const envelope = intelligenceEnvelopeSchema.parse(submission.envelope);
    if (payloadHash(envelope) !== submission.payload_hash || payloadHash(run.output) !== submission.payload_hash || submission.manifest_digest !== run.manifest_digest) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    const snapshots = await getIntelligenceEvidenceSnapshotModel().find({ run_id: run._id, ...csiDataset() }).sort({ _id: 1 }).lean();
    if (snapshots.length !== run.manifest_snapshot_ids.length || payloadHash(snapshots.map(s => ({ id: String(s._id), digest: s.content_digest }))) !== run.manifest_digest) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    const content = snapshots.map(s => {
      const data = readContentSchema.parse(s.response);
      if (payloadHash(data) !== s.content_digest || s.subject_key !== run.subject_key) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      return data;
    });
    const transcriptSources = [...new Set(content.flatMap(c => c.transcript ? [c.transcript.source_snapshot_id] : []))];
    const completeSources = await getIntelligenceEvidenceSnapshotModel().countDocuments({ _id: { $in: transcriptSources },
      ...csiDataset(), source_type: "transcript", "completeness.complete": true });
    if (completeSources !== transcriptSources.length || !capturedTranscriptsComplete(snapshots, run.conversation_id ? String(run.conversation_id) : null)) {
      await failCsiJob(lease, "permission_denied", 0, { result: { reason: "incomplete_coverage" } });
      return { status: "paused" };
    }
    for (let start = run.application_cursor; start < envelope.findings.length; start += 5) {
      await deps.beforeBatch?.();
      await checkpointCsiJob(lease, async session => {
        if (!applicationReady()) throw new CsiError("FEATURE_DISABLED");
        const current = await getIntelligenceRunModel().findById(run._id).session(session).orFail();
        if (current.application_cursor !== start) throw new CsiError("REVISION_CONFLICT");
        const context = workerContext(session, lease.job_id), policy = await resolvePolicy(session);
        for (const assertion of envelope.findings.slice(start, start + 5)) {
          const transcript = assertion.evidence.filter(e => e.source === "transcript");
          const sourceIds = [...new Set(transcript.map(e => e.conversation_id))];
          const source = sourceIds.length === 1 ? await getLeadConversationModel().findOne({ _id: sourceIds[0], contact_number_id: run.contact_number_id }).session(session).lean() : null;
          const call = source ? await getCallInteractionModel().findOne({ _id: source.call_interaction_id, contact_number_id: run.contact_number_id, merged_into_id: null }).session(session) : null;
          const wording = "date_text" in assertion.value ? assertion.value.date_text : assertion.kind === "quoted_amount" ? assertion.value.amount_text : assertion.kind === "contact_restriction" ? assertion.value.until_text : null;
          const unknownTimezone = "timezone_text" in assertion.value && assertion.value.timezone_text && assertion.value.timezone_text !== policy.timezone;
          const resolved = call && wording && !unknownTimezone ? resolveActionDateText(wording, policy, call.started_at, assertion.kind === "customer_will_call") : null;
          const amount = assertion.kind === "quoted_amount" ? resolveQuotedMoney(assertion.value.amount_text, assertion.value.currency) : null;
          const [finding] = await getIntelligenceFindingModel().create([{ run_id: run._id, key: assertion.key, assertion, kind: assertion.kind,
            conversation_id: source?._id ?? run.conversation_id, contact_number_id: run.contact_number_id, outreach_record_id: run.outreach_record_id,
            prompt_version: run.prompt_version, schema_version: run.schema_version, model_version: run.model_version,
            resolved: { due_at: resolved?.due_at ?? null, amount_cents: amount,
              original_wording: wording, assumptions: unknownTimezone ? ["timezone_unresolved"] : resolved?.date_resolution?.assumption ? [resolved.date_resolution.assumption] : [],
              uncertain: assertion.kind === "quoted_amount" ? amount === null : !resolved?.due_at },
            validation: { schema_ok: true, source_snapshots_valid: true, locator_status: "not_run", entailment_check: "not_run" } }], { session });
          if (!finding) throw new CsiError("INVALID_INPUT");
          const kind = effectKind(assertion);
          if (!kind || run.mode === "number_refresh") continue; // Synthesis publishes evidence; per-conversation extraction owns commitments.
          let record = run.outreach_record_id ? await getOutreachRecordModel().findById(run.outreach_record_id).session(session) : null;
          let outcome: { status: "needs_review" | "blocked_identity" | "blocked_owner"; reason: string } | null = null;
          const priorFindings = source ? await getIntelligenceFindingModel().find({ conversation_id: source._id, kind: assertion.kind,
            _id: { $ne: finding._id } }).select("_id").limit(201).session(session).lean() : [];
          const retract = priorFindings.length > 200 || await getSalesIntelligenceOwnerInstructionModel().exists({
            finding_id: { $in: priorFindings.map(f => f._id) }, state: "active", field: "assertion" }).session(session);
          if (retract) outcome = { status: "blocked_owner", reason: "owner_assertion" };
          if (!call || (run.conversation_id && String(run.conversation_id) !== String(source?._id))) outcome = { status: "needs_review", reason: "source_interaction_unresolved" };
          if (!outcome && !record && !run.outreach_record_id && call && assertion.kind === "contact_type") {
            await applyUnboundContactTypeEffect({ run_id: String(run._id), finding_id: String(finding._id), finding_key: assertion.key,
              interaction_id: String(call._id), contact_type: assertion.value.type, clear: assertion.clarity === "clear",
              model_strategy: assertion.basis === "model_inference", expected_revision: call.projection_revision }, context);
            continue;
          }
          if (!outcome && !record && call && assertion.kind === "contact_restriction") {
            if (assertion.clarity !== "clear" || assertion.basis === "model_inference" || assertion.value.restriction === "unclear" ||
              (assertion.value.restriction === "until" && !resolved?.due_at)) outcome = { status: "needs_review", reason: "restriction_uncertain" };
            else {
              const effect = await applySpokenRestriction({ number_id: String(run.contact_number_id), interaction_id: String(call._id),
                channels: assertion.value.channels, until: assertion.value.restriction === "until" ? resolved!.due_at : null,
                run_id: String(run._id), finding_id: String(finding._id) }, context);
              await getIntelligenceEffectModel().create([{ run_id: run._id, finding_id: finding._id, finding_key: assertion.key,
                effect_kind: "pause_channel", target_key: `interaction:${call._id}`, target_id: effect.target_id,
                status: effect.status, reason: effect.reason, previous: {}, current: {}, applied_at: context.now }], { session });
              continue;
            }
          }
          if (!outcome && !record && call && kind === "create_followup" && assertion.clarity === "clear" && assertion.basis !== "model_inference") {
            try {
              const existingReview = await getOutreachRecordModel().exists({ "subject.kind": "number_review", "subject.contact_number_id": run.contact_number_id }).session(session);
              record = await ensureNumberReview(String(run.contact_number_id), "clear_sales_commitment", context, { id: String(call._id),
                provider_account_id: call.provider_account_id, started_at: call.started_at, call_log_ids: call.call_log_ids,
                session_id: call.session_id, telephony_session_id: call.telephony_session_id });
              await getIntelligenceEffectModel().create([{ run_id: run._id, finding_id: finding._id, finding_key: assertion.key,
                effect_kind: "open_number_review", target_key: `number:${run.contact_number_id}`, target_id: record._id,
                status: existingReview ? "no_change" : "applied", reason: existingReview ? "existing_number_review" : "clear_sales_commitment", previous: {}, current: {}, applied_at: context.now }], { session });
            } catch (error) {
              if (!(error instanceof CsiError) || !["IDENTITY_BLOCKED", "ILLEGAL_TRANSITION", "OFFICIAL_STATE_BLOCKS_REOPEN"].includes(error.code)) throw error;
              outcome = { status: "blocked_identity", reason: "number_review_ineligible" };
            }
          }
          if (!record) outcome ??= { status: "blocked_identity", reason: "outreach_binding_unavailable" };
          if (!outcome && record && call) {
            const actions = "target_followup_id" in assertion.value && assertion.value.target_followup_id ?
              await getOutreachFollowupModel().findOne({ _id: assertion.value.target_followup_id, outreach_record_id: record._id }).session(session).lean() : null;
            const reps = await mappedSalesReps(call, session);
            const speaker = assertion.actor === "rep" && assertion.speaker_ref?.startsWith("agent:") ? assertion.speaker_ref.slice(6) : null;
            const promising = speaker && reps.length === 1 && reps[0] === speaker ? speaker : null;
            const history = content.some(c => c.coverage.known_through && new Date(c.coverage.known_through) >= (run.started_at ?? call.started_at) && c.coverage.gaps.length === 0);
            const input: OutreachEffectInput = { run_id: String(run._id), finding_id: String(finding._id), finding_key: assertion.key,
              outreach_record_id: String(record._id), interaction_id: String(call._id), expected_revision: record.revision,
              kind, clear: assertion.clarity === "clear", history_complete: history, model_strategy: assertion.basis === "model_inference" || assertion.action_status === "conditional",
              target_followup_id: actions ? String(actions._id) : null,
              expected_action_revision: actions ? Number(content.flatMap(c => c.page.records).find(r => r.record_type === "followup" && r.record_id === String(actions._id))?.revision ?? 0) : undefined,
              promising_agent_id: promising, date_text: wording };
            if ("action_kind" in assertion.value) {
              input.action_kind = assertion.kind === "customer_will_call" ? "wait" : assertion.value.action_kind;
              input.description = assertion.value.description;
              input.origin = assertion.kind === "customer_will_call" ? "customer_wait" : assertion.kind === "customer_requested_callback" || assertion.actor === "customer" ? "customer_request" : "rep_promise";
              if (assertion.actor === "unknown") input.clear = false;
              if (assertion.value.timezone_text && assertion.value.timezone_text !== policy.timezone) input.date_text = null;
            }
            if (assertion.kind === "contact_type") input.contact_type = assertion.value.type;
            if (assertion.kind === "contact_restriction") { input.channels = assertion.value.channels;
              if (assertion.value.restriction === "unclear" || (assertion.value.restriction === "until" && !resolved?.due_at)) input.clear = false;
              if (assertion.value.restriction === "until" && resolved?.due_at) input.date = { exact: resolved.due_at.toISOString() }; }
            try { await applyOutreachEffect(input, context); }
            catch (error) { if (!(error instanceof CsiError) || error.code !== "EVIDENCE_SCOPE_INVALID") throw error;
              outcome = { status: "blocked_identity", reason: "live_binding_changed" }; }
          }
          if (outcome) {
            const review = await openReview(context, run.subject_key, outcome.status === "blocked_identity" ? "identity" : "unclear_commitment", `${run._id}:${assertion.key}`, [String(finding._id)]);
            await getIntelligenceEffectModel().create([{ run_id: run._id, finding_id: finding._id, finding_key: assertion.key, effect_kind: kind,
              target_key: `review:${review._id}`, target_id: review._id, status: outcome.status, reason: outcome.reason, previous: {}, current: {}, applied_at: context.now }], { session });
          }
        }
        await getIntelligenceRunModel().updateOne({ _id: run._id, application_cursor: start }, { $set: { application_cursor: Math.min(start + 5, envelope.findings.length) } }, { session });
      });
      await deps.afterBatch?.();
    }
    await deps.beforePublication?.();
    await completeCsiJob(lease, async session => {
      if (!applicationReady()) throw new CsiError("FEATURE_DISABLED");
      const current = await getIntelligenceRunModel().findById(run._id).session(session).orFail();
      if (current.application_cursor !== envelope.findings.length) throw new CsiError("REVISION_CONFLICT");
      const effects = await getIntelligenceEffectModel().find({ run_id: run._id }).session(session).lean();
      const findings = await getIntelligenceFindingModel().find({ run_id: run._id }).session(session).lean();
      for (const assessment of envelope.owner_instruction_assessments) {
        const { finding_keys, ...value } = assessment;
        await getIntelligenceOwnerAssessmentModel().create([{ ...value,
          run_id: run._id, finding_ids: findings.filter(f => finding_keys.includes(f.key)).map(f => f._id) }], { session });
      }
      const published = await publishCurrent(run, envelope, session);
      const now = new Date();
      await getIntelligenceRunModel().updateOne({ _id: run._id }, { $set: { status: published ? "completed" : "stale", completed_at: now,
        result_counts: { applied: effects.filter(e => e.status === "applied").length, blocked: effects.filter(e => e.status.startsWith("blocked") || e.status === "stale").length,
          review: effects.filter(e => e.status === "needs_review").length } }, $inc: { revision: 1 } }, { session });
      await appendCsiAudit(workerContext(session, lease.job_id), { subject_key: run.subject_key, event_kind: "intelligence.published",
        prior: {}, current: { run_id: String(run._id), published }, target_id: String(run._id), revision: current.revision + 1, kind: "analysis" });
      await scheduleNumberIntelligence(String(run.contact_number_id), session);
    }, { result: { run_id: String(run._id), findings: envelope.findings.length } });
    return { status: "completed", run_id: String(run._id) };
  } catch (error) {
    deps.onError?.(error);
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    const disabled = error instanceof CsiError && error.code === "FEATURE_DISABLED";
    await failCsiJob(lease, disabled ? "permission_denied" : "transient", 0, { result: { reason: disabled ? "application_disabled" : "application_incomplete" } });
    return { status: "retry" };
  }
}

async function publishCurrent(run: { _id: unknown; started_at?: Date | null; createdAt: Date; conversation_id?: unknown; contact_number_id?: unknown;
  manifest_digest?: string | null; mode: string; model_version: string; prompt_version: string; job_id?: unknown }, envelope: IntelligenceEnvelope, session: ClientSession) {
  const model = getIntelligenceRunModel();
  const newer = async (id: unknown) => {
    if (!id) return false;
    const current = await model.findById(id).session(session).lean();
    return Boolean(current && (+current.createdAt > +run.createdAt || (+current.createdAt === +run.createdAt && String(current._id) > String(run._id))));
  };
  if (run.conversation_id) {
    const conversation = await getLeadConversationModel().findById(run.conversation_id).session(session).orFail();
    const job = await getSalesIntelligenceJobModel().findById(run.job_id).session(session).lean();
    const pinned = job?.input_refs[1] ? await getIntelligenceEvidenceSnapshotModel().findById(job.input_refs[1]).session(session).lean() : null;
    if (!pinned || pinned.transcript_version !== conversation.latest_transcript_version || pinned.source_revision !== conversation.media_digest_sha256) return false;
    if (await newer(conversation.latest_completed_run_id)) return false;
    const result = await getLeadConversationModel().updateOne({ _id: conversation._id, latest_completed_run_id: conversation.latest_completed_run_id },
      { $set: { latest_completed_run_id: run._id, state: "complete", pending_stage: null,
        summary: { text: renderEnvelopeSummary(envelope.summary), model: run.model_version, prompt_version: run.prompt_version, created_at: new Date(),
          sections: { overview: envelope.summary.overview, customer_wanted: envelope.summary.customer_wanted, money_dates: envelope.summary.money_and_dates,
            outcome: envelope.summary.outcome, promised: envelope.summary.commitments, mismatch: envelope.summary.discrepancies } } } }, { session });
    if (result.matchedCount !== 1) throw new CsiError("REVISION_CONFLICT");
  } else {
    const number = await getContactNumberModel().findById(run.contact_number_id).session(session).orFail();
    if (await newer(number.running_summary?.run_id)) return false;
    const result = await getContactNumberModel().updateOne({ _id: number._id, revision: number.revision }, { $set: { running_summary: {
      text: renderEnvelopeSummary(envelope.summary), run_id: run._id, evidence_digest: run.manifest_digest, computed_at: new Date() } }, $inc: { revision: 1 } }, { session });
    if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
  }
  return true;
}
export async function drainIntelligenceApplications() {
  const outcomes: string[] = [];
  for (let i = 0; i < 3; i++) { const result = await runIntelligenceApplicationJob(); outcomes.push(result.status); if (result.status !== "completed") break; }
  return { outcomes };
}
