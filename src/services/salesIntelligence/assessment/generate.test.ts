import assert from "node:assert/strict";
import { test } from "node:test";
import { CsiError } from "../auth";
import type { EvidenceCatalogEntry, MoveAssessmentModelOutput } from "./contract";
import type { AssessmentPromptPayload } from "./context";
import { generateMoveAssessment, type AssessmentLedger, type GenerateMoveAssessmentInput } from "./generate";

const lease = { job_id: "aaaaaaaaaaaaaaaaaaaaaaaa", owner: "synthetic", epoch: 3 };
const artifact_id = "bbbbbbbbbbbbbbbbbbbbbbbb";
const call = { source: "summary_artifact" as const, snapshot_id: "s1", content_digest: "d1", conversation_id: "c1", transcript_version: "v1" };
const catalog: EvidenceCatalogEntry[] = [
  { id: "e1", kind: "said_on_call", text: "We are definitely moving on October 15", speaker: "customer", call_at: "2026-09-20T15:00:00.000Z",
    lineage: [], locator: { ...call, section: "said_on_call.0" } },
  { id: "e2", kind: "summary_section", text: "Customer liked the quote.", call_at: "2026-09-20T15:00:00.000Z", lineage: [], locator: { ...call, section: "outcome" } },
];
const payload: AssessmentPromptPayload = { subject: { kind: "lead", lead_model: "FormLead", no_conversation_evidence: false },
  context_as_of: "2026-09-22T12:00:00.000Z", views: { original_ingestion: null, canonical_current: null }, official: null, corrections: [],
  conversations: [{ call_at: "2026-09-20T15:00:00.000Z", entries: catalog.map(e => ({ id: e.id, kind: e.kind, speaker: e.speaker ?? "unknown", text: e.text })) }],
  findings: [] };
const dimension = (level: MoveAssessmentModelOutput["move_likelihood"]["level"], evidence_ids: string[]) =>
  ({ level, confidence: "medium" as const, rationale: `Selected ${level} from cited evidence.`, evidence_ids, conditions: [] });
const valid: MoveAssessmentModelOutput = { move_likelihood: dimension("confirmed", ["e1"]), transaction_intent: dimension("active", ["e2"]),
  move_details: [], inventory: { items: [], coverage: "none", limitations: [] }, conflicts: [],
  engagement: { work_status: "unknown", rationale: "No engagement evidence.", evidence_ids: [], promised_callbacks: [], next_steps: [] } };

function recorder() {
  const events: string[] = [], reservations: Array<{ reservation_id: string; step: string; estimated_cents: number; run_id: string | null }> = [];
  const ledger: AssessmentLedger = {
    activeMonth: async () => { events.push("month"); return "2026-09"; },
    nominalCents: async () => 5,
    reserve: async input => { events.push("reserve"); reservations.push(input); },
    providerStarted: async () => { events.push("started"); },
    record: async () => { events.push("record"); },
    markUncertain: async () => { events.push("uncertain"); },
    reconcile: async () => { events.push("reconcile"); },
  };
  return { ledger, events, reservations };
}
async function mockModel(outputs: unknown[], cost = 0.02) {
  const { MockLanguageModelV4 } = await import("ai/test");
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({ doGenerate: async input => {
    assert.equal(input.tools?.length ?? 0, 0, "the assessment step never offers tools");
    prompts.push(JSON.stringify(input.prompt));
    const next = outputs[Math.min(prompts.length - 1, outputs.length - 1)];
    if (next instanceof Error) throw next;
    return { content: [{ type: "text", text: JSON.stringify(next) }], finishReason: { unified: "stop", raw: "synthetic" },
      usage: { inputTokens: { total: 200, noCache: 200, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 40, reasoning: 10 } },
      warnings: [], providerMetadata: { gateway: { cost } } };
  } });
  return { model, prompts };
}
const base = (ledger: AssessmentLedger, extra: Partial<GenerateMoveAssessmentInput> = {}): GenerateMoveAssessmentInput => ({
  lease, artifact_id, model_id: "openai/gpt-5-mini", credential: "AI_GATEWAY_API_KEY",
  pricing: { version: "synthetic", input_cents_per_million: 1, output_cents_per_million: 1 },
  prompt_payload: payload, catalog, deadline: Date.now() + 740_000, ledger, ...extra });

test("missing gateway key and no injected model refuses before any reservation or provider call", async () => {
  const { ledger, events } = recorder();
  await assert.rejects(generateMoveAssessment(base(ledger, { gateway_key: "  " })),
    (error: unknown) => error instanceof CsiError && error.code === "FEATURE_DISABLED");
  assert.deepEqual(events, []);
});

test("personal vs company credential is recorded in the reservation step and on usage", async () => {
  for (const credential of ["AI_GATEWAY_API_KEY", "PERSONAL_AI_GATEWAY_API_KEY"] as const) {
    const { ledger, reservations } = recorder(), { model } = await mockModel([valid]);
    const result = await generateMoveAssessment(base(ledger, { model, credential }));
    assert.equal(result.usage.credential, credential);
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].reservation_id, `steps:${lease.job_id}:3:assessment:${artifact_id}`);
    assert.equal(reservations[0].step, `assessment:${artifact_id}:${credential}:3`);
    assert.equal(reservations[0].run_id, null);
    assert.equal(reservations[0].estimated_cents, 5);
  }
});

test("one call returns the accepted assessment with measured usage and reconciles once", async () => {
  const { ledger, events } = recorder(), { model, prompts } = await mockModel([valid]);
  const result = await generateMoveAssessment(base(ledger, { model }));
  assert.equal(prompts.length, 1);
  assert.equal(result.accepted.scores.move_likelihood.score, 100);
  assert.equal(result.accepted.scores.transaction_intent.score, 50);
  assert.deepEqual(result.model_output, valid);
  assert.deepEqual(result.usage, { input_tokens: 200, output_tokens: 50, reasoning_tokens: 10, cached_input_tokens: 0,
    actual_cents: 2, usage_complete: true, attempts: 1, credential: "AI_GATEWAY_API_KEY" });
  assert.deepEqual(events, ["month", "reserve", "started", "record", "reconcile"]);
});

test("an invented evidence id is repaired locally with its issue path and both responses are billed", async () => {
  const invented = { ...valid, transaction_intent: dimension("active", ["e99"]) };
  const { ledger, events } = recorder(), { model, prompts } = await mockModel([invented, valid]);
  const result = await generateMoveAssessment(base(ledger, { model }));
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /transaction_intent\.evidence_ids\.0:evidence_not_in_catalog/);
  assert.equal(result.usage.attempts, 2);
  assert.equal(result.usage.actual_cents, 4);
  assert.equal(events.filter(e => e === "record").length, 2);
  assert.equal(events.filter(e => e === "reserve").length, 1);
  assert.equal(events.at(-1), "reconcile");
});

test("provider errors return to the durable job with uncertain usage and a reconciled reservation", async () => {
  const throttled = Object.assign(new Error("Synthetic throttle"), { statusCode: 429 });
  const { ledger, events } = recorder(), { model } = await mockModel([throttled]);
  await assert.rejects(generateMoveAssessment(base(ledger, { model })), (error: unknown) => (error as { statusCode?: number }).statusCode === 429);
  assert.deepEqual(events, ["month", "reserve", "started", "uncertain", "reconcile"]);
});

test("no active budget period refuses before reserving", async () => {
  const { ledger, events } = recorder(), { model, prompts } = await mockModel([valid]);
  ledger.activeMonth = async () => null;
  await assert.rejects(generateMoveAssessment(base(ledger, { model })), (error: unknown) => error instanceof CsiError && error.code === "BUDGET_EXHAUSTED");
  assert.equal(prompts.length, 0);
  assert.deepEqual(events, []);
});
