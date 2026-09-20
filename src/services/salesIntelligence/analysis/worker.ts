import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withTransaction } from "../../../db";
import { CSI_EXTRACTION_MODELS, csiDataset, csiFlag, csiProviderConfiguration } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../../models/IntelligenceSubmission";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getSalesIntelligenceAiBudgetModel } from "../../../models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAiReservationModel } from "../../../models/SalesIntelligenceAiReservation";
import { reserveCsiBudget, reconcileCsiBudget, resumeBudgetPausedJobs } from "../aiBudget";
import { claimCsiJob, completeCsiJob, checkpointCsiJob, failCsiJob } from "../jobs";
import { resolvePolicy } from "../policy";
import { CsiError } from "../auth";
import { prepareIntelligenceRun, recoverIntelligenceSubmission } from "./run";
import { conversationAnalysisInput, intelligenceSources, numberAnalysisInput } from "./sources";
import { DEFAULT_RUNTIME_LIMITS, runtimeLimitsSchema, invokeIntelligenceAgent, IntelligenceRuntimeError, type InvocationInput, type RuntimeLimits } from "./runtime";
import { publishCaptureProjectionWakeup } from "../../numberActivity/webhookFanout";
import { applicationReady, resumeApplicationIntents } from "./readiness";
import { consumeNumberRefreshSignal, scanIntelligenceChanges } from "./scheduling";
import { resumeTranscriptAnalysisJobs } from "../conversations/transcribe";
import { retainedOriginal } from "./ownerReanalysis";
import { intelligenceReadSchema, intelligenceToolArguments } from "./contracts";
import { readContentSchema } from "./reads";
import { retryAfterMs } from "../../ringcentral/recordings";
import { ensureCurrentCsiBudgetPeriod } from "../budgetPeriod";

export const pricingSchema = z.object({ version: z.string().min(1), input_cents_per_million: z.number().positive(), output_cents_per_million: z.number().positive() }).strict();
export type AnalysisPricing = z.infer<typeof pricingSchema>;
export function analysisRuntimeConfiguration() {
  const provider = csiProviderConfiguration();
  const pricing = pricingSchema.safeParse({ version: process.env.SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION,
    input_cents_per_million: Number(process.env.SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION),
    output_cents_per_million: Number(process.env.SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION) });
  let limits = DEFAULT_RUNTIME_LIMITS;
  if (process.env.SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON) limits = runtimeLimitsSchema.parse(JSON.parse(process.env.SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON));
  return { endpoint: provider.mcpEndpoint ?? "", key: process.env.SALES_INTELLIGENCE_MCP_API_SECRET ?? "", gateway_key: provider.gatewayKey,
    model_id: provider.extractionModel, pricing: pricing.success ? pricing.data : null, limits };
}
export type AnalysisDependencies = { configuration?: ReturnType<typeof analysisRuntimeConfiguration>; model?: InvocationInput["model"];
  limits?: RuntimeLimits; beforeProvider?: () => Promise<void>; afterReceipt?: () => Promise<void>;
  publish?: typeof publishCaptureProjectionWakeup };
export function estimateAnalysisCents(pricing: AnalysisPricing, limits: RuntimeLimits) {
  return Math.ceil((limits.total_input_tokens * pricing.input_cents_per_million + limits.total_output_tokens * pricing.output_cents_per_million) / 1_000_000) + limits.steps - 1;
}
export const analysisEnabled = () => csiFlag("ENABLED") && csiFlag("EXTRACTION_ENABLED");

export function isHistoricalBackfillOnly(sources: readonly string[] | undefined): boolean {
  const list = sources ?? [];
  return list.includes("backfill") && !list.some((s) => s === "webhook" || s === "call_log_reconcile");
}

async function analysisModeForJob(
  job: { input_refs: unknown[]; owner_reanalysis?: { mode: string } | null },
  stage: "analysis" | "number_refresh",
): Promise<"initial" | "number_refresh" | "backfill" | "original_evidence" | "current_context"> {
  if (job.owner_reanalysis?.mode === "original_evidence" || job.owner_reanalysis?.mode === "current_context") {
    return job.owner_reanalysis.mode;
  }
  if (stage === "number_refresh") return "number_refresh";
  if (stage === "analysis" && job.input_refs.length === 2) {
    const conversation = await getLeadConversationModel().findById(String(job.input_refs[0])).lean();
    if (conversation?.call_interaction_id) {
      const interaction = await getCallInteractionModel().findById(conversation.call_interaction_id).lean();
      if (interaction && isHistoricalBackfillOnly(interaction.sources)) return "backfill";
    }
  }
  return "initial";
}

function analysisProviderFailure(error: unknown): { kind: "throttled" | "permission_denied" | "transient"; retryAfterMs: number } | null {
  const candidate = error as { statusCode?: number; status?: number; responseHeaders?: Record<string, string>; headers?: Record<string, string> };
  const status = candidate.statusCode ?? candidate.status;
  if (status === 429) {
    const raw = candidate.responseHeaders?.["retry-after"] ?? candidate.headers?.["retry-after"];
      return { kind: "throttled", retryAfterMs: retryAfterMs(raw ?? null, new Date()) };
  }
  if (status === 401 || status === 403) return { kind: "permission_denied", retryAfterMs: 0 };
  if (typeof status === "number" && status >= 500) return { kind: "transient", retryAfterMs: 0 };
  return null;
}

/** Queue and cron entry point. One bounded invocation; never transcription or provider retries. */
export async function runIntelligenceJob(jobId?: string, stage: "analysis" | "number_refresh" = "analysis", deps: AnalysisDependencies = {}) {
  if (!analysisEnabled()) return { status: "disabled" };
  const job = await claimCsiJob(`csi-analysis:${randomUUID()}`, jobId, 300_000, stage);
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  let reservation: string | null = null, providerStarted = false, returned = false, usageComplete = true;
  let inputTokens = 0, outputTokens = 0, actualCents = 0, steps = 0;
  let reasoningTokens: number | null = 0;
  let runId: string | null = null;
  const finish = async (receipt: Awaited<ReturnType<typeof recoverIntelligenceSubmission>>) => {
    if (!receipt) throw new IntelligenceRuntimeError("receipt_missing");
    await completeCsiJob(lease, async session => {
      const run = await getIntelligenceRunModel().findById(receipt.run_id).session(session).orFail();
      await getIntelligenceRunModel().updateOne({ _id: receipt.run_id, ...csiDataset() }, { $set: { invocation_complete: true,
        processing_reason: providerStarted && !usageComplete ? "analysis_cost_unreported" : null } }, { session });
      if (run.mode === "number_refresh") await getContactNumberModel().updateOne({ _id: run.contact_number_id, "intelligence_schedule.job_id": job._id },
        { $set: { "intelligence_schedule.fingerprint": run.input_fingerprint } }, { session });
      if (applicationReady()) await getSalesIntelligenceJobModel().updateOne({ _id: receipt.application_job_id, ...csiDataset(), status: "paused",
        reason: { $in: ["invocation_pending", "consumer_unavailable"] } }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } }, { session });
    }, { result: { run_id: receipt.run_id, submission_id: receipt.submission_id } });
    if (applicationReady()) await (deps.publish ?? publishCaptureProjectionWakeup)(receipt.application_job_id).catch(() => undefined);
    return { status: "submitted", run_id: receipt.run_id };
  };
  try {
    if (stage === "number_refresh" && !job.owner_reanalysis && !job.dedupe_key.startsWith("csi:number-analysis:")) {
      await completeCsiJob(lease, session => consumeNumberRefreshSignal(job.subject_key, job.input_refs, session));
      return { status: "coalesced" };
    }
    const prior = await getIntelligenceRunModel().findOne({ job_id: job._id, ...csiDataset() }).lean();
    if (prior) {
      runId = String(prior._id);
      const receipt = await recoverIntelligenceSubmission(runId, lease);
      if (receipt) return await finish(receipt);
    }
    const config = deps.configuration ?? analysisRuntimeConfiguration(), limits = deps.limits ?? config.limits;
    if (!config.pricing || !config.endpoint || !config.key || (!deps.model && !config.gateway_key) || (prior && prior.model_version !== config.model_id) || !(CSI_EXTRACTION_MODELS as readonly string[]).includes(config.model_id)) {
      await failCsiJob(lease, "permission_denied", 0, { result: { reason: "analysis_configuration_missing" } }); return { status: "paused" };
    }
    const original = job.owner_reanalysis?.mode === "original_evidence" ? await retainedOriginal(String(job.owner_reanalysis.source_run_id)) : null;
    const input = await withTransaction(async session => {
      if (original) {
        const transcripts = original.snapshots.flatMap(s => { const content = readContentSchema.parse(s.response); return content.transcript ? [content.transcript] : []; });
        return { status: "eligible" as const, contact_number_id: String(original.run.contact_number_id),
          conversation_id: original.run.conversation_id ? String(original.run.conversation_id) : null,
          outreach_record_id: original.run.outreach_record_id ? String(original.run.outreach_record_id) : null,
          fingerprint: original.run.input_fingerprint, conversation_ids: [...new Set(transcripts.map(t => t.conversation_id))],
          versions: [...new Set(transcripts.map(t => t.source_snapshot_id))], interaction_ids: [] as string[] };
      }
      if (stage === "analysis") {
        if (job.input_refs.length !== 2 || job.subject_key !== `conversation:${job.input_refs[0]}`) throw new CsiError("EVIDENCE_SCOPE_INVALID");
        const value = await conversationAnalysisInput(String(job.input_refs[0]), String(job.input_refs[1]), session);
        if (value.status !== "eligible") return value;
        const sources = await intelligenceSources(String(value.conversation.contact_number_id), session);
        return { status: "eligible" as const, contact_number_id: String(value.conversation.contact_number_id), conversation_id: String(value.conversation._id),
          outreach_record_id: value.outreach_record_id, fingerprint: sources.fingerprint,
          conversation_ids: [String(value.conversation._id)], versions: [String(value.snapshot._id)], interaction_ids: [String(value.call._id)] };
      }
      const numberId = job.subject_key.startsWith("number:") ? job.subject_key.slice(7) : "";
      if (!/^[a-f0-9]{24}$/.test(numberId)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      const numberInput = await numberAnalysisInput(numberId, session);
      if (numberInput.status !== "eligible") return { status: numberInput.status };
      const { sources } = numberInput;
      return { status: "eligible" as const, contact_number_id: numberId, conversation_id: null, outreach_record_id: null,
        fingerprint: sources.fingerprint, conversation_ids: numberInput.conversation_ids, versions: numberInput.versions, interaction_ids: sources.calls.map(c => String(c._id)) };
    });
    if (input.status === "undetermined") { await failCsiJob(lease, "eligibility_pending", 600_000); return { status: "eligibility_pending" }; }
    if (input.status !== "eligible") {
      await completeCsiJob(lease, async session => {
        if (runId) await getIntelligenceRunModel().updateOne({ _id: runId, finalized_at: null }, { $set: { status: "stale", processing_reason: input.status, completed_at: new Date() } }, { session });
      }, { result: { reason: input.status } });
      return { status: input.status };
    }
    if (prior?.status === "paused") await checkpointCsiJob(lease, async session => {
      await getIntelligenceRunModel().updateOne({ _id: prior._id, finalized_at: null, status: "paused" }, { $set: { status: "running", processing_reason: null } }, { session });
    });
    const analysisMode = await analysisModeForJob(job, stage);
    const prepared = await prepareIntelligenceRun(lease, { contact_number_id: input.contact_number_id, conversation_id: input.conversation_id,
      outreach_record_id: prior?.outreach_record_id ? String(prior.outreach_record_id) : input.outreach_record_id,
      input_fingerprint: prior?.input_fingerprint ?? input.fingerprint, model_version: prior?.model_version ?? config.model_id,
      mode: analysisMode,
      ...(job.owner_reanalysis ? { run_id: String(job.owner_reanalysis.run_id), parent_run_id: original ? String(original.run._id) : null,
        owner_correction_ids: job.owner_reanalysis.owner_correction_ids.map(String) } : {}) });
    runId = prepared.run_id;
    const budget = await getSalesIntelligenceAiBudgetModel().findOne({ period_start: { $lte: new Date() }, period_end: { $gt: new Date() }, activated_at: { $ne: null } }).lean();
    const estimate = estimateAnalysisCents(config.pricing, limits), policy = await resolvePolicy();
    if (!budget || (stage === "analysis" && estimate > policy.per_recording_ceiling_cents)) throw new CsiError("BUDGET_EXHAUSTED");
    reservation = `analysis:${job._id}:${lease.epoch}`;
    await reserveCsiBudget({ reservation_id: reservation, month: budget.month, job_id: lease.job_id, run_id: runId,
      step: `invocation:${lease.epoch}`, stage: "analysis", estimated_cents: estimate });
    await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservation }, { $set: { model_version: config.model_id, pricing_snapshot: config.pricing } });
    await checkpointCsiJob(lease, async session => {
      await getIntelligenceRunModel().updateOne({ _id: runId }, { $set: { pricing_snapshot: config.pricing } }, { session });
    });
    const receipt = await invokeIntelligenceAgent({ ...config, limits, model: deps.model, run_id: runId, token: prepared.token,
      prompt: prepared.prompt_context.rendered_prompt!, schema_digest: prepared.prompt_context.schema_digest!,
      schema_failures: prior?.schema_failures ?? 0, onInvocationComplete: () => { returned = true; },
      conversation_ids: input.conversation_ids, interaction_ids: input.interaction_ids,
      ...(original ? { original_reads: original.snapshots.map(s => s.tool_name === "get_intelligence_context"
        ? { tool: "get_intelligence_context" as const, args: intelligenceToolArguments.get_intelligence_context.parse(s.arguments) }
        : intelligenceReadSchema.parse({ tool: s.tool_name, args: s.arguments })) } : {}),
      beforeProvider: async () => {
        if (!analysisEnabled()) throw new CsiError("FEATURE_DISABLED");
        await deps.beforeProvider?.();
        if (original) {
          await retainedOriginal(String(original.run._id));
        } else if (input.conversation_id) {
          const latest = await withTransaction(session => conversationAnalysisInput(input.conversation_id!, String(job.input_refs[1]), session));
          if (latest.status !== "eligible") throw new IntelligenceRuntimeError("eligibility_changed");
        } else {
          const latest = await withTransaction(session => numberAnalysisInput(input.contact_number_id, session));
          if (latest.status !== "eligible" || JSON.stringify(latest.versions) !== JSON.stringify(input.versions)) throw new IntelligenceRuntimeError("eligibility_changed");
        }
        await checkpointCsiJob(lease, async session => {
          await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservation }, { $set: { provider_started: true } }, { session });
        });
        providerStarted = true;
      },
      onStep: async step => {
        steps++; inputTokens += step.usage.inputTokens ?? 0; outputTokens += step.usage.outputTokens ?? 0;
        const reasoning = step.usage.outputTokenDetails.reasoningTokens;
        reasoningTokens = reasoningTokens === null || reasoning === undefined ? null : reasoningTokens + reasoning;
        if (step.actual_cents === null || step.usage.inputTokens === undefined || step.usage.outputTokens === undefined) usageComplete = false;
        actualCents += step.actual_cents ?? 0;
        await getIntelligenceRunModel().updateOne({ _id: runId }, { $max: { schema_failures: step.schema_failures } });
        // Billing observations survive lease loss; only domain/application writes require its fence.
        await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservation, status: "reserved" }, { $set: {
          observed_steps: steps, input_tokens: inputTokens, output_tokens: outputTokens, reasoning_tokens: reasoningTokens,
          observed_cents: actualCents, usage_complete: usageComplete } });
      },
    });
    returned = true;
    await deps.afterReceipt?.();
    return await finish(receipt);
  } catch (error) {
    if (runId) {
      const receipt = await recoverIntelligenceSubmission(runId, lease).catch(() => null);
      if (receipt) return await finish(receipt);
    }
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    const provider = analysisProviderFailure(error);
    if (provider) {
      const failReason = provider.kind;
      const outcome = await failCsiJob(lease, failReason, provider.retryAfterMs, {
        result: { reason: failReason },
        mutation: async (session, outcome) => {
          if (runId) await getIntelligenceRunModel().updateOne({ _id: runId, finalized_at: null }, {
            $set: {
              processing_reason: failReason,
              status: outcome.status === "paused" ? "paused" : outcome.status === "dead_letter" ? "failed" : "running",
            },
          }, { session });
        },
      });
      return { status: failReason === "permission_denied" ? "paused" : outcome.status, reason: failReason };
    }
    const budget = error instanceof CsiError && error.code === "BUDGET_EXHAUSTED";
    const bounded = error instanceof IntelligenceRuntimeError;
    const eligibility = bounded && error.reason === "eligibility_changed", disabled = error instanceof CsiError && error.code === "FEATURE_DISABLED";
    const unavailable = error instanceof CsiError && error.code === "ORIGINAL_EVIDENCE_UNAVAILABLE";
    const reason = budget ? "budget_exhausted" : unavailable ? "original_evidence_unavailable" : disabled ? "analysis_disabled" : bounded ? error.reason : "analysis_failed";
    await failCsiJob(lease, budget ? "budget_exhausted" : eligibility ? "eligibility_pending" : bounded || disabled || unavailable ? "permission_denied" : "transient", eligibility ? 600_000 : 0, { result: { reason },
      mutation: async (session, outcome) => { if (runId) await getIntelligenceRunModel().updateOne({ _id: runId, finalized_at: null }, { $set: { processing_reason: reason,
        status: outcome.status === "paused" ? "paused" : outcome.status === "dead_letter" ? "failed" : "running" } }, { session }); } });
    return { status: eligibility ? "eligibility_pending" : budget || bounded || disabled || unavailable ? "paused" : "retry", reason };
  } finally {
    if (reservation && await getSalesIntelligenceAiReservationModel().exists({ reservation_id: reservation })) {
      if (!providerStarted) await reconcileCsiBudget(reservation, 0, true);
      else if (returned && usageComplete && steps) await reconcileCsiBudget(reservation, actualCents);
      if (runId) {
        const rows = await getSalesIntelligenceAiReservationModel().find({ run_id: runId }).lean();
        await getIntelligenceRunModel().updateOne({ _id: runId }, { $set: { usage: {
          input_tokens: rows.reduce((n, r) => n + r.input_tokens, 0), output_tokens: rows.reduce((n, r) => n + r.output_tokens, 0),
          reasoning_tokens: rows.some(r => r.reasoning_tokens == null) ? null : rows.reduce((n, r) => n + (r.reasoning_tokens ?? 0), 0), usage_complete: rows.every(r => r.status !== "reserved"),
          actual_cents: rows.some(r => r.status === "reserved") ? null : rows.reduce((n, r) => n + (r.actual_cents ?? 0), 0),
        } } });
      }
    }
  }
}
export async function drainIntelligenceJobs(deps: AnalysisDependencies = {}) {
  if (!analysisEnabled()) return { status: "disabled" };
  await ensureCurrentCsiBudgetPeriod();
  await resumeBudgetPausedJobs();
  await getSalesIntelligenceJobModel().updateMany({ ...csiDataset(), stage: { $in: ["analysis", "number_refresh"] },
    status: "paused", reason: "permission_denied", "result.reason": "analysis_disabled" }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
  await recoverExhaustedIntelligenceReceipts();
  await resumeApplicationIntents();
  await resumeTranscriptAnalysisJobs();
  await scanIntelligenceChanges();
  const result = await runIntelligenceJob(undefined, "analysis", deps);
  return result.status === "not_claimable" ? runIntelligenceJob(undefined, "number_refresh", deps) : result;
}

/** A receipt committed on the final crashed claim must not strand invocation_pending application.
 * Re-admit only a proven receipt; the normal worker recovers it before configuration/provider work. */
export async function recoverExhaustedIntelligenceReceipts() {
  if (!analysisEnabled()) return 0;
  return withTransaction(async session => {
    const jobs = await getSalesIntelligenceJobModel().find({ ...csiDataset(), stage: { $in: ["analysis", "number_refresh"] },
      "result.failure_projected": { $ne: true },
      $expr: { $gte: ["$attempts", "$max_attempts"] }, $or: [{ status: "dead_letter", reason: "attempts_exhausted" },
        { status: "leased", leased_until: { $lte: new Date() } }] }).sort({ _id: 1 }).limit(5).session(session).lean();
    let recovered = 0;
    for (const job of jobs) {
      const run = await getIntelligenceRunModel().findOne({ job_id: job._id, ...csiDataset(), subject_key: job.subject_key }).session(session).lean();
      if (!run || run.purged_at || run.status !== "submitted" || !await getIntelligenceSubmissionModel().exists({ run_id: run._id, purged_at: null }).session(session)) {
        await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: job.status, lease_epoch: job.lease_epoch },
          { $set: { status: "dead_letter", reason: "attempts_exhausted", lease_owner: null, leased_until: null,
            result: { reason: "attempts_exhausted", failure_projected: true } } }, { session });
        if (run && !run.finalized_at) await getIntelligenceRunModel().updateOne({ _id: run._id, finalized_at: null },
          { $set: { status: "failed", processing_reason: "attempts_exhausted" } }, { session });
        continue;
      }
      const result = await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: job.status, lease_epoch: job.lease_epoch },
        { $set: { status: "retry", reason: "receipt_recovery", attempts: job.max_attempts - 1, lease_owner: null, leased_until: null, next_attempt_at: new Date() } }, { session });
      recovered += result.modifiedCount;
    }
    return recovered;
  });
}
