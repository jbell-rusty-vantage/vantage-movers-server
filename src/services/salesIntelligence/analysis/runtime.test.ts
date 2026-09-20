import assert from "node:assert/strict";
import { test } from "node:test";
import { billedCents, contextTokenCeiling, runtimeLimitsSchema, DEFAULT_RUNTIME_LIMITS } from "./runtime";
import { estimateAnalysisCents } from "./worker";
import { resolveQuotedMoney } from "./apply";

test("missing, negative and invalid billed usage never becomes a known zero", () => {
  for (const value of [{}, { gateway: {} }, { gateway: { cost: -1 } }, { gateway: { cost: "unknown" } }]) assert.equal(billedCents(value), null);
  assert.equal(billedCents({ gateway: { cost: 0 } }), 0);
  assert.equal(billedCents({ gateway: { cost: "0.001" } }), 1);
});
test("reservation covers all bounded inputs, reasoning/output and per-step cent rounding", () => {
  const limits = { ...DEFAULT_RUNTIME_LIMITS, steps: 3, total_input_tokens: 1000, total_output_tokens: 2000 };
  assert.equal(estimateAnalysisCents({ version: "synthetic", input_cents_per_million: 1000, output_cents_per_million: 2000 }, limits), 7);
  assert.equal(runtimeLimitsSchema.safeParse({ ...limits, steps: 1000 }).success, false);
  assert(contextTokenCeiling({ text: "😀" }) > JSON.stringify({ text: "😀" }).length);
});
test("default cumulative budgets permit every configured step at its per-step ceiling", () => {
  const limits = runtimeLimitsSchema.parse(DEFAULT_RUNTIME_LIMITS);
  assert(limits.steps >= 12);
  assert(limits.total_input_tokens >= limits.steps * limits.context_tokens);
  assert(limits.total_output_tokens >= limits.steps * limits.output_tokens);
  assert(limits.elapsed_ms < 300_000, "leave room within the default five-minute job lease");
});
test("server money resolution accepts exact amounts and preserves ambiguity instead of guessing", () => {
  assert.equal(resolveQuotedMoney("$1,250.25", "USD"), 125025);
  for (const value of ["about $500", "$100 or $200", "$12.999", "1,00"]) assert.equal(resolveQuotedMoney(value, "USD"), null);
  assert.equal(resolveQuotedMoney("500", "EUR"), null);
});
