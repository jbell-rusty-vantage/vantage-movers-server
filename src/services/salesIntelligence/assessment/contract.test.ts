import assert from "node:assert/strict";
import { test } from "node:test";
import { CsiError } from "../auth";
import { structuredProviderSchema } from "../analysis/structuredProviderSchema";
import {
  ASSESSMENT_LEVELS, LEVEL_SCORES, MOVE_ASSESSMENT_PROMPT, assessmentStepContract, evidenceCatalogEntrySchema, expandAssessment,
  moveAssessmentModelOutputSchema, summaryMoveEvidenceSchema, type EvidenceCatalogEntry, type MoveAssessmentModelOutput,
} from "./contract";

const call = { source: "summary_artifact" as const, snapshot_id: "s1", content_digest: "d1", conversation_id: "c1", transcript_version: "v1" };
const catalog: EvidenceCatalogEntry[] = [
  { id: "e1", kind: "lead_current", text: "Current Lead move_date: 2026-10-15", lineage: [],
    locator: { source: "lead", model: "FormLead", id: "l1", view: "current", field_path: "move_date" } },
  { id: "e2", kind: "lead_ingested", text: "Original ingestion (original_form_submission) pickup: Miami, FL, 33101", lineage: [],
    locator: { source: "lead", model: "FormLead", id: "l1", view: "ingested", field_path: "ingested_move_snapshot.pickup" } },
  { id: "e3", kind: "said_on_call", text: "We are definitely moving on October 15", speaker: "customer", call_at: "2026-09-20T15:00:00.000Z",
    lineage: [], locator: { ...call, section: "said_on_call.0" } },
  { id: "e4", kind: "said_on_call", text: "We already signed with another mover", speaker: "customer", call_at: "2026-09-20T15:00:00.000Z",
    lineage: [], locator: { ...call, section: "said_on_call.1" } },
  { id: "e5", kind: "summary_section", text: "Customer liked the quote; will book if the house closes.", call_at: "2026-09-20T15:00:00.000Z",
    lineage: [], locator: { ...call, section: "outcome" } },
];
const dimension = (level: (typeof ASSESSMENT_LEVELS)[number], evidence_ids: string[], conditions: string[] = []) =>
  ({ level, confidence: "medium" as const, rationale: `Selected ${level} from the cited evidence.`, evidence_ids, conditions });
function output(overrides: Partial<MoveAssessmentModelOutput> = {}): MoveAssessmentModelOutput {
  return { move_likelihood: dimension("unknown", []), transaction_intent: dimension("unknown", []), move_details: [],
    inventory: { items: [], coverage: "none", limitations: [] }, conflicts: [],
    engagement: { work_status: "unknown", rationale: "No engagement evidence.", evidence_ids: [], promised_callbacks: [], next_steps: [] }, ...overrides };
}
function refusal(raw: unknown): Array<{ path: string; code: string }> {
  try { expandAssessment(raw, catalog); } catch (error) {
    assert.ok(error instanceof CsiError);
    assert.equal(error.code, "EVIDENCE_SCOPE_INVALID");
    return [...(error.issues ?? [])];
  }
  assert.fail("expected a refusal");
}

test("levels map to fixed server scores and Unknown maps to null", () => {
  assert.deepEqual(ASSESSMENT_LEVELS.map(level => LEVEL_SCORES[level]), [null, 0, 25, 50, 75, 100]);
  const accepted = expandAssessment(output(), catalog);
  assert.equal(accepted.scores.move_likelihood.score, null);
  assert.equal(accepted.scores.transaction_intent.score, null);
});

test("definite move but signed with another mover is 100 move likelihood and 0 transaction intent", () => {
  const raw = output({ move_likelihood: { ...dimension("confirmed", ["e3"]), confidence: "high" },
    transaction_intent: { ...dimension("none", ["e4"]), confidence: "high" } });
  const accepted = expandAssessment(raw, catalog);
  assert.equal(accepted.scores.move_likelihood.score, 100);
  assert.equal(accepted.scores.transaction_intent.score, 0);
  assert.deepEqual(accepted.scores.transaction_intent.evidence.map(ref => [ref.id, ref.kind, ref.speaker]), [["e4", "said_on_call", "customer"]]);
  assert.equal("text" in accepted.scores.transaction_intent.evidence[0], false);
  assert.deepEqual(accepted.model_output, raw);
});

test("conditional intention keeps its blocker and is not an unconditional 100", () => {
  const accepted = expandAssessment(output({ transaction_intent: dimension("strong", ["e5"], ["House sale must close first"]) }), catalog);
  assert.equal(accepted.scores.transaction_intent.score, 75);
  assert.deepEqual(accepted.scores.transaction_intent.conditions, ["House sale must close first"]);
});

test("a Form Lead alone cannot establish high transaction intent", () => {
  assert.deepEqual(refusal(output({ transaction_intent: dimension("confirmed", ["e1", "e2"]) })),
    [{ path: "transaction_intent.level", code: "intent_requires_conversation_evidence" }]);
  assert.deepEqual(refusal(output({ transaction_intent: dimension("strong", []) })),
    [{ path: "transaction_intent.level", code: "intent_requires_conversation_evidence" }]);
  // Preliminary move evidence from the Lead remains acceptable.
  assert.equal(expandAssessment(output({ move_likelihood: dimension("active", ["e1", "e2"]) }), catalog).scores.move_likelihood.score, 50);
});

test("unknown evidence ids are refused with a quotable path", () => {
  assert.deepEqual(refusal(output({ move_likelihood: dimension("strong", ["e3", "e99"]) })),
    [{ path: "move_likelihood.evidence_ids.1", code: "evidence_not_in_catalog" }]);
  assert.deepEqual(refusal(output({ conflicts: [{ affects: "move_date", explanation: "Two dates", evidence_ids: ["e1", "x"] }] })),
    [{ path: "conflicts.0.evidence_ids.1", code: "evidence_not_in_catalog" }]);
});

test("Unknown requires a reason", () => {
  assert.deepEqual(refusal(output({ move_likelihood: { ...dimension("unknown", []), rationale: "   " } })),
    [{ path: "move_likelihood.rationale", code: "unknown_requires_reason" }]);
  assert.throws(() => expandAssessment(output({ move_likelihood: { ...dimension("unknown", []), rationale: "" } }), catalog));
});

test("dates must be calendar dates in order; unresolved dates stay null", () => {
  const date = (value: Partial<{ date: string | null; end_date: string | null; precision: "exact" | "window" | "month" | "unresolved" }>) =>
    output({ move_details: [{ field: "move_date", status: "stated", evidence_ids: ["e3"], value: { raw_text: "October 15",
      date: "2026-10-15", end_date: null, applies_to: "pickup", flexibility: "fixed", precision: "exact", ...value } }] });
  assert.equal(expandAssessment(date({}), catalog).move_details[0].field, "move_date");
  assert.deepEqual(refusal(date({ date: "2026-02-30" })), [{ path: "move_details.0.value.date", code: "date_invalid" }]);
  assert.deepEqual(refusal(date({ date: "10/15/2026" })), [{ path: "move_details.0.value.date", code: "date_invalid" }]);
  assert.deepEqual(refusal(date({ end_date: "2026-10-01", precision: "window" })), [{ path: "move_details.0.value.end_date", code: "date_invalid" }]);
  assert.deepEqual(refusal(date({ precision: "unresolved" })), [{ path: "move_details.0.value.date", code: "unresolved_date_not_null" }]);
  assert.equal(expandAssessment(date({ date: null, precision: "unresolved" }), catalog).move_details[0].evidence[0].id, "e3");
});

test("unknown quantities stay null; negative and inverted ranges are refused", () => {
  const item = (quantity: { min: number | null; max: number | null }) => output({ inventory: { coverage: "partial", limitations: [],
    items: [{ label: "sofa", quantity, room: "living room", dimensions: null, handling: null, status: "included", evidence_ids: ["e3"] }] } });
  const accepted = expandAssessment(item({ min: null, max: null }), catalog);
  assert.deepEqual(accepted.inventory.items[0].quantity, { min: null, max: null });
  assert.equal(accepted.inventory.items[0].evidence[0].id, "e3");
  assert.deepEqual(refusal(item({ min: -1, max: 2 })), [{ path: "inventory.items.0.quantity", code: "range_negative" }]);
  assert.deepEqual(refusal(item({ min: 3, max: 2 })), [{ path: "inventory.items.0.quantity", code: "range_inverted" }]);
  assert.deepEqual(refusal(output({ move_details: [{ field: "money", status: "stated", evidence_ids: ["e5"],
    value: { basis: "budget", amount: { min: 5000, max: 3000 }, currency: "USD", text: "3-5k" } }] })),
  [{ path: "move_details.0.value.amount", code: "range_inverted" }]);
});

test("every refusal is reported together and malformed output fails the strict schema", () => {
  const issues = refusal(output({ move_likelihood: dimension("strong", ["nope"]), transaction_intent: dimension("confirmed", ["e1"]) }));
  assert.deepEqual(issues.map(issue => issue.code), ["evidence_not_in_catalog", "intent_requires_conversation_evidence"]);
  assert.throws(() => expandAssessment({ ...output(), score: 90 }, catalog), /unrecognized_keys|Unrecognized/);
  assert.throws(() => expandAssessment({ ...output(), move_details: [{ field: "anything", value: {}, status: "stated", evidence_ids: ["e1"] }] }, catalog));
});

test("model-output and summary move_evidence schemas reach strict providers as literal-tagged anyOf", async () => {
  for (const schema of [moveAssessmentModelOutputSchema, summaryMoveEvidenceSchema]) {
    const wire = await structuredProviderSchema(schema);
    const json = JSON.stringify(await wire.jsonSchema);
    assert.equal(json.includes('"oneOf"'), false);
    assert.equal(json.includes('"anyOf"'), true);
    assert.equal((await wire.validate!({}))?.success, false);
  }
  const wire = await structuredProviderSchema(moveAssessmentModelOutputSchema);
  const valid = output({ move_details: [{ field: "pickup_location", status: "stated", evidence_ids: ["e3"],
    value: { line: null, city: "Miami", state: "FL", zip: null, precision: "city" } }] });
  assert.equal((await wire.validate!(valid)).success, true);
  assert.equal((await wire.validate!({ ...valid, move_details: [{ ...valid.move_details[0], field: "move_date" }] })).success, false);
});

test("the pinned step contract carries the rubric and is stable", () => {
  const contract = assessmentStepContract();
  assert.deepEqual(assessmentStepContract(), contract);
  assert.deepEqual(Object.keys(contract).sort(), ["prompt_digest", "prompt_version", "rubric_version", "schema_digest", "schema_version"]);
  for (const phrase of ["signed with another mover", "if the house closes", "Unknown quantity is null", "Never infer cubic feet",
    "not a customer commitment", "at most active for move likelihood and unknown for transaction intent", "Cite only the supplied evidence ids"])
    assert.ok(MOVE_ASSESSMENT_PROMPT.includes(phrase), phrase);
  for (const entry of catalog) evidenceCatalogEntrySchema.parse(entry);
});

test("engagement: a worked status needs conversation evidence; commitment dates must be calendar dates; ids expand", () => {
  const engagement = (over: Partial<MoveAssessmentModelOutput["engagement"]>): MoveAssessmentModelOutput["engagement"] =>
    ({ work_status: "unknown", rationale: "No engagement evidence.", evidence_ids: [], promised_callbacks: [], next_steps: [], ...over });
  assert.deepEqual(refusal(output({ engagement: engagement({ work_status: "worked_with_next_step", evidence_ids: ["e1"] }) })),
    [{ path: "engagement.work_status", code: "work_status_requires_conversation_evidence" }]);
  assert.deepEqual(refusal(output({ engagement: engagement({ promised_callbacks: [{ by: "rep", raw_text: "Friday", date: "2026-02-30", time_text: null, status: "pending", evidence_ids: ["e3"] }] }) })),
    [{ path: "engagement.promised_callbacks.0.date", code: "date_invalid" }]);
  assert.deepEqual(refusal(output({ engagement: engagement({ next_steps: [{ action: "call", owner: "rep", description: "Call back", date: null, date_text: null, status: "planned", evidence_ids: ["nope"] }] }) })),
    [{ path: "engagement.next_steps.0.evidence_ids.0", code: "evidence_not_in_catalog" }]);
  const accepted = expandAssessment(output({ engagement: engagement({ work_status: "worked_with_next_step", rationale: "Rep spoke with the customer.", evidence_ids: ["e5"],
    promised_callbacks: [{ by: "rep", raw_text: "I'll call Friday", date: "2026-09-25", time_text: null, status: "pending", evidence_ids: ["e5"] }] }) }), catalog);
  assert.equal(accepted.engagement.work_status, "worked_with_next_step");
  assert.deepEqual(accepted.engagement.evidence.map(ref => ref.id), ["e5"]);
  assert.deepEqual(accepted.engagement.promised_callbacks.map(item => [item.by, item.date, item.evidence[0].call_at]), [["rep", "2026-09-25", "2026-09-20T15:00:00.000Z"]]);
  assert.match(MOVE_ASSESSMENT_PROMPT, /Vantage Movers LLC/);
  assert.match(MOVE_ASSESSMENT_PROMPT, /Boynton Beach, Florida/);
});

