import { z } from "zod";
import type { LanguageModel, LanguageModelUsage } from "ai" with { "resolution-mode": "import" };
import { withTransaction } from "../../../db";
import { getSalesIntelligenceAiBudgetModel } from "../../../models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAiReservationModel } from "../../../models/SalesIntelligenceAiReservation";
import { reconcileCsiBudget, reserveCsiBudget, type ReservationInput } from "../aiBudget";
import { CsiError } from "../auth";
import type { JobLease } from "../jobs";
import { cachedInputTokens } from "../analysis/runtime";
import { measuredCents, StructuredStepTimeout, StructuredYield, type StepPricing } from "../analysis/structuredGeneration";
import { structuredProviderSchema } from "../analysis/structuredProviderSchema";
import {
  expandAssessment, moveAssessmentModelOutputSchema, MOVE_ASSESSMENT_PROMPT,
  type AcceptedAssessment, type EvidenceCatalogEntry, type MoveAssessmentModelOutput,
} from "./contract";
import type { AssessmentPromptPayload } from "./context";

/**
 * One Move assessment model step (MA-01 §8, specification §9). Mirrors
 * `generateStructuredStep` without an `IntelligenceRun`: the reservation is keyed by
 * job + lease epoch + artifact, every provider response (repairs included) is booked,
 * validation failures are repaired locally with their issue paths, and provider errors
 * return to the durable job. The gateway key is always injected; nothing falls back.
 */
export const ASSESSMENT_STEP_MS = 600_000;
export const DEFAULT_ASSESSMENT_NOMINAL_CENTS = 5;
export type AssessmentCredential = "AI_GATEWAY_API_KEY" | "PERSONAL_AI_GATEWAY_API_KEY";
export type AssessmentUsage = {
  input_tokens: number; output_tokens: number; reasoning_tokens: number | null; cached_input_tokens: number | null;
  actual_cents: number; usage_complete: boolean; attempts: number; credential: AssessmentCredential;
};

/** Accounting seam. Production books against the monthly ledger; unit tests inject a recorder. */
export type AssessmentLedger = {
  activeMonth(): Promise<string | null>;
  nominalCents(modelId: string): Promise<number>;
  reserve(input: ReservationInput, meta: { model_version: string; pricing: StepPricing }): Promise<void>;
  providerStarted(reservationId: string): Promise<void>;
  record(reservationId: string, usage: LanguageModelUsage, metadata: unknown, pricing: StepPricing): Promise<void>;
  markUncertain(reservationId: string): Promise<void>;
  reconcile(reservationId: string): Promise<void>;
};

const ASSESSMENT_STEP_PREFIX = "assessment:";
export const mongoAssessmentLedger: AssessmentLedger = {
  async activeMonth() {
    const now = new Date();
    const budget = await getSalesIntelligenceAiBudgetModel().findOne({ activated_at: { $ne: null },
      period_start: { $lte: now }, period_end: { $gt: now } }).select("month").lean();
    return budget?.month ?? null;
  },
  /** Trailing-30-day p95 of complete reconciled assessment reservations for this model. */
  async nominalCents(modelId) {
    const rows = await getSalesIntelligenceAiReservationModel().find({ stage: "analysis", step: { $regex: `^${ASSESSMENT_STEP_PREFIX}` },
      model_version: modelId, status: "reconciled", usage_complete: true,
      reconciled_at: { $gte: new Date(Date.now() - 30 * 86400_000) } }).select("actual_cents").sort({ actual_cents: 1 }).lean();
    return rows.length ? Math.max(1, rows[Math.ceil(rows.length * .95) - 1].actual_cents ?? 0) : DEFAULT_ASSESSMENT_NOMINAL_CENTS;
  },
  async reserve(input, meta) {
    await reserveCsiBudget(input);
    await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: input.reservation_id, status: "reserved" }, { $set: {
      model_version: meta.model_version, pricing_snapshot: meta.pricing, usage_complete: true, reasoning_tokens: 0 } });
  },
  async providerStarted(reservationId) {
    await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservationId }, { $set: { provider_started: true } });
  },
  /** Book each completed provider response atomically; final reconciliation releases the nominal hold. */
  async record(reservationId, usage, metadata, pricing) {
    const cost = measuredCents(usage, metadata, pricing), cached = cachedInputTokens(usage, metadata);
    await withTransaction(async session => {
      const Reservations = getSalesIntelligenceAiReservationModel();
      const row = await Reservations.findOne({ reservation_id: reservationId, status: "reserved" }).session(session).orFail();
      await Reservations.updateOne({ _id: row._id, status: "reserved" }, {
        $inc: { observed_steps: 1, input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0,
          observed_cents: cost.cents, settled_cents: cost.cents },
        $set: { usage_complete: row.usage_complete && cost.complete,
          reasoning_tokens: row.reasoning_tokens == null || usage.outputTokenDetails?.reasoningTokens === undefined ? null
            : row.reasoning_tokens + usage.outputTokenDetails.reasoningTokens,
          cached_input_tokens: cached === null ? row.cached_input_tokens : (row.cached_input_tokens ?? 0) + cached },
      }, { session });
      await getSalesIntelligenceAiBudgetModel().updateOne({ month: row.month }, { $inc: { actual_cents: cost.cents } }, { session });
    });
  },
  async markUncertain(reservationId) {
    await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservationId }, { $set: { usage_complete: false } });
  },
  async reconcile(reservationId) {
    const row = await getSalesIntelligenceAiReservationModel().findOne({ reservation_id: reservationId }).lean();
    if (row?.status === "reserved") await reconcileCsiBudget(reservationId, row.observed_cents ?? 0);
  },
};

export function assessmentIssuePaths(error: unknown): string[] {
  if (error instanceof z.ZodError) return error.issues.map(i => `${i.path.join(".")}:${i.code}`);
  if (error instanceof CsiError) return (error.issues ?? []).map(i => `${i.path}:${i.code}`);
  return ["output:invalid_structured_response"];
}

export type GenerateMoveAssessmentInput = {
  lease: JobLease; artifact_id: string;
  /** Test/backfill injection; otherwise the gateway model is built from `gateway_key`. */
  model?: LanguageModel; model_id: string; gateway_key?: string; credential: AssessmentCredential;
  pricing: StepPricing; prompt_payload: AssessmentPromptPayload; catalog: readonly EvidenceCatalogEntry[];
  /** Absolute epoch ms by which the whole invocation must end. */
  deadline: number;
  beforeProvider?: () => Promise<void>;
  onProviderCall?: () => void;
  ledger?: AssessmentLedger;
};
export type GeneratedMoveAssessment = { accepted: AcceptedAssessment; model_output: MoveAssessmentModelOutput; usage: AssessmentUsage };

export async function generateMoveAssessment(input: GenerateMoveAssessmentInput): Promise<GeneratedMoveAssessment> {
  // Before any reservation: a missing credential never reaches the ledger or the provider.
  if (!input.model && !input.gateway_key?.trim()) throw new CsiError("FEATURE_DISABLED");
  const ledger = input.ledger ?? mongoAssessmentLedger;
  const { generateObject, NoObjectGeneratedError } = await import("ai");
  const model = input.model ?? (await import("@ai-sdk/gateway")).createGateway({ apiKey: input.gateway_key })(input.model_id);
  const providerSchema = await structuredProviderSchema(moveAssessmentModelOutputSchema);
  if (Date.now() + ASSESSMENT_STEP_MS + 10_000 > input.deadline) throw new StructuredYield();
  await input.beforeProvider?.();
  const month = await ledger.activeMonth();
  if (!month) throw new CsiError("BUDGET_EXHAUSTED");
  const { lease, artifact_id, credential } = input;
  const reservationId = `steps:${lease.job_id}:${lease.epoch}:assessment:${artifact_id}`;
  await ledger.reserve({ reservation_id: reservationId, month, job_id: lease.job_id, run_id: null,
    step: `${ASSESSMENT_STEP_PREFIX}${artifact_id}:${credential}:${lease.epoch}`, stage: "analysis", soft_stop: true,
    estimated_cents: await ledger.nominalCents(input.model_id) }, { model_version: input.model_id, pricing: input.pricing });
  const usage: AssessmentUsage = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_input_tokens: null,
    actual_cents: 0, usage_complete: true, attempts: 0, credential };
  const observe = async (observed: LanguageModelUsage, metadata: unknown) => {
    await ledger.record(reservationId, observed, metadata, input.pricing);
    const cost = measuredCents(observed, metadata, input.pricing), cached = cachedInputTokens(observed, metadata);
    usage.input_tokens += observed.inputTokens ?? 0; usage.output_tokens += observed.outputTokens ?? 0;
    const reasoning = observed.outputTokenDetails?.reasoningTokens;
    usage.reasoning_tokens = usage.reasoning_tokens === null || reasoning === undefined ? null : usage.reasoning_tokens + reasoning;
    if (cached !== null) usage.cached_input_tokens = (usage.cached_input_tokens ?? 0) + cached;
    usage.actual_cents += cost.cents;
    if (!cost.complete) usage.usage_complete = false;
  };
  const prompt = JSON.stringify(input.prompt_payload);
  const signal = AbortSignal.timeout(ASSESSMENT_STEP_MS);
  let repair = "", uncertain = false;
  try {
    while (true) {
      if (signal.aborted) throw new StructuredStepTimeout("assessment");
      await ledger.providerStarted(reservationId);
      usage.attempts++;
      input.onProviderCall?.();
      let value: unknown;
      try {
        const result = await generateObject({ model, schema: providerSchema, maxRetries: 0,
          system: MOVE_ASSESSMENT_PROMPT, prompt: prompt + repair, abortSignal: signal });
        await observe(result.usage, result.providerMetadata);
        value = result.object;
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) {
          // A timed-out/in-flight call can be billed without a response. Never record its usage as complete.
          uncertain = true;
          if (signal.aborted) throw new StructuredStepTimeout("assessment");
          throw error;
        }
        if (error.usage) await observe(error.usage, undefined);
        else uncertain = true;
        repair = `\nThe previous response failed validation. Correct these paths: ${JSON.stringify(assessmentIssuePaths(error.cause))}. Return the complete object.`;
        continue;
      }
      try {
        const accepted = expandAssessment(value, input.catalog);
        return { accepted, model_output: accepted.model_output, usage };
      } catch (error) {
        if (!(error instanceof z.ZodError) && !(error instanceof CsiError && error.code === "EVIDENCE_SCOPE_INVALID")) throw error;
        repair = `\nThe previous object (data) was ${JSON.stringify(value)}. Correct these validation paths: ${JSON.stringify(assessmentIssuePaths(error))}. Cite only the supplied evidence ids. Return the complete object.`;
      }
    }
  } finally {
    if (uncertain) { usage.usage_complete = false; await ledger.markUncertain(reservationId); }
    await ledger.reconcile(reservationId);
  }
}
