import { z } from "zod";
import type { LanguageModel, LanguageModelUsage } from "ai" with { "resolution-mode": "import" };
import { withTransaction } from "../../../db";
import { getSalesIntelligenceAiBudgetModel } from "../../../models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAiReservationModel } from "../../../models/SalesIntelligenceAiReservation";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { reserveCsiBudget, reconcileCsiBudget } from "../aiBudget";
import { CsiError } from "../auth";
import type { JobLease } from "../jobs";
import { resolvePolicy } from "../policy";
import { billedCents, cachedInputTokens } from "./runtime";

export const STRUCTURED_STEP_MS = 600_000;
export const STRUCTURED_INVOCATION_MS = 740_000;
export class StructuredStepTimeout extends Error { constructor(readonly step: string) { super("step_timeout"); } }
export class StructuredYield extends Error { constructor() { super("step_checkpoint"); } }
export type StepPricing = { version: string; input_cents_per_million: number; output_cents_per_million: number };

export function measuredCents(usage: LanguageModelUsage, metadata: unknown, pricing: StepPricing) {
  const billed = billedCents(metadata);
  const complete = usage.inputTokens !== undefined && usage.outputTokens !== undefined;
  return { cents: billed ?? Math.ceil(((usage.inputTokens ?? 0) * pricing.input_cents_per_million +
    (usage.outputTokens ?? 0) * pricing.output_cents_per_million) / 1_000_000), complete };
}

function issuePaths(error: unknown): string[] {
  if (error instanceof z.ZodError) return error.issues.map(i => `${i.path.join(".")}:${i.code}`);
  if (error instanceof CsiError) return (error.issues ?? []).map(i => `${i.path}:${i.code}`);
  return ["output:invalid_structured_response"];
}

async function nominalCents(kind: "summary" | "findings", model: string) {
  const rows = await getSalesIntelligenceAiReservationModel().find({ stage: "analysis", step: { $regex: `^${kind}:` },
    model_version: model, status: "reconciled", usage_complete: true,
    reconciled_at: { $gte: new Date(Date.now() - 30 * 86400_000) } }).select("actual_cents").sort({ actual_cents: 1 }).lean();
  return rows.length ? Math.max(1, rows[Math.ceil(rows.length * .95) - 1].actual_cents ?? 0) : kind === "summary" ? 2 : 5;
}

/** Book each completed provider response atomically; final reconciliation releases the nominal hold. */
async function recordUsage(reservationId: string, usage: LanguageModelUsage, metadata: unknown, pricing: StepPricing) {
  const cost = measuredCents(usage, metadata, pricing), cached = cachedInputTokens(usage, metadata);
  await withTransaction(async session => {
    const row = await getSalesIntelligenceAiReservationModel().findOne({ reservation_id: reservationId, status: "reserved" }).session(session).orFail();
    await getSalesIntelligenceAiReservationModel().updateOne({ _id: row._id, status: "reserved" }, {
      $inc: { observed_steps: 1, input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0,
        observed_cents: cost.cents, settled_cents: cost.cents },
      $set: { usage_complete: row.usage_complete && cost.complete,
        reasoning_tokens: row.reasoning_tokens == null || usage.outputTokenDetails?.reasoningTokens === undefined ? null : row.reasoning_tokens + usage.outputTokenDetails.reasoningTokens,
        cached_input_tokens: cached === null ? row.cached_input_tokens : (row.cached_input_tokens ?? 0) + cached },
    }, { session });
    await getSalesIntelligenceAiBudgetModel().updateOne({ month: row.month }, { $inc: { actual_cents: cost.cents } }, { session });
  });
}

export async function updateStructuredRunUsage(runId: string) {
  const rows = await getSalesIntelligenceAiReservationModel().find({ run_id: runId }).lean();
  const policy = await resolvePolicy();
  const cents = rows.reduce((n, r) => n + (r.actual_cents ?? r.observed_cents ?? 0), 0);
  await getIntelligenceRunModel().updateOne({ _id: runId }, { $set: { usage: {
    input_tokens: rows.reduce((n, r) => n + r.input_tokens, 0), output_tokens: rows.reduce((n, r) => n + r.output_tokens, 0),
    reasoning_tokens: rows.some(r => r.reasoning_tokens == null) ? null : rows.reduce((n, r) => n + (r.reasoning_tokens ?? 0), 0),
    cached_input_tokens: rows.every(r => r.cached_input_tokens == null) ? null : rows.reduce((n, r) => n + (r.cached_input_tokens ?? 0), 0),
    actual_cents: cents, usage_complete: rows.every(r => r.status !== "reserved" && r.usage_complete),
  }, per_recording_ceiling_exceeded: cents > policy.per_recording_ceiling_cents } });
}

/** Validation retries stay local and have only an elapsed-time stop. Provider errors return to durable retry. */
export async function generateStructuredStep<T>(input: {
  kind: "summary" | "findings"; key: string; run_id: string; lease: JobLease;
  model: LanguageModel; model_id: string; pricing: StepPricing; schema: z.ZodType;
  system: string; prompt: string; validate: (value: unknown) => T;
  deadline: number; beforeProvider: () => Promise<void>;
}) {
  const { generateObject, NoObjectGeneratedError } = await import("ai");
  if (Date.now() + STRUCTURED_STEP_MS + 10_000 > input.deadline) throw new StructuredYield();
  await input.beforeProvider();
  const budget = await getSalesIntelligenceAiBudgetModel().findOne({ activated_at: { $ne: null },
    period_start: { $lte: new Date() }, period_end: { $gt: new Date() } }).lean();
  if (!budget) throw new CsiError("BUDGET_EXHAUSTED");
  const reservationId = `steps:${input.lease.job_id}:${input.lease.epoch}:${input.kind}:${input.key}`;
  await reserveCsiBudget({ reservation_id: reservationId, month: budget.month, job_id: input.lease.job_id,
    run_id: input.run_id, step: `${input.kind}:${input.key}:invocation:${input.lease.epoch}`, stage: "analysis", soft_stop: true,
    estimated_cents: await nominalCents(input.kind, input.model_id) });
  await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservationId }, { $set: {
    model_version: input.model_id, pricing_snapshot: input.pricing, usage_complete: true, reasoning_tokens: 0,
  } });
  const signal = AbortSignal.timeout(STRUCTURED_STEP_MS);
  let repair = "", uncertain = false;
  try {
    while (true) {
      if (signal.aborted) throw new StructuredStepTimeout(input.kind);
      await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservationId }, { $set: { provider_started: true } });
      let value: unknown;
      try {
        const result = await generateObject({ model: input.model, schema: input.schema, maxRetries: 0,
          system: input.system, prompt: input.prompt + repair, abortSignal: signal });
        await recordUsage(reservationId, result.usage, result.providerMetadata, input.pricing);
        value = result.object;
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) {
          // A timed-out/in-flight call can be billed without a response. Never record its usage as complete.
          uncertain = true;
          if (signal.aborted) throw new StructuredStepTimeout(input.kind);
          throw error;
        }
        if (error.usage) await recordUsage(reservationId, error.usage, undefined, input.pricing);
        else uncertain = true;
        repair = `\nThe previous response failed validation. Correct these paths: ${JSON.stringify(issuePaths(error.cause))}. Return the complete object.`;
        continue;
      }
      try { return input.validate(value); }
      catch (error) {
        if (!(error instanceof z.ZodError) && !(error instanceof CsiError && error.code === "EVIDENCE_SCOPE_INVALID")) throw error;
        const paths = issuePaths(error);
        await getIntelligenceRunModel().updateOne({ _id: input.run_id }, { $inc: { schema_failures: 1 },
          $push: { schema_rejections: { $each: paths.slice(0, 16), $slice: -32 } } });
        repair = `\nThe previous object (data) was ${JSON.stringify(value)}. Correct these validation paths: ${JSON.stringify(paths)}. Return the complete object.`;
      }
    }
  } finally {
    if (uncertain) await getSalesIntelligenceAiReservationModel().updateOne({ reservation_id: reservationId }, { $set: { usage_complete: false } });
    const row = await getSalesIntelligenceAiReservationModel().findOne({ reservation_id: reservationId }).lean();
    if (row?.status === "reserved") await reconcileCsiBudget(reservationId, row.observed_cents ?? 0);
    await updateStructuredRunUsage(input.run_id);
  }
}
