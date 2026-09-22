import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { intelligenceEnvelopeSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { expandStructuredFindings, minimalFindingsSchema, summaryStepSchema, validateSummaryStep,
  type StructuredExpansionInputs } from "./structuredContract";

const summary = { overview: "Synthetic call", customer_wanted: "A move", money_and_dates: "",
  outcome: "Discussed", commitments: "", discrepancies: "" };
const fact = { kind: "intent" as const, value: { intent: "moving_inquiry" as const },
  claim: "Customer discussed a move", actor: "customer" as const, clarity: "clear" as const,
  action_status: null, speaker: "customer" as const, segment_ids: [7], quote: null };
function inputs(): StructuredExpansionInputs {
  const data = { page: { records: [], next_cursor: null, complete: true, missing_ranges: [] },
    coverage: { known_through: null, gaps: [], capabilities: {}, ai_paused: false },
    instructions: [], speaker_refs: [], allowed_followup_ids: [] };
  return { subject_key: "number:synthetic", calls: [{ snapshot_id: "summary-snapshot", data: {
    ...data, transcript: { conversation_id: "call-1", transcript_version: "v1",
      source_snapshot_id: "original-transcript", segments: [] } },
    summary: { summary, said_on_call: [fact] }, speaker_refs: ["agent:reviewed"] }],
  context: [{ snapshot_id: "context-snapshot", data: { ...data,
    instructions: [{ id: "owner-instruction", revision: 2 }],
    page: { ...data.page, records: [{ record_type: "lead", record_id: "lead-1", revision: "1",
      fields: { status: "open", booked: false } }] } } }] };
}
function raw() {
  return { summary, findings: [{ kind: fact.kind, value: fact.value, claim: fact.claim,
    actor: fact.actor, clarity: fact.clarity, action_status: null, basis: "said_on_call",
    evidence: [{ source: "transcript", call_index: 0, segment_ids: [7], quote: null }] }],
  next_step: null, owner_instruction_assessments: [{ instruction_index: 0, assessment: "agrees", reason: "Consistent" }] };
}

test("minimal findings expand into the unchanged submission envelope using server citation metadata", () => {
  const result = expandStructuredFindings(raw(), inputs());
  assert.equal(intelligenceEnvelopeSchema.safeParse(result).success, true);
  assert.deepEqual(result.findings[0].evidence, [{ source: "transcript", snapshot_id: "summary-snapshot",
    conversation_id: "call-1", transcript_version: "v1", segment_ids: [7], quote: null }]);
  assert.equal(result.findings[0].speaker_ref, null);
  assert.deepEqual(result.summary.finding_keys, ["finding-1"]);
  assert.equal(result.owner_instruction_assessments[0].instruction_revision, 2);
});

test("record citations expand exposed fields and reject invented or missing records", () => {
  const model = { ...raw(), findings: [{ ...raw().findings[0], basis: "vantage_record",
    evidence: [{ source: "context", record: "lead", id: "lead-1" }] }] };
  const result = expandStructuredFindings(model, inputs());
  assert.deepEqual(result.findings[0].evidence, [{ source: "vantage_record", snapshot_id: "context-snapshot",
    record_type: "lead", record_id: "lead-1", field_paths: ["status", "booked"] }]);
  model.findings[0].evidence[0].id = "invented";
  assert.throws(() => expandStructuredFindings(model, inputs()), /EVIDENCE_SCOPE_INVALID/);
});

test("summary and findings reject invented transcript segments, even valid transcript segments omitted from summary", () => {
  assert.equal(validateSummaryStep({ summary, said_on_call: [fact] }, [7]).said_on_call.length, 1);
  assert.throws(() => validateSummaryStep({ summary, said_on_call: [fact] }, [9]), /EVIDENCE_SCOPE_INVALID/);
  const model = raw();
  model.findings[0].evidence[0].segment_ids = [8];
  assert.throws(() => expandStructuredFindings(model, inputs()), /EVIDENCE_SCOPE_INVALID/);
  model.findings[0].evidence[0].call_index = 1;
  assert.throws(() => expandStructuredFindings(model, inputs()), /EVIDENCE_SCOPE_INVALID/);
});

test("unknown or ambiguous speakers never acquire reviewed rep authority", () => {
  const scope = inputs();
  const model = { ...raw(), findings: [{ ...raw().findings[0], actor: "rep" }] };
  scope.calls[0].summary.said_on_call[0].speaker = "unknown";
  assert.equal(expandStructuredFindings(model, scope).findings[0].speaker_ref, null);
  scope.calls[0].summary.said_on_call[0].speaker = "rep";
  assert.equal(expandStructuredFindings(model, scope).findings[0].speaker_ref, "agent:reviewed");
  scope.calls[0].speaker_refs.push("agent:another");
  assert.equal(expandStructuredFindings(model, scope).findings[0].speaker_ref, null);
});

test("summary validation enforces total section size and transcript-only followup authority", () => {
  assert.throws(() => validateSummaryStep({ summary: { ...summary, overview: "x".repeat(4_001) },
    said_on_call: [fact] }, [7]), /EVIDENCE_SCOPE_INVALID/);
  const action = { ...fact, kind: "promised_callback", value: { action_kind: "call",
    description: "Call tomorrow", date_text: "tomorrow", timezone_text: null, target_followup_id: "invented" as string | null } };
  assert.throws(() => validateSummaryStep({ summary, said_on_call: [action] }, [7]), /EVIDENCE_SCOPE_INVALID/);
  action.value.target_followup_id = null;
  assert.equal(validateSummaryStep({ summary, said_on_call: [action] }, [7]).said_on_call.length, 1);
});

test("multiple calls retain independent citation scope and cannot merge different rep identities", () => {
  const scope = inputs();
  scope.calls[0].summary.said_on_call[0].speaker = "rep";
  const second = structuredClone(scope.calls[0]);
  second.snapshot_id = "second-summary";
  second.data.transcript!.conversation_id = "call-2";
  second.speaker_refs = ["agent:second"];
  const combined = { ...scope, calls: [...scope.calls, second] };
  const model = { ...raw(), findings: [{ ...raw().findings[0], actor: "rep",
    evidence: [...raw().findings[0].evidence, { source: "transcript", call_index: 1, segment_ids: [7], quote: null }] }] };
  const result = expandStructuredFindings(model, combined);
  assert.equal(result.findings[0].speaker_ref, null);
  assert.equal(result.findings[0].evidence[1].snapshot_id, "second-summary");
});

test("instruction indices are checked and repeated assessments retain the envelope uniqueness guard", () => {
  const model = raw();
  model.owner_instruction_assessments[0].instruction_index = 1;
  assert.throws(() => expandStructuredFindings(model, inputs()), /EVIDENCE_SCOPE_INVALID/);
  model.owner_instruction_assessments[0].instruction_index = 0;
  model.owner_instruction_assessments.push(model.owner_instruction_assessments[0]);
  assert.throws(() => expandStructuredFindings(model, inputs()), /Duplicate instruction assessment/);
});

test("model schemas contain no server metadata and reject operational additions", () => {
  for (const schema of [minimalFindingsSchema, summaryStepSchema]) {
    const json = JSON.stringify(z.toJSONSchema(schema));
    for (const key of ["snapshot_id", "field_paths", "speaker_ref", "finding_keys", "schema_version", "transcript_version", "conversation_id"])
      assert.equal(json.includes(`\"${key}\"`), false, key);
  }
  assert.equal(minimalFindingsSchema.safeParse({ ...raw(), schema_version: "invented" }).success, false);
});
