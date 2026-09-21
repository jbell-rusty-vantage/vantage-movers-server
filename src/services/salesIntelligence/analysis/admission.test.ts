import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RUNTIME_LIMITS } from "./runtime";
import { admissionPauseReason, decideAnalysisAdmission } from "./admission";

const base = { stage: "analysis" as const, estimated_cents: 20, per_recording_ceiling_cents: 25, model_version: "openai/gpt-5-mini", pricing_version: "list", limits: DEFAULT_RUNTIME_LIMITS };
const budget = { month: "2026-09", ceiling_cents: 8000, actual_cents: 415, reserved_cents: 1217 };

test("admission reasons are distinct and carry the evaluated numbers", () => {
  const admitted = decideAnalysisAdmission({ ...base, budget });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.evidence.remaining_cents, 6368);
  assert.equal(admitted.evidence.limits.steps, DEFAULT_RUNTIME_LIMITS.steps);

  const period = decideAnalysisAdmission({ ...base, budget: null });
  assert.equal(period.admitted, false);
  assert.equal(!period.admitted && period.reason, "no_active_period");
  assert.equal(period.evidence.remaining_cents, null);

  const recording = decideAnalysisAdmission({ ...base, budget, estimated_cents: 69 });
  assert.equal(!recording.admitted && recording.reason, "per_recording_ceiling");
  assert.equal(recording.evidence.estimated_cents, 69);
  assert.equal(recording.evidence.per_recording_ceiling_cents, 25);

  const monthly = decideAnalysisAdmission({ ...base, budget: { ...budget, actual_cents: 7990 }, estimated_cents: 20 });
  assert.equal(!monthly.admitted && monthly.reason, "monthly_budget");
});

test("number synthesis is not gated by the per-recording ceiling; monthly headroom still applies", () => {
  const synthesis = decideAnalysisAdmission({ ...base, stage: "number_refresh", budget, estimated_cents: 69 });
  assert.equal(synthesis.admitted, true);
  const exhausted = decideAnalysisAdmission({ ...base, stage: "number_refresh", budget: { ...budget, reserved_cents: 7990 }, estimated_cents: 69 });
  assert.equal(!exhausted.admitted && exhausted.reason, "monthly_budget");
});

test("only the per-recording refusal gets its own pause; period and monthly share the budget resume path", () => {
  assert.equal(admissionPauseReason("per_recording_ceiling"), "per_recording_ceiling");
  assert.equal(admissionPauseReason("no_active_period"), "budget_exhausted");
  assert.equal(admissionPauseReason("monthly_budget"), "budget_exhausted");
});
