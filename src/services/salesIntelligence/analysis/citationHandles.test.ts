import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { payloadHash } from "../transactions";
import { appendixContextRecords } from "../casefile/appendix";
import { CITATION_HANDLE_PATTERN, buildCitationHandles, handleIndex, handleRanges, type CitationHandleTable } from "./citationHandles";
import { citationRepairHints, expandStructuredFindings, findingsSchemaFor, minimalFindingsSchema, minimalFindingsSchemaHandles,
  type StructuredExpansionInputs } from "./structuredContract";
import { providerCompatibleSchema } from "./structuredProviderSchema";
import type { ReadContent } from "./reads";

/**
 * Citation handles spec §7: CH-T3 (the same answer written with handles expands to the byte-identical
 * envelope) and CH-T4 (unknown or out-of-range refs are refused `handle_not_in_context`, the hint names
 * the ranges, nothing is substituted), plus the model-facing schema.
 */
const summary = { overview: "Synthetic call", customer_wanted: "A move", money_and_dates: "", outcome: "Discussed", commitments: "", discrepancies: "" };
const fact = { kind: "intent" as const, value: { intent: "moving_inquiry" as const }, claim: "Customer discussed a move", actor: "customer" as const,
  clarity: "clear" as const, action_status: null, speaker: "customer" as const, segment_ids: [7], quote: null };
const data: ReadContent = { page: { records: [], next_cursor: null, complete: true, missing_ranges: [] }, coverage: { known_through: null, gaps: [], capabilities: { call_log: "unknown" as const, webhook: "unknown" as const } },
  instructions: [], speaker_refs: [], allowed_followup_ids: [] };
type Records = StructuredExpansionInputs["context"][number]["data"]["page"]["records"];
const page = (snapshot_id: string, records: Records, extra: Partial<ReadContent> = {}) => ({ snapshot_id, data: { ...data, ...extra, page: { ...data.page, records } } });
const lead = { record_type: "lead" as const, record_id: "6ab2b4870c84337849a49dc4", revision: "1", fields: { status: "open", booked: false } };

/** The Case File layout's three pages: context (with a prior-finding timeline duplicate), Case File (story events), prior (findings; the Lead again). */
function scope(): StructuredExpansionInputs {
  const context = page("context-snapshot", [lead,
    { record_type: "interaction", record_id: "call:6ab2b4870c84337849a49dc5", revision: "1", fields: { direction: "Inbound", status: "completed" } },
    { record_type: "contact_number", record_id: "6ab2b4870c84337849a49dc5", revision: "1", fields: { kind: "external" } },
    { record_type: "job_timeline", record_id: "6ab2b4870c84337849a49dc6", revision: "1", fields: { description: "claim", details: JSON.stringify({ kind: "objection", value: {}, evidence: [], run_id: "r1" }) } }],
  { instructions: [{ id: "owner-instruction", revision: 2 }] });
  const caseFile = page("case-file-snapshot", [
    { record_type: "story_event", record_id: "lead_created:6ab2b4870c84337849a49dc4", revision: null, fields: { kind: "lead_created", description: "Lead created." } },
    { record_type: "story_event", record_id: "lead_message_sent:6ab2b4880c84337849a49dd1", revision: null, fields: { kind: "lead_message_sent", description: "Vantage sent a text." } },
    { record_type: "granot_state", record_id: "granot:6ab2b4870c84337849a49dc4", revision: null, fields: { description: "Priority 1" } }]);
  const prior = page("prior-snapshot", [
    { record_type: "prior_finding", record_id: "6ab2b4880c84337849a49de0", revision: "1", fields: { kind: "promised_callback", description: "Rep promised a callback" } },
    { record_type: "prior_finding", record_id: "6ab2b4880c84337849a49de1", revision: "1", fields: { kind: "objection", description: "Price objection" } },
    { record_type: "prior_summary", record_id: "6ab2b4880c84337849a49de2", revision: "1", fields: { kind: "conversation" } }, lead]);
  return { subject_key: "number:synthetic", context: [context, caseFile, prior],
    calls: [{ snapshot_id: "summary-snapshot", data: { ...data, transcript: { conversation_id: "call-1", transcript_version: "v1", source_snapshot_id: "t", segments: [] } },
      summary: { summary, said_on_call: [fact] }, speaker_refs: ["agent:reviewed"] }],
    story_event_ids: caseFile.data.page.records.filter(r => r.record_type === "story_event").map(r => r.record_id),
    prior_finding_ids: prior.data.page.records.filter(r => r.record_type === "prior_finding").map(r => r.record_id) };
}
const tableOf = (inputs: StructuredExpansionInputs) => buildCitationHandles({ context: inputs.context, records: appendixContextRecords(inputs.context[0]!.data),
  story_event_ids: inputs.story_event_ids ?? [], prior_finding_ids: inputs.prior_finding_ids ?? [] });
const transcript = { source: "transcript", call_index: 0, segment_ids: [7], quote: null };
const finding = (evidence: unknown[]) => ({ kind: fact.kind, value: fact.value, claim: fact.claim, actor: fact.actor, clarity: fact.clarity,
  action_status: null, basis: "vantage_record", evidence });
/** A v5 answer that cites every kind of context record by type and id. */
function v5Answer() {
  const s = scope();
  return { summary, next_step: null, owner_instruction_assessments: [{ instruction_index: 0, assessment: "agrees", reason: "Consistent" }],
    findings: [finding([transcript, { source: "context", record: "lead", id: lead.record_id }, { source: "context", record: "interaction", id: "call:6ab2b4870c84337849a49dc5" }]),
      finding([{ source: "context", record: "story_event", id: s.story_event_ids![1] }, { source: "context", record: "contact_number", id: "6ab2b4870c84337849a49dc5" }])],
    prior_finding_relations: [
      { prior_index: 0, relation: "superseded", by_finding_index: 0, evidence: [{ source: "context", record: "prior_finding", id: s.prior_finding_ids![0] }, transcript], note: "Newer promise" },
      { prior_index: 1, relation: "cannot_determine", by_finding_index: null, evidence: [], note: null }],
    story_discrepancies: [{ story_index: 1, claim: "Customer says no text arrived", evidence: [{ source: "context", record: "story_event", id: s.story_event_ids![1] }, transcript] }] };
}
/** The same answer written with handles: T / P by index, R through the table (the model's job in v6). */
function toHandles(answer: unknown, table: CitationHandleTable): unknown {
  const byRecord = new Map(table.handles.map(h => [`${h.record_type}\u0000${h.record_id}`, h.ref]));
  return JSON.parse(JSON.stringify(answer), (key, value) => (value && typeof value === "object" && value.source === "context"
    ? { source: "context", ref: byRecord.get(`${value.record}\u0000${value.id}`) } : value));
}

test("CH-T3: the same answer with handles expands to the byte-identical csi-envelope-v1 envelope", () => {
  const inputs = scope(), table = tableOf(inputs);
  const ids = expandStructuredFindings(v5Answer(), inputs);
  const handlesAnswer = toHandles(v5Answer(), table);
  assert.ok(JSON.stringify(handlesAnswer).includes('"ref":"T1"') && JSON.stringify(handlesAnswer).includes('"ref":"P0"') && JSON.stringify(handlesAnswer).includes('"ref":"R1"'));
  assert.ok(!/"id":|"record":/.test(JSON.stringify(handlesAnswer)), "no record id is typed in handles mode");
  const handles = expandStructuredFindings(handlesAnswer, { ...inputs, citation_handles: table });
  assert.equal(JSON.stringify(handles), JSON.stringify(ids), "E' === E byte for byte");
  assert.equal(payloadHash(handles), payloadHash(ids));
  // The Lead captured on two pages expands to both pages in both modes.
  assert.deepEqual(handles.findings[0]!.evidence.filter(e => e.source === "vantage_record").map(e => e.snapshot_id), ["context-snapshot", "prior-snapshot", "context-snapshot"]);
  // The existing structured-contract fixture shape (transcript-only and a single context Lead) round-trips too.
  const plain = { ...v5Answer(), findings: [finding([transcript]), finding([{ source: "context", record: "lead", id: lead.record_id }])], prior_finding_relations: [], story_discrepancies: [] };
  assert.equal(JSON.stringify(expandStructuredFindings(toHandles(plain, table), { ...inputs, citation_handles: table })), JSON.stringify(expandStructuredFindings(plain, inputs)));
});

test("CH-T4: an unknown or out-of-range ref is refused handle_not_in_context; the hint names the ranges; nothing is substituted", () => {
  const inputs = scope(), table = tableOf(inputs), handlesInputs = { ...inputs, citation_handles: table };
  assert.equal(handleRanges(table), "T0–T1, P0–P1 and R1–R3");
  const refused = (answer: unknown) => { try { expandStructuredFindings(answer, handlesInputs); return null; } catch (error) { return (error as { issues?: unknown }).issues; } };
  const withRef = (ref: string) => ({ ...(toHandles(v5Answer(), table) as object), findings: [finding([transcript, { source: "context", ref }])] });
  for (const ref of ["R9", "T2", "P7", "T0001"]) assert.deepEqual(refused(withRef(ref)), [{ path: "findings.0.evidence.1.ref", code: "handle_not_in_context" }], ref);
  // Wrong shape never reaches expansion (schema), and an id-form citation is not accepted in handles mode.
  assert.throws(() => expandStructuredFindings(withRef("X1"), handlesInputs), z.ZodError);
  assert.throws(() => expandStructuredFindings(v5Answer(), handlesInputs), z.ZodError);
  // Nor is a handle accepted in id mode.
  assert.throws(() => expandStructuredFindings(toHandles(v5Answer(), table), inputs), z.ZodError);
  const hints = citationRepairHints({ ...withRef("R9"), story_discrepancies: [{ story_index: 0, claim: "x", evidence: [{ source: "context", ref: "R9" }, { source: "context", ref: "T3" }] }] }, handlesInputs);
  assert.equal(hints.length, 2);
  assert.match(hints[0]!, /^findings\.0\.evidence\.1, story_discrepancies\.0\.evidence\.0: ref "R9" is not a supplied handle: the handles run T0–T1, P0–P1 and R1–R3\./);
  assert.ok(!/exists?:/.test(hints[0]!), "R9: no other list has a 9");
  assert.match(hints[1]!, /ref "T3" is not a supplied handle.* R3 \(a contact_number record\) exists: check which record you mean\./);
  assert.deepEqual(citationRepairHints(toHandles(v5Answer(), table), handlesInputs), [], "a clean handles answer has no hints");
  // The table is the only authority: an id in the table's records never resolves as a ref.
  assert.equal(handleIndex(table).resolve(lead.record_id), null);
});

test("the v6 output schema: only the context citation changes; the ref pattern reaches the provider schema", () => {
  assert.equal(findingsSchemaFor("ids"), minimalFindingsSchema);
  assert.equal(findingsSchemaFor("handles"), minimalFindingsSchemaHandles);
  const ids = JSON.stringify(z.toJSONSchema(minimalFindingsSchema)), handles = JSON.stringify(z.toJSONSchema(minimalFindingsSchemaHandles));
  const contextIds = '{"type":"object","properties":{"source":{"type":"string","const":"context"},"record":', contextHandles = '{"type":"object","properties":{"source":{"type":"string","const":"context"},"ref":{"type":"string","pattern":"^(T|P|R)[0-9]{1,4}$"}},"required":["source","ref"],"additionalProperties":false}';
  assert.ok(ids.includes(contextIds) && !handles.includes(contextIds));
  assert.equal(handles.split(contextHandles).length - 1, ids.split(contextIds).length - 1, "every finding kind, prior relations and discrepancies");
  for (const key of ["snapshot_id", "field_paths", "speaker_ref", "finding_keys", "record_id", '"id"']) assert.equal(handles.includes(key.startsWith('"') ? key : `"${key}"`), false, key);
  // Every other part of the schema (bounds included) is the v5 one: swap the context citation back and the JSON is identical.
  const contextIdsFull = ids.slice(ids.indexOf(contextIds), ids.indexOf("}", ids.indexOf('"additionalProperties":false', ids.indexOf(contextIds))) + 1);
  assert.equal(handles.split(contextHandles).join(contextIdsFull), ids);
  assert.doesNotThrow(() => providerCompatibleSchema(z.toJSONSchema(minimalFindingsSchemaHandles) as Parameters<typeof providerCompatibleSchema>[0]));
  assert.ok(JSON.stringify(providerCompatibleSchema(z.toJSONSchema(minimalFindingsSchemaHandles) as Parameters<typeof providerCompatibleSchema>[0])).includes('"pattern":"^(T|P|R)[0-9]{1,4}$"'));
  assert.ok(["T0", "P12", "R1", "R9999"].every(ref => CITATION_HANDLE_PATTERN.test(ref)) && !["r1", "T", "R12345", "S1", " T1"].some(ref => CITATION_HANDLE_PATTERN.test(ref)));
});
