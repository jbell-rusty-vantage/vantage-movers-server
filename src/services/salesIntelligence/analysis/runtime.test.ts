import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { billedCents, contextTokenCeiling, runtimeLimitsSchema, DEFAULT_RUNTIME_LIMITS } from "./runtime";
import { CSI_ANALYSIS_LEASE_TTL_MS, CSI_FUNCTION_MAX_DURATION_MS, estimateAnalysisCents } from "./worker";
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
  assert(limits.steps >= 2, "one submission plus one focused repair");
  assert(limits.total_input_tokens >= limits.steps * limits.context_tokens);
  assert(limits.total_output_tokens >= limits.steps * limits.output_tokens);
  assert(limits.elapsed_ms < CSI_ANALYSIS_LEASE_TTL_MS, "leave room within the lease renewed before the provider phase");
  assert(limits.elapsed_ms + 10_000 <= CSI_FUNCTION_MAX_DURATION_MS, "one provider invocation must finish inside the deployed function");
});
test("the deployed function limit is the same number in vercel.json for both analysis paths", () => {
  // Both the crons (`api/index.ts`) and the queue consumer run analysis. A
  // limit that disagreed with `CSI_FUNCTION_MAX_DURATION_MS` would resurface
  // exactly the killed-invocation strand that 18 had to clean up (22 §2).
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { functions: Record<string, { maxDuration?: number; experimentalTriggers?: unknown[] }> };
  for (const path of ["api/index.ts", "api/queues/sales-intelligence-consumer.ts"])
    assert.equal(config.functions[path]?.maxDuration, CSI_FUNCTION_MAX_DURATION_MS / 1000, path);
  assert(config.functions["api/queues/sales-intelligence-consumer.ts"]?.experimentalTriggers?.length, "consumer keeps its queue registration");
});
test("default reservation fits the default per-recording ceiling at extraction list pricing", () => {
  // openai/gpt-5-mini list pricing in cents per million tokens; a different
  // deployed price is reported through the admission evidence, not guessed here.
  const estimate = estimateAnalysisCents({ version: "list", input_cents_per_million: 25, output_cents_per_million: 200 }, DEFAULT_RUNTIME_LIMITS);
  assert(estimate <= 25, `estimate ${estimate} exceeds the 25-cent default per-recording ceiling`);
});
test("server money resolution accepts exact amounts and preserves ambiguity instead of guessing", () => {
  assert.equal(resolveQuotedMoney("$1,250.25", "USD"), 125025);
  for (const value of ["about $500", "$100 or $200", "$12.999", "1,00"]) assert.equal(resolveQuotedMoney(value, "USD"), null);
  assert.equal(resolveQuotedMoney("500", "EUR"), null);
});
