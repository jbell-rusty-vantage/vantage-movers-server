import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { payloadHash } from "../transactions";
import type { ReadContent } from "../analysis/reads";
import { assembleAssessmentContext, type AssessmentContext, type AssessmentSkip } from "./context";
import type { AssessmentReader, AttachmentRow, ConversationRow, FindingRow, InstructionRow, LeadRow, SubjectRecordRow } from "./sources";

const leadId = new Types.ObjectId(), numberId = new Types.ObjectId(), recordId = new Types.ObjectId();
const coverage: ReadContent["coverage"] = { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false };
function summaryArtifact() {
  const response: ReadContent = { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] }, coverage,
    instructions: [], speaker_refs: [], allowed_followup_ids: [],
    transcript: { conversation_id: "c1", transcript_version: "v1", source_snapshot_id: "t1", segments: [] },
    analysis_summary: { summary: { overview: "Customer plans a two-bedroom move.", customer_wanted: "", money_and_dates: "", outcome: "Liked the quote.",
      commitments: "", discrepancies: "" }, said_on_call: [{ kind: "intent", claim: "Customer wants to move", value: { intent: "moving_inquiry" },
      actor: "customer", clarity: "clear", action_status: null, speaker: "customer", segment_ids: [2], quote: null }] } };
  return { _id: "a1", conversation_id: "c1", response, content_digest: payloadHash(response) };
}
type World = { record: SubjectRecordRow; number: { _id: unknown; kind: string; classification: string; purged_at?: Date | null };
  lead: LeadRow & Record<string, unknown>; conversations: ConversationRow[]; findings: FindingRow[]; instructions: InstructionRow[]; attachments: AttachmentRow[] };
function world(): World {
  return {
    record: { _id: recordId, subject: { kind: "lead", model: "FormLead", id: leadId }, state: "open", revision: 7, primary_contact_number_id: numberId,
      closure_origin: null, lead_attachment: { attachment_id: new Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"), state: "attached" }, lead_attachment_revision: 2,
      lead_progress: { disposition_revision: "d1" }, ...{ responsible_agent_id: "agent-1", assignment: { origin: "owner" }, move_assessment: null } },
    number: { _id: numberId, kind: "external", classification: "customer" },
    lead: { _id: leadId, pickup_city: "Miami", pickup_state: "FL", pickup_zip: "33101", delivery_city: "Austin", delivery_state: "TX",
      destination_zip: "73301", move_date: new Date("2026-10-15T00:00:00Z"), move_size: "2 Bedroom", cubic_feet: null,
      ingestion_origin: "wordpress_form", ingested_move_snapshot: { pickup_city: "Miami", pickup_state: "FL", pickup_zip: "33101",
        delivery_city: "Dallas", delivery_state: "TX", destination_zip: "75201", captured_at: new Date("2026-09-01T00:00:00Z"), evidence_status: "captured_at_ingestion" },
      booked: null, cancelled: null, duplicate: false, bad_lead: null, no_sync: false,
      // Fields the assessment must never read into its prompt or fingerprint.
      name: "Jane Customer", phone_number: "3055550100", email: "jane@example.com", cpl: 45, source_company: "Top10",
      granot_priority: "5", quoted: false, receiver_agent: "agent-1" },
    conversations: [{ _id: "c1", started_at: new Date("2026-09-20T15:00:00Z"), latest_transcript_version: "v1", latest_completed_run_id: "run-1" }],
    findings: [{ _id: "f1", run_id: "run-1", conversation_id: "c1", revision: 1, kind: "intent", review_state: "unreviewed", superseded_by: null,
      assertion: { key: "f1", claim: "Customer wants to move", basis: "said_on_call", actor: "customer", speaker_ref: null, action_status: null,
        clarity: "clear", confidence: null, kind: "intent", value: { intent: "moving_inquiry" },
        evidence: [{ source: "transcript", snapshot_id: "t1", conversation_id: "c1", transcript_version: "v1", segment_ids: [2], quote: null }] } }],
    instructions: [{ instruction_id: "i1", subject_key: `lead:FormLead:${leadId}`, field: "description", current: { note: "Customer asked for Tuesday" }, revision: 1, state: "active" }],
    attachments: [],
  };
}
function reader(w: World): AssessmentReader {
  return {
    record: async () => w.record, number: async () => w.number, lead: async () => w.lead, attachments: async () => w.attachments,
    conversations: async () => w.conversations, summaryArtifacts: async () => w.conversations.length ? [summaryArtifact()] : [],
    legacyRuns: async () => [], findings: async () => w.findings, instructions: async () => w.instructions,
  };
}
const now = new Date("2026-09-22T12:00:00Z");
async function assemble(w: World, extra: { allow_lead_only?: boolean; now?: Date } = {}) {
  return assembleAssessmentContext({ outreach_record_id: String(recordId), now, ...extra }, undefined, reader(w));
}
async function ready(w: World, extra: { allow_lead_only?: boolean; now?: Date } = {}): Promise<AssessmentContext> {
  const result = await assemble(w, extra);
  assert.ok(!("skip" in result), JSON.stringify(result));
  return result;
}
async function skipped(w: World, extra: { allow_lead_only?: boolean } = {}): Promise<AssessmentSkip> {
  const result = await assemble(w, extra);
  assert.ok("skip" in result);
  return result;
}

test("catalog ids are e1..eN in views → official → corrections → conversations → findings order", async () => {
  const context = await ready(world());
  assert.deepEqual(context.catalog.map(e => e.id), context.catalog.map((_, i) => `e${i + 1}`));
  assert.deepEqual(context.catalog.map(e => e.kind), [
    "lead_ingested", "lead_ingested", "lead_current", "lead_current", "lead_current", "lead_current",
    "official_state", "official_state", "official_state", "official_state", "official_state", "owner_correction",
    "summary_section", "summary_section", "said_on_call", "finding"]);
  const finding = context.catalog.at(-1)!;
  const said = context.catalog.find(e => e.kind === "said_on_call")!;
  assert.deepEqual(finding.lineage, [said.id]);
  assert.deepEqual(context.prompt_payload.findings, [{ id: finding.id, text: finding.text, restates: [said.id] }]);
  assert.equal(context.input_mode, "summaries_with_findings");
  assert.deepEqual(context.coverage, { conversations_available: 1, conversations_selected: 1, findings_selected: 1, source_coverage: "complete" });
  assert.equal(context.latest_conversation_at?.toISOString(), "2026-09-20T15:00:00.000Z");
  assert.equal(context.context_as_of, now);
  assert.deepEqual(context.eligibility, { record_revision: 7, record_state: "open", closure_origin: null, disposition_revision: "d1" });
  assert.deepEqual(context.lead_ref, { model: "FormLead", id: String(leadId) });
  assert.equal(context.views?.original_ingestion?.label, "original_form_submission");
  assert.deepEqual(context.source_manifest.map(m => m.kind).sort(), ["finding", "lead", "official", "owner_correction", "summary_artifact"]);
});

test("the prompt payload carries no contact identity, CPL, source price, rep, Priority or band", async () => {
  const context = await ready(world());
  const payload = JSON.stringify(context.prompt_payload);
  for (const forbidden of ["Jane", "3055550100", "jane@example.com", "Top10", "cpl", "agent-1", "granot_priority", "quoted", "band"])
    assert.equal(payload.includes(forbidden), false, forbidden);
  assert.deepEqual(context.prompt_payload.subject, { kind: "lead", lead_model: "FormLead", no_conversation_evidence: false });
  assert.equal(context.prompt_payload.views.original_ingestion?.label, "original_form_submission");
  assert.ok(context.prompt_payload.views.canonical_current?.entries.some(e => e.text === "Current Lead delivery: Austin, TX, 73301"));
  assert.ok(context.prompt_payload.views.original_ingestion?.entries.some(e => e.text.endsWith("delivery: Dallas, TX, 75201")));
});

test("fingerprint follows move fields, attachment and corrections, and ignores Priority/Quoted/band/follow-ups/clocks", async () => {
  const base = (await ready(world())).fingerprint;
  const changed = async (mutate: (w: World) => void, extra: { now?: Date } = {}) => { const w = world(); mutate(w); return (await ready(w, extra)).fingerprint; };
  assert.notEqual(await changed(w => { w.lead.pickup_zip = "33139"; }), base);
  assert.notEqual(await changed(w => { w.lead.current_move_provenance = { source_system: "granot", changed_at: new Date("2026-09-21T00:00:00Z") }; }), base);
  assert.notEqual(await changed(w => { w.record.lead_attachment_revision = 3; }), base);
  assert.notEqual(await changed(w => { w.instructions[0].revision = 2; }), base);
  assert.notEqual(await changed(w => { w.lead.booked = new Types.ObjectId(); }), base);
  assert.notEqual(await changed(w => { w.findings[0].revision = 2; }), base);
  assert.equal(await changed(w => { Object.assign(w.lead, { granot_priority: "7", quoted: true, name: "Other", updatedAt: new Date() }); }), base);
  assert.equal(await changed(w => { Object.assign(w.record, { revision: 99, lead_progress: { disposition_revision: "d9" }, band: 1,
    next_action: { kind: "call" }, responsible_agent_id: "agent-2", assignment: { origin: "worker" }, move_assessment: { transaction_intent: 75 } }); }), base);
  assert.equal(await changed(() => undefined, { now: new Date("2027-01-01T00:00:00Z") }), base);
});

test("no retained summary skips unless the Lead-only cohort is explicitly allowed", async () => {
  const w = world(); w.conversations = [];
  assert.deepEqual(await skipped(w), { skip: "skipped_no_summary", reason: "no_retained_summary", subject_key: `lead:FormLead:${leadId}`, outreach_record_id: String(recordId) });
  const leadOnly = await ready(w, { allow_lead_only: true });
  assert.equal(leadOnly.input_mode, "lead_only");
  assert.equal(leadOnly.prompt_payload.subject.no_conversation_evidence, true);
  assert.deepEqual(leadOnly.coverage, { conversations_available: 0, conversations_selected: 0, findings_selected: 0, source_coverage: "none" });
  assert.equal(leadOnly.latest_conversation_at, null);
  // A Number Review subject without an attached Lead has nothing to assess Lead-only.
  const bare = world(); bare.conversations = [];
  bare.record = { ...bare.record, subject: { kind: "number_review", contact_number_id: numberId }, lead_attachment: null };
  assert.equal((await skipped(bare, { allow_lead_only: true })).skip, "skipped_no_summary");
});

test("ambiguous, closed and excluded subjects skip before any source read", async () => {
  const cases: Array<[(w: World) => void, AssessmentSkip["skip"], string]> = [
    [w => { w.record.state = "identity_review"; }, "ambiguous_subject", "identity_review"],
    [w => { w.record.lead_attachment = { state: "ambiguous" }; }, "ambiguous_subject", "lead_attachment_ambiguous"],
    [w => { w.record = { ...w.record, subject: { kind: "number_review", contact_number_id: numberId }, lead_attachment: null };
      w.attachments = [0, 1].map(i => ({ _id: `edge${i}`, lead_ref: { model: "CallLead", id: new Types.ObjectId() }, state: "attached", revision: 1 })); },
    "ambiguous_subject", "multiple_attached_leads"],
    [w => { w.record.state = "closed"; w.record.closure_origin = "official"; }, "not_applicable", "closed_official"],
    [w => { w.number.classification = "company"; }, "excluded", "number_external_company"],
    [w => { w.number.kind = "internal"; }, "excluded", "number_internal_customer"],
  ];
  for (const [mutate, skip, reason] of cases) {
    const w = world(); mutate(w);
    w.conversations = [{ _id: "boom", get started_at(): Date { throw new Error("sources must not be read"); } }];
    const result = await skipped(w);
    assert.deepEqual([result.skip, result.reason], [skip, reason]);
  }
});

test("a Number Review subject uses its single attached Lead; oversized evidence is reported, not truncated", async () => {
  const w = world();
  w.record = { ...w.record, subject: { kind: "number_review", contact_number_id: numberId }, lead_attachment: null };
  w.attachments = [{ _id: "edge1", lead_ref: { model: "FormLead", id: leadId }, state: "attached", revision: 4 },
    { _id: "edge2", lead_ref: { model: "CallLead", id: new Types.ObjectId() }, state: "candidate", revision: 1 }];
  const context = await ready(w);
  assert.equal(context.subject_key, `number:${numberId}`);
  assert.deepEqual(context.prompt_payload.subject, { kind: "number_review", lead_model: "FormLead", no_conversation_evidence: false });
  const edge = (await ready(w)).fingerprint;
  w.attachments[0].revision = 5;
  assert.notEqual((await ready(w)).fingerprint, edge);

  const big = world();
  big.conversations = Array.from({ length: 41 }, (_, i) => ({ _id: `m${i}`, started_at: new Date("2026-09-01T00:00:00Z"),
    summary: { model: "m", prompt_version: "p", text: "Summary" } }));
  assert.deepEqual((await skipped(big)).skip, "evidence_limit_reached");
});

test("a Lead-only Outreach Record with no primary Contact Number never looks up a Number and assesses from its Lead views", async () => {
  const w = world(); w.conversations = [];
  w.record = { ...w.record, primary_contact_number_id: null, lead_attachment: null, lead_attachment_revision: null };
  const numberReads: unknown[] = [];
  const bare = { ...reader(w), number: async (id: unknown) => { numberReads.push(id); return null; }, conversations: async () => { throw new Error("no Number to read"); } };
  const skip = await assembleAssessmentContext({ outreach_record_id: String(recordId), now }, undefined, bare);
  assert.ok("skip" in skip && skip.skip === "skipped_no_summary");
  const context = await assembleAssessmentContext({ outreach_record_id: String(recordId), now, allow_lead_only: true }, undefined, bare);
  assert.ok(!("skip" in context));
  assert.equal(context.input_mode, "lead_only");
  assert.equal(context.contact_number_id, null);
  assert.deepEqual(numberReads, [], "no Contact Number lookup for a Number-less record");
});
