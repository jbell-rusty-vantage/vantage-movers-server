import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { intelligenceEnvelopeSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { citationRepairHints, expandStructuredFindings, minimalFindingsSchema, summaryStepSchema, validateSummaryStep,
  type StructuredExpansionInputs } from "./structuredContract";

const summary = { overview: "Synthetic call", customer_wanted: "A move", money_and_dates: "",
  outcome: "Discussed", commitments: "", discrepancies: "" };
const none = { observations: [], inventory: [], intent_signals: [] };
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
  next_step: null, owner_instruction_assessments: [{ instruction_index: 0, assessment: "agrees", reason: "Consistent" }],
  prior_finding_relations: [], story_discrepancies: [] };
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
  assert.equal(validateSummaryStep({ summary, said_on_call: [fact], move_evidence: none }, [7]).said_on_call.length, 1);
  assert.throws(() => validateSummaryStep({ summary, said_on_call: [fact], move_evidence: none }, [9]), /EVIDENCE_SCOPE_INVALID/);
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
    said_on_call: [fact], move_evidence: none }, [7]), /EVIDENCE_SCOPE_INVALID/);
  const action = { ...fact, kind: "promised_callback", value: { action_kind: "call",
    description: "Call tomorrow", date_text: "tomorrow", timezone_text: null, target_followup_id: "invented" as string | null } };
  assert.throws(() => validateSummaryStep({ summary, said_on_call: [action], move_evidence: none }, [7]), /EVIDENCE_SCOPE_INVALID/);
  action.value.target_followup_id = null;
  assert.equal(validateSummaryStep({ summary, said_on_call: [action], move_evidence: none }, [7]).said_on_call.length, 1);
  // csi-summary-v1 artifacts (no block) stay readable; generation requires the block and validates its citations.
  assert.equal(summaryStepSchema.safeParse({ summary, said_on_call: [fact] }).success, true);
  assert.throws(() => validateSummaryStep({ summary, said_on_call: [action] }, [7]));
  assert.throws(() => validateSummaryStep({ summary, said_on_call: [action], move_evidence: { ...none, intent_signals: [{ signal: "definite_move",
    text: "We are moving", speaker: "customer", segment_ids: [9] }] } }, [7]), /EVIDENCE_SCOPE_INVALID/);
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

test("repair hints name every mis-copied citation with the closest supplied ids and never change acceptance", () => {
  const scope = inputs();
  scope.context[0].data.page.records.push(
    { record_type: "interaction", record_id: "6ab2ef80627a1dd94d746e5c", revision: null, fields: { status: "completed" } },
    { record_type: "contact_number", record_id: "6ab2ef80627a1dd94d746e5e", revision: null, fields: { status: "active" } },
    { record_type: "story_event", record_id: "call:6ab2e3cc6ed22806f2cd2aa8", revision: null, fields: { kind: "call" } });
  const truncated = { source: "context", record: "story_event", id: "call:6ab2e3cc6ed22806f2cd2aa" };
  const neighbour = { source: "context", record: "interaction", id: "6ab2ef80627a1dd94d746e5e" };
  const model = { ...raw(), findings: [
    { ...raw().findings[0], basis: "vantage_record", evidence: [truncated, neighbour] },
    { ...raw().findings[0], basis: "vantage_record", evidence: [truncated, { source: "transcript", call_index: 0, segment_ids: [8], quote: null }] }] };
  // The validator still refuses at the first bad citation, with the sanitized path only.
  assert.throws(() => expandStructuredFindings(model, scope), (error: { issues?: unknown }) =>
    JSON.stringify(error.issues) === JSON.stringify([{ path: "findings.0.evidence.0.id", code: "record_not_in_context" }]));
  const hints = citationRepairHints(model, scope);
  assert.equal(hints.length, 3);
  assert.match(hints[0], /^findings\.0\.evidence\.0, findings\.1\.evidence\.0: .*"call:6ab2e3cc6ed22806f2cd2aa".*closest supplied story_event ids are "call:6ab2e3cc6ed22806f2cd2aa8"/);
  assert.match(hints[1], /^findings\.0\.evidence\.1: .*supplied only as \{"record":"contact_number","id":"6ab2ef80627a1dd94d746e5e"\}.*closest supplied interaction ids are "6ab2ef80627a1dd94d746e5c"/);
  assert.match(hints[2], /^findings\.1\.evidence\.1: call_index 0 may cite only the segment ids listed for it in appendix\.calls: \[7\]/);
  // A story-event id naming a record supplied under another type points at that record.
  const prefixed = { ...raw(), findings: [{ ...raw().findings[0], basis: "vantage_record", evidence: [{ source: "context", record: "story_event", id: "call:6ab2ef80627a1dd94d746e5c" }] }] };
  assert.match(citationRepairHints(prefixed, scope)[0], /supplied only as \{"record":"interaction","id":"6ab2ef80627a1dd94d746e5c"\}/);
  // Out-of-range indices name the valid range.
  const indices = { ...raw(), owner_instruction_assessments: [{ instruction_index: 1, assessment: "agrees", reason: "x" }],
    prior_finding_relations: [{ prior_index: 0, relation: "still_true", by_finding_index: 4, evidence: [], note: null }] };
  assert.deepEqual(citationRepairHints(indices, scope).map(hint => hint.split(":")[0]),
    ["prior_finding_relations.0.by_finding_index", "owner_instruction_assessments.0.instruction_index"]);
  assert.match(citationRepairHints(indices, { ...scope, instructions: [] })[1], /instructions list is empty/);
  // A clean object yields no hints; a call without segments is named as such.
  assert.deepEqual(citationRepairHints(raw(), scope), []);
  assert.match(citationRepairHints({ ...raw(), findings: [{ ...raw().findings[0], evidence: [{ source: "transcript", call_index: 3, segment_ids: [1], quote: null }] }] }, scope)[0],
    /call_index 3 has no citable segments/);
  assert.deepEqual(citationRepairHints(null, scope), []);
});

test("prior relations and story discrepancies resolve prompt indices to captured record ids and refuse unknown ones", () => {
  const scope = inputs();
  scope.context = [...scope.context, { snapshot_id: "story-snapshot", data: { ...scope.context[0].data, instructions: [],
    page: { records: [{ record_type: "story_event", record_id: "lead_message_sent:m1", revision: null, fields: { kind: "lead_message_sent", description: "Vantage sent a text (delivered)." } }],
      next_cursor: null, complete: true, missing_ranges: [] } } },
  { snapshot_id: "prior-snapshot", data: { ...scope.context[0].data, instructions: [],
    page: { records: [{ record_type: "prior_finding", record_id: "finding-prior-1", revision: "1", fields: { kind: "promised_callback", description: "Rep promised a callback" } }],
      next_cursor: null, complete: true, missing_ranges: [] } } }];
  const resolved = { ...scope, prior_finding_ids: ["finding-prior-1"], story_event_ids: ["lead_message_sent:m1"] };
  const model = { ...raw(), prior_finding_relations: [{ prior_index: 0, relation: "superseded", by_finding_index: 0,
    evidence: [{ source: "context", record: "prior_finding", id: "finding-prior-1" }], note: "Newer promise on the later call" }],
    story_discrepancies: [{ story_index: 0, claim: "Customer says no text arrived", evidence: [{ source: "transcript", call_index: 0, segment_ids: [7], quote: null }] }] };
  const envelope = expandStructuredFindings(model, resolved);
  assert.deepEqual(envelope.prior_finding_relations?.[0].prior_finding_id, "finding-prior-1");
  assert.equal(envelope.prior_finding_relations?.[0].by_finding_key, "finding-1");
  assert.equal(envelope.prior_finding_relations?.[0].evidence[0].snapshot_id, "prior-snapshot");
  assert.equal(envelope.story_discrepancies?.[0].story_event_id, "lead_message_sent:m1");
  assert.throws(() => expandStructuredFindings({ ...model, prior_finding_relations: [{ ...model.prior_finding_relations[0], prior_index: 4 }] }, resolved), /EVIDENCE_SCOPE_INVALID/);
  assert.throws(() => expandStructuredFindings({ ...model, story_discrepancies: [{ ...model.story_discrepancies[0], story_index: 9 }] }, resolved), /EVIDENCE_SCOPE_INVALID/);
  assert.throws(() => expandStructuredFindings({ ...model, prior_finding_relations: [{ ...model.prior_finding_relations[0], by_finding_index: 3 }] }, resolved), /EVIDENCE_SCOPE_INVALID/);
  // Without the id lists (a replay of a run that never saw a prior page), every index is refused rather than guessed.
  assert.throws(() => expandStructuredFindings(model, scope), /EVIDENCE_SCOPE_INVALID/);
  const empty = expandStructuredFindings(raw(), resolved);
  assert.equal("prior_finding_relations" in empty, false);
});
