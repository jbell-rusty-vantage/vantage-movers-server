import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { CsiError } from "../auth";
import {
  assessmentLayoutFromFlag, assessmentStepContract, CUSTOMER_EVIDENCE_KINDS, expandAssessment, MOVE_ASSESSMENT_CASE_FILE_PROMPT,
  MOVE_ASSESSMENT_PROMPT, moveAssessmentPrompt, type EvidenceCatalogEntry, type MoveAssessmentModelOutput,
} from "./contract";
import type { AssessmentPromptPayload } from "./context";
import { generateMoveAssessment, type AssessmentLedger } from "./generate";

/** AC2-ASSESS (Attention and Case File spec §4.10, K11): the assessment's Case File contract. */
const call = { source: "summary_artifact" as const, snapshot_id: "s1", content_digest: "d1", conversation_id: "c1", transcript_version: "v1" };
const lead = { source: "lead" as const, model: "FormLead" as const, id: "l1" };
const catalog: EvidenceCatalogEntry[] = [
  { id: "e1", kind: "lead_ingested", text: "Original ingestion (Top10) move_date: 2026-10-10", lineage: [], locator: { ...lead, view: "ingested", field_path: "ingested_move_snapshot.move_date" } },
  { id: "e2", kind: "lead_current", text: "Current Lead move_date: 2026-10-12 (Granot)", lineage: [], locator: { ...lead, view: "current", field_path: "move_date" } },
  { id: "e3", kind: "official_state", text: "Official Lead booked: no", lineage: [], locator: { source: "official", model: "FormLead", id: "l1", field_path: "booked" } },
  { id: "e4", kind: "said_on_call", text: "We are definitely moving on October 12", speaker: "customer", call_at: "2026-09-20T15:00:00.000Z", lineage: [], locator: { ...call, section: "said_on_call.0" } },
  { id: "e5", kind: "finding", text: "Prior finding: price objection", lineage: [], locator: { source: "finding", finding_id: "f1", run_id: "r1", revision: 1, conversation_id: "c1" } },
  { id: "e6", kind: "owner_correction", text: "Owner: move date is Oct 12", lineage: [], locator: { source: "owner_correction", instruction_id: "i1", revision: 1 } },
];
const dimension = (level: MoveAssessmentModelOutput["move_likelihood"]["level"], evidence_ids: string[]) =>
  ({ level, confidence: "medium" as const, rationale: `Selected ${level}.`, evidence_ids, conditions: [] });
const output = (likelihood: string[], intent: string[], level: MoveAssessmentModelOutput["move_likelihood"]["level"] = "active"): MoveAssessmentModelOutput => ({
  move_likelihood: dimension(level, likelihood), transaction_intent: dimension(level, intent), move_details: [], inventory: { items: [], coverage: "none", limitations: [] },
  conflicts: [], engagement: { work_status: "unknown", rationale: "No engagement evidence.", evidence_ids: [], promised_callbacks: [], next_steps: [] } });
const issues = (fn: () => unknown) => { try { fn(); return []; } catch (error) { assert(error instanceof CsiError); return (error.issues ?? []).map(i => `${i.path}:${i.code}`); } };

test("flag off: the v1 contract and prompt are byte-identical to 01bcf18", () => {
  assert.equal(assessmentLayoutFromFlag({}), "legacy");
  assert.equal(assessmentLayoutFromFlag({ SALES_INTELLIGENCE_CASE_FILE: "false" }), "legacy");
  assert.equal(assessmentLayoutFromFlag({ SALES_INTELLIGENCE_CASE_FILE: " TRUE " }), "case_file");
  // Captured from the base worktree at 01bcf18 (evidence/AC2-ASSESS.md).
  assert.deepEqual(assessmentStepContract("legacy"), { prompt_version: "csi-move-assessment-v1",
    prompt_digest: "9e616d3f81ede5f040eeb74763a55c374d4ed1809c266d6b96d2d5244018fdaf",
    schema_digest: "4b3daae1073901f6296d61b1de925deb09fa540a1ed9b602af5ba31fc70bca68", rubric_version: "move-rubric-v1", schema_version: "move-assessment-v1" });
  assert.equal(createHash("sha256").update(MOVE_ASSESSMENT_PROMPT).digest("hex"), "ee1d0bc0263719a7c4915dc6596f0344bfcfd494dfaac29e51ffc0a920c0ca0d");
  assert.equal(moveAssessmentPrompt("legacy"), MOVE_ASSESSMENT_PROMPT);
});

test("flag on: v2 prompt = v1 + the Case File and customer-evidence rules; rubric, schema and output schema unchanged", () => {
  const v1 = assessmentStepContract("legacy"), v2 = assessmentStepContract("case_file");
  assert.equal(v2.prompt_version, "csi-move-assessment-v2");
  assert.notEqual(v2.prompt_digest, v1.prompt_digest);
  assert.equal(v2.schema_digest, v1.schema_digest);
  assert.equal(v2.rubric_version, v1.rubric_version);
  assert.equal(v2.schema_version, v1.schema_version);
  assert.ok(MOVE_ASSESSMENT_CASE_FILE_PROMPT.startsWith(MOVE_ASSESSMENT_PROMPT));
  assert.match(MOVE_ASSESSMENT_CASE_FILE_PROMPT, /Customer-evidence rule: move_likelihood and transaction_intent rationales must cite only catalog entries of kind conversation claim/);
  assert.match(MOVE_ASSESSMENT_CASE_FILE_PROMPT, /Granot, Outreach and prior-analysis lines in the Case File.* are context for engagement, never evidence for a score/);
  assert.doesNotMatch(MOVE_ASSESSMENT_CASE_FILE_PROMPT.slice(MOVE_ASSESSMENT_PROMPT.length), /"/, "the added rules carry no double quotes");
});

test("K11 validator: a score resting only on non-customer kinds is refused under the Case File layout, and only there", () => {
  for (const nonCustomer of [["e2"], ["e3"], ["e5"], ["e6"], ["e2", "e3", "e5", "e6"]]) {
    assert.deepEqual(issues(() => expandAssessment(output(nonCustomer, ["e4"]), catalog, { layout: "case_file" })),
      ["move_likelihood.evidence_ids:score_requires_customer_evidence"], `likelihood citing ${nonCustomer}`);
    assert.deepEqual(issues(() => expandAssessment(output(nonCustomer, ["e4"]), catalog)), [], "legacy: unchanged rules");
    assert.deepEqual(issues(() => expandAssessment(output(nonCustomer, ["e4"]), catalog, { layout: "legacy" })), []);
  }
  assert.deepEqual(issues(() => expandAssessment(output(["e4"], ["e2"]), catalog, { layout: "case_file" })), ["transaction_intent.evidence_ids:score_requires_customer_evidence"]);
  // Mixed citations, customer-only citations, the form (lead_ingested), empty lists and unknown levels pass.
  for (const [likelihood, intent, level] of [[["e2", "e4"], ["e4"], "active"], [["e1"], ["e4"], "active"], [[], [], "active"], [["e2"], ["e3"], "unknown"]] as const)
    assert.deepEqual(issues(() => expandAssessment(output([...likelihood], [...intent], level), catalog, { layout: "case_file" })), []);
  assert.deepEqual([...CUSTOMER_EVIDENCE_KINDS].sort(), ["lead_ingested", "legacy_summary_section", "legacy_summary_text", "move_evidence", "said_on_call", "summary_section"]);
});

function recorder(): AssessmentLedger {
  return { activeMonth: async () => "2026-09", nominalCents: async () => 5, reserve: async () => undefined, providerStarted: async () => undefined,
    record: async () => undefined, markUncertain: async () => undefined, reconcile: async () => undefined };
}
async function mockModel(outputs: unknown[]) {
  const { MockLanguageModelV4 } = await import("ai/test");
  const calls: Array<{ system: string; prompt: string }> = [];
  const model = new MockLanguageModelV4({ doGenerate: async input => {
    const system = JSON.stringify(input.prompt.filter(m => m.role === "system")), prompt = JSON.stringify(input.prompt.filter(m => m.role !== "system"));
    calls.push({ system, prompt });
    const next = outputs[Math.min(calls.length - 1, outputs.length - 1)];
    return { content: [{ type: "text", text: JSON.stringify(next) }], finishReason: { unified: "stop", raw: "synthetic" },
      usage: { inputTokens: { total: 200, noCache: 200, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } },
      warnings: [], providerMetadata: { gateway: { cost: 0.01 } } };
  } });
  return { model, calls };
}
const payload = (caseFile: string | undefined): AssessmentPromptPayload => ({ subject: { kind: "lead", lead_model: "FormLead", no_conversation_evidence: false },
  context_as_of: "2026-09-23T20:10:00.000Z", views: { original_ingestion: null, canonical_current: null }, official: null, corrections: [],
  conversations: [], findings: [], ...(caseFile === undefined ? {} : { case_file: caseFile }) });
const input = (model: unknown, caseFile: string | undefined) => ({ lease: { job_id: "aaaaaaaaaaaaaaaaaaaaaaaa", owner: "synthetic", epoch: 1 }, artifact_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
  model: model as never, model_id: "openai/gpt-5-mini", credential: "AI_GATEWAY_API_KEY" as const,
  pricing: { version: "synthetic", input_cents_per_million: 1, output_cents_per_million: 1 }, prompt_payload: payload(caseFile), catalog,
  deadline: Date.now() + 740_000, ledger: recorder() });

test("K11 generate: a score citing only a Granot (current Lead) line is rejected and repaired once under the v2 prompt", async () => {
  const { model, calls } = await mockModel([output(["e2"], ["e4"]), output(["e4"], ["e4"])]);
  const result = await generateMoveAssessment(input(model, "CASE FILE (data) · Number +17575550100 · as of Wed Sep 23, 2026 4:10 PM ET"));
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /move_likelihood\.evidence_ids:score_requires_customer_evidence/);
  assert.ok(calls.every(c => c.system.includes("Customer-evidence rule")), "the v2 system prompt is used on both attempts");
  assert.match(calls[0].prompt, /CASE FILE \(data\)/, "case_file travels in the user payload");
  assert.equal(result.usage.attempts, 2);
  assert.deepEqual(result.accepted.scores.move_likelihood.evidence.map(e => e.id), ["e4"]);
});

test("flag off (no case_file in the payload): the v1 prompt, and the same citation is accepted as before", async () => {
  const { model, calls } = await mockModel([output(["e2"], ["e4"])]);
  const result = await generateMoveAssessment(input(model, undefined));
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].system.includes("Customer-evidence rule"));
  assert.ok(!calls[0].prompt.includes("case_file"));
  assert.deepEqual(result.accepted.scores.move_likelihood.evidence.map(e => e.id), ["e2"]);
});

test("Case File layout: a second response still resting a score on non-customer evidence fails the attempt (one repair, no loop)", async () => {
  const { model, calls } = await mockModel([output(["e2"], ["e4"]), output(["e3"], ["e4"]), output(["e4"], ["e4"])]);
  await assert.rejects(generateMoveAssessment(input(model, "CASE FILE (data)")),
    (error: unknown) => error instanceof CsiError && error.code === "EVIDENCE_SCOPE_INVALID" && (error.issues ?? []).some(i => i.code === "score_requires_customer_evidence"));
  assert.equal(calls.length, 2, "exactly one repair");
});

test("legacy layout keeps its existing repair loop (flag off unchanged)", async () => {
  const { model, calls } = await mockModel([output(["e99"], ["e4"]), output(["e98"], ["e4"]), output(["e4"], ["e4"])]);
  const result = await generateMoveAssessment(input(model, undefined));
  assert.equal(calls.length, 3);
  assert.equal(result.usage.attempts, 3);
});
