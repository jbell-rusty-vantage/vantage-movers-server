/**
 * AC2-ASSESS (Attention and Case File spec §4.10, §3.3, K11): the assessment context under the Case File
 * layout. The fixture is `context.test.ts`'s world with fixed ids (so the legacy fingerprint is comparable
 * across trees); the Case File builder and prior selection are injected.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { payloadHash } from "../transactions";
import type { ReadContent } from "../analysis/reads";
import { assembleAssessmentContext, type AssessmentContext, type AssessmentContextDeps } from "./context";
import type { CaseFileInput, RenderedCaseFile } from "../casefile/types";
import type { AssessmentReader, AttachmentRow, ConversationRow, FindingRow, InstructionRow, LeadRow, SubjectRecordRow } from "./sources";

const leadId = new Types.ObjectId("650000000000000000000a01"), numberId = new Types.ObjectId("650000000000000000000a02"), recordId = new Types.ObjectId("650000000000000000000a03");
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
/** assessment/context.ts at 01bcf18 on this fixture (base worktree run, identical to this tree with the flag off). */
const LEGACY_FINGERPRINT = "4d06d265052e28962f14909cda0297ed7fe3423ae831795b0976d190c1c30b3a";
const LEGACY_PAYLOAD_HASH = "f61c39968d19b62ba221637d586858ff1b72830f41f4968b1a08d23e582da25e";
type Built = { input: CaseFileInput };
function fakeCaseFile(text: string, customerEvidence: string, calls: Built[] = []): NonNullable<AssessmentContextDeps["caseFile"]> {
  return async input => {
    calls.push({ input });
    const rendered: RenderedCaseFile = { text, bytes: Buffer.byteLength(text), digest: payloadHash(text), customer_evidence_digest: customerEvidence,
      trimmed_steps: [], over_hard_budget: false };
    return { rendered };
  };
}
const prior: ReadContent = { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] }, coverage, instructions: [], speaker_refs: [], allowed_followup_ids: [] };
async function ready(w: World, deps: AssessmentContextDeps = {}): Promise<AssessmentContext> {
  const result = await assembleAssessmentContext({ outreach_record_id: String(recordId), now }, undefined, reader(w), deps);
  assert.ok(!("skip" in result), JSON.stringify(result));
  return result;
}

test("legacy layout (flag off): no case_file key, no builder call, and the 01bcf18 fingerprint and payload", async () => {
  const calls: Built[] = [];
  const context = await ready(world(), { caseFile: fakeCaseFile("unused", "unused", calls) });
  assert.equal(context.layout, "legacy");
  assert.equal(calls.length, 0);
  assert.ok(!("case_file" in context.prompt_payload));
  assert.ok(!("case_file" in context));
  // Captured by running this exact fixture against assessment/context.ts at 01bcf18 (t4base; evidence/AC2-ASSESS.md).
  assert.equal(context.fingerprint, LEGACY_FINGERPRINT);
  assert.equal(payloadHash(JSON.parse(JSON.stringify(context.prompt_payload))), LEGACY_PAYLOAD_HASH);
});

test("Case File layout: the payload carries the rendered text; the builder gets the assessment audience and renumbered catalog lines", async () => {
  const calls: Built[] = [], priors: unknown[] = [];
  const context = await ready(world(), { layout: "case_file", caseFile: fakeCaseFile("CASE FILE (data) · Number +13055550100", "ce-1", calls),
    prior: async input => { priors.push(input); return prior; } });
  assert.equal(context.layout, "case_file");
  assert.equal(context.prompt_payload.case_file, "CASE FILE (data) · Number +13055550100");
  assert.deepEqual(Object.keys(context.prompt_payload).at(-1), "case_file", "appended after the existing blocks");
  assert.deepEqual(context.case_file, { bytes: Buffer.byteLength("CASE FILE (data) · Number +13055550100"), digest: payloadHash("CASE FILE (data) · Number +13055550100"), customer_evidence_digest: "ce-1", trimmed_steps: [], over_hard_budget: false });
  assert.equal(calls.length, 1);
  const input = calls[0].input;
  assert.equal(input.audience, "assessment");
  assert.equal(input.contact_number_id, String(numberId));
  assert.deepEqual(input.lead_refs, [{ model: "FormLead", id: String(leadId) }]);
  assert.deepEqual(input.outreach_record_ids, [String(recordId)]);
  assert.deepEqual(input.conversation_ids, ["c1"]);
  assert.deepEqual(input.focus_conversation_ids, ["c1"]);
  assert.equal(input.prior, prior);
  assert.deepEqual(priors, [{ contact_number_id: String(numberId), subject_key: `lead:FormLead:${leadId}`, outreach_record_id: String(recordId), as_of: now }]);
  assert.equal(+input.as_of, +now);
  // Every catalog entry of the conversation, by its final e-number, and nothing else.
  const conversationEntries = context.catalog.filter(e => ["summary_section", "said_on_call", "move_evidence"].includes(e.kind));
  assert.deepEqual(input.evidence_lines, { c1: conversationEntries.map(e => ({ id: e.id, text: e.text })) });
  // The assessment step contract is v2 under this layout.
  assert.notEqual(context.fingerprint, (await ready(world())).fingerprint);
});

test("K11 fingerprint: only the customer-evidence digest of the Case File enters it (never the §3/§5 text)", async () => {
  const deps = (text: string, digest: string): AssessmentContextDeps => ({ layout: "case_file", caseFile: fakeCaseFile(text, digest), prior: async () => prior });
  const base = (await ready(world(), deps("§3 Estimate $7,100 · §5 open: F-0 call", "ce-1"))).fingerprint;
  // §3 Granot and §5 Outreach text change, customer evidence unchanged: same fingerprint.
  assert.equal((await ready(world(), deps("§3 Estimate $6,600 (Sep 22) · §5 open: F-0 call, F-1 Follow up on the quote", "ce-1"))).fingerprint, base);
  // Customer evidence changes (§2 or a call summary): new fingerprint.
  assert.notEqual((await ready(world(), deps("§3 Estimate $7,100 · §5 open: F-0 call", "ce-2"))).fingerprint, base);
  // The existing inputs still register (a move field), and Priority/Quoted still do not.
  const w = world(); (w.lead as Record<string, unknown>).move_date = new Date("2026-11-01T00:00:00Z");
  assert.notEqual((await ready(w, deps("same", "ce-1"))).fingerprint, base);
  const q = world(); (q.lead as Record<string, unknown>).granot_priority = "1"; (q.lead as Record<string, unknown>).quoted = true;
  assert.equal((await ready(q, deps("§3 Priority 1 Quoted", "ce-1"))).fingerprint, base);
});

test("a Lead-only record (no Contact Number) builds a Case File without a prior page", async () => {
  const w = world(); w.record.primary_contact_number_id = null; w.conversations = [];
  const calls: Built[] = [];
  const result = await assembleAssessmentContext({ outreach_record_id: String(recordId), now, allow_lead_only: true }, undefined, reader(w),
    { layout: "case_file", caseFile: fakeCaseFile("CASE FILE (data) · L1 (no Contact Number)", "ce-lead", calls), prior: async () => { throw new Error("no prior without a Number"); } });
  assert.ok(!("skip" in result));
  assert.equal(calls[0].input.contact_number_id, null);
  assert.equal(calls[0].input.prior, null);
  assert.deepEqual(calls[0].input.focus_conversation_ids, []);
  assert.equal(result.prompt_payload.case_file, "CASE FILE (data) · L1 (no Contact Number)");
});
