import type { RuntimeLimits } from "./runtime";

/** Non-secret numbers an admission decision was made from. Persisted on the job result and run so a pause is reproducible (17 §5). */
export type AdmissionEvidence = {
  estimated_cents: number;
  per_recording_ceiling_cents: number;
  month: string | null;
  remaining_cents: number | null;
  model_version: string;
  pricing_version: string;
  limits: Pick<RuntimeLimits, "steps" | "context_tokens" | "output_tokens" | "total_input_tokens" | "total_output_tokens" | "elapsed_ms">;
};
export type AdmissionReason = "no_active_period" | "per_recording_ceiling" | "monthly_budget";
export type AdmissionDecision =
  | { admitted: true; evidence: AdmissionEvidence }
  | { admitted: false; reason: AdmissionReason; evidence: AdmissionEvidence };

export class AnalysisAdmissionError extends Error {
  constructor(readonly reason: AdmissionReason, readonly evidence: AdmissionEvidence) { super(reason); }
}

/**
 * Pure admission for one model invocation. Three reasons stay distinct because
 * each resumes on a different event: a period activating, the Owner raising
 * the per-recording ceiling (or the deployment lowering runtime limits), or
 * monthly headroom returning. `reserveCsiBudget` remains the atomic authority
 * for the monthly check; this only pre-reports it with the evaluated numbers.
 */
export function decideAnalysisAdmission(input: {
  stage: "analysis" | "number_refresh";
  budget: { month: string; ceiling_cents: number; actual_cents: number; reserved_cents: number } | null;
  estimated_cents: number;
  per_recording_ceiling_cents: number;
  model_version: string;
  pricing_version: string;
  limits: RuntimeLimits;
  structured?: boolean;
}): AdmissionDecision {
  const { steps, context_tokens, output_tokens, total_input_tokens, total_output_tokens, elapsed_ms } = input.limits;
  const evidence: AdmissionEvidence = {
    estimated_cents: input.estimated_cents, per_recording_ceiling_cents: input.per_recording_ceiling_cents,
    month: input.budget?.month ?? null,
    remaining_cents: input.budget ? Math.max(0, input.budget.ceiling_cents - input.budget.actual_cents - input.budget.reserved_cents) : null,
    model_version: input.model_version, pricing_version: input.pricing_version,
    limits: { steps, context_tokens, output_tokens, total_input_tokens, total_output_tokens, elapsed_ms },
  };
  if (!input.budget) return { admitted: false, reason: "no_active_period", evidence };
  if (input.structured) return (evidence.remaining_cents ?? 0) > 0 ? { admitted: true, evidence } : { admitted: false, reason: "monthly_budget", evidence };
  if (input.stage === "analysis" && input.estimated_cents > input.per_recording_ceiling_cents) return { admitted: false, reason: "per_recording_ceiling", evidence };
  if (input.estimated_cents > 0 && input.estimated_cents > (evidence.remaining_cents ?? 0)) return { admitted: false, reason: "monthly_budget", evidence };
  return { admitted: true, evidence };
}

/** The durable job pause a refused admission maps to. Monthly and period pauses share the budget resume path; the per-recording pause has its own. */
export const admissionPauseReason = (reason: AdmissionReason) =>
  reason === "per_recording_ceiling" ? "per_recording_ceiling" as const : "budget_exhausted" as const;
