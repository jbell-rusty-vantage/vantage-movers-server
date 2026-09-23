import assert from "node:assert/strict";
import { test } from "node:test";
import { payloadHash } from "../transactions";
import type { ReadContent } from "../analysis/reads";
import {
  selectConversationSources, selectCorrections, selectRetainedFindings,
  type AssessmentReader, type ConversationRow, type FindingRow, type LegacyRunRow, type SummaryArtifactRow,
} from "./sources";

const coverage: ReadContent["coverage"] = { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false };
const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T15:00:00.000Z`);
function artifact(id: string, conversationId: string, version: string): SummaryArtifactRow {
  const response: ReadContent = { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] }, coverage,
    instructions: [], speaker_refs: [], allowed_followup_ids: [],
    transcript: { conversation_id: conversationId, transcript_version: version, source_snapshot_id: `t-${conversationId}`, segments: [] },
    analysis_summary: { summary: { overview: "Customer is planning a move.", customer_wanted: "Two-bedroom move to Austin.",
      money_and_dates: "Moving October 15; call 305 555 0100.", outcome: "", commitments: "", discrepancies: "" },
    said_on_call: [
      { kind: "move_fact", claim: "Customer is moving October 15", value: { field: "move_date", stated_value: "October 15" }, actor: "customer",
        clarity: "clear", action_status: null, speaker: "customer", segment_ids: [3, 4], quote: "definitely moving on October 15" },
      { kind: "quoted_amount", claim: "Rep quoted $3,200", value: { amount_text: "$3,200", currency: "USD", meaning: "quote_total" },
        actor: "rep", clarity: "clear", action_status: null, speaker: "rep", segment_ids: [9], quote: null },
    ] } };
  return { _id: id, conversation_id: conversationId, response, content_digest: payloadHash(response) };
}
const legacySummary = { overview: "Legacy overview.", customer_wanted: "Wants a quote.", money_and_dates: "Quoted $2,900.",
  outcome: "Will think about it.", commitments: "", discrepancies: "", finding_keys: [] };
function legacyRun(id: string, conversationId: string, completed: number): LegacyRunRow {
  return { _id: id, conversation_id: conversationId, status: "completed", completed_at: at(completed), analysis_pipeline: null,
    output: { schema_version: "csi-envelope-v1", summary: legacySummary, findings: [] } };
}
function finding(id: string, runId: string, conversationId: string, overrides: Record<string, unknown> = {}, row: Partial<FindingRow> = {}): FindingRow {
  const assertion = { key: id, claim: "Customer is moving October 15", basis: "said_on_call", actor: "customer", speaker_ref: null,
    action_status: null, clarity: "clear", confidence: null, kind: "move_fact", value: { field: "move_date", stated_value: "October 15" },
    evidence: [{ source: "transcript", snapshot_id: "t", conversation_id: conversationId, transcript_version: "v2", segment_ids: [4], quote: null }],
    ...overrides };
  return { _id: id, run_id: runId, conversation_id: conversationId, revision: 1, kind: String(assertion.kind), review_state: "unreviewed",
    superseded_by: null, assertion, ...row };
}
const conversations: ConversationRow[] = [
  // Deliberately out of chronological order.
  { _id: "c3", started_at: at(12), latest_transcript_version: null, summary: { model: "gpt-x", prompt_version: "p1",
    text: "Full text", sections: { overview: "Old pipeline overview", customer_wanted: "Wants storage", money_dates: null } } },
  { _id: "c1", started_at: at(10), latest_transcript_version: "v2", latest_completed_run_id: "run-structured",
    summary: { model: "gpt-x", prompt_version: "p1", text: "Would be ignored" } },
  { _id: "c2", started_at: at(11), latest_transcript_version: "v9" },
  { _id: "c4", started_at: at(13), latest_transcript_version: null, summary: { text: "No provenance" } },
  { _id: "c5", started_at: at(14), latest_transcript_version: "v1", content_purged_at: at(20) },
  { _id: "c6", started_at: at(15), analysis_eligibility: { status: "excluded" }, summary: { model: "m", prompt_version: "p", text: "x" } },
];
function reader(overrides: Partial<AssessmentReader> = {}, calls: string[] = []): AssessmentReader {
  const base: AssessmentReader = {
    conversations: async () => conversations,
    summaryArtifacts: async () => [artifact("a-old", "c1", "v1"), artifact("a1", "c1", "v2"), artifact("a2", "c2", "v1")],
    legacyRuns: async () => [legacyRun("r-c1", "c1", 10), legacyRun("r-old", "c2", 11), legacyRun("r-new", "c2", 12),
      { ...legacyRun("r-structured", "c2", 13), analysis_pipeline: "csi-analysis-steps-v1" }],
    findings: async () => [],
    instructions: async () => [],
    record: async () => null, number: async () => null, attachments: async () => [], lead: async () => null,
  };
  const merged = { ...base, ...overrides };
  // Records which reads happen: a transcript/media read would appear here and fail the test.
  return Object.fromEntries(Object.entries(merged).map(([key, fn]) => [key, (...args: unknown[]) => { calls.push(key);
    return (fn as (...a: unknown[]) => unknown)(...args); }])) as AssessmentReader;
}

test("one summary version per conversation in preference order, chronological, with skip reasons", async () => {
  const calls: string[] = [];
  const selection = await selectConversationSources("n1", { reader: reader({}, calls) });
  assert.deepEqual(selection.conversations.map(c => [c.conversation_id, c.source.kind, c.source.id]),
    [["c1", "summary_artifact", "a1"], ["c2", "legacy_run", "r-new"], ["c3", "conversation_summary", "c3"]]);
  assert.deepEqual(selection.skipped, [{ conversation_id: "c5", reason: "content_purged" }, { conversation_id: "c6", reason: "analysis_excluded" },
    { conversation_id: "c4", reason: "no_retained_summary" }]);
  assert.deepEqual([...new Set(calls)].sort(), ["conversations", "legacyRuns", "summaryArtifacts"]);
  const [structured, legacy, stored] = selection.conversations;
  assert.equal(structured.source.version, artifact("a1", "c1", "v2").content_digest);
  assert.deepEqual(structured.finding_run, { run_id: "run-structured", transcript_version: "v2" });
  // Sections, then said_on_call with speaker and summary-step locator; text is redacted.
  assert.deepEqual(structured.entries.map(e => [e.kind, e.locator.source === "summary_artifact" && e.locator.section, e.speaker ?? null]),
    [["summary_section", "overview", null], ["summary_section", "customer_wanted", null], ["summary_section", "money_and_dates", null],
      ["said_on_call", "said_on_call.0", "customer"], ["said_on_call", "said_on_call.1", "rep"]]);
  assert.equal(structured.entries[0].call_at, "2026-09-10T15:00:00.000Z");
  assert.equal(stored.source.version, payloadHash(JSON.parse(JSON.stringify(conversations[0].summary))));
  assert.deepEqual(stored.entries.map(e => [e.kind, e.locator.source === "conversation_summary" && e.locator.section]),
    [["legacy_summary_section", "overview"], ["legacy_summary_section", "customer_wanted"]]);
  // Legacy narrative citations are stored-summary + digest citations, never transcript segments.
  for (const entry of legacy.entries) {
    assert.equal(entry.kind, "legacy_summary_section");
    assert.equal(entry.locator.source, "legacy_run");
    assert.equal("segment_ids" in entry.locator || "transcript_version" in entry.locator, false);
    assert.ok("output_digest" in entry.locator && entry.locator.output_digest === legacy.source.version);
  }
  assert.deepEqual(legacy.entries.map(e => "section" in e.locator && e.locator.section), ["overview", "customer_wanted", "money_and_dates", "outcome"]);
});

test("a tampered artifact falls through to the next retained source; summary text alone falls back to text", async () => {
  const tampered = { ...artifact("a1", "c1", "v2"), content_digest: "invented" };
  const selection = await selectConversationSources("n1", { reader: reader({ summaryArtifacts: async () => [tampered],
    conversations: async () => [conversations[1], { _id: "c7", started_at: at(16), summary: { model: "m", prompt_version: "p", text: "Plain text only" } }] }) });
  assert.deepEqual(selection.conversations.map(c => c.source.kind), ["legacy_run", "conversation_summary"]);
  assert.deepEqual(selection.conversations[1].entries.map(e => [e.kind, "section" in e.locator && e.locator.section]), [["legacy_summary_text", "text"]]);
});

test("bounds throw EVIDENCE_LIMIT_REACHED instead of silently dropping older calls", async () => {
  const many = Array.from({ length: 41 }, (_, i): ConversationRow => ({ _id: `m${i}`, started_at: at(1),
    summary: { model: "m", prompt_version: "p", text: "Summary" } }));
  await assert.rejects(selectConversationSources("n1", { reader: reader({ conversations: async () => many }) }), /EVIDENCE_LIMIT_REACHED/);
  const wide = Array.from({ length: 34 }, (_, i): ConversationRow => ({ _id: `w${i}`, started_at: at(1), summary: { model: "m", prompt_version: "p",
    text: "t", sections: { overview: "a", customer_wanted: "b", money_dates: "c", outcome: "d", promised: "e", mismatch: "f" } } }));
  await assert.rejects(selectConversationSources("n1", { reader: reader({ conversations: async () => wide }) }), /EVIDENCE_LIMIT_REACHED/);
  assert.equal((await selectConversationSources("n1", { reader: reader({ conversations: async () => wide.slice(0, 33) }) })).conversations.length, 33);
});

test("findings are optional supporting observations with lineage to the summary entry that states them", async () => {
  const { conversations: selected } = await selectConversationSources("n1", { reader: reader() });
  const rows = [
    finding("f1", "run-structured", "c1"),
    finding("f2", "run-structured", "c1", { evidence: [{ source: "transcript", snapshot_id: "t", conversation_id: "c1", transcript_version: "v1", segment_ids: [4], quote: null }] }),
    finding("f3", "run-structured", "c1", {}, { review_state: "retracted" }),
    finding("f4", "run-structured", "c1", { kind: "next_step", value: { action_kind: "call", description: "Call back", date_text: null, timezone_text: null, target_followup_id: null } }, { kind: "next_step" }),
    finding("f5", "run-structured", "c1", { basis: "model_inference" }),
    finding("f6", "r-new", "c2", { kind: "quoted_amount", claim: "Quoted $2,900", value: { amount_text: "$2,900", currency: "USD", meaning: "quote_total" } }, { kind: "quoted_amount" }),
    finding("f7", "r-unselected", "c2"),
    finding("f8", "run-structured", "c1", {}, { purged_at: at(20) }),
  ];
  const result = await selectRetainedFindings(selected, { reader: reader({ findings: async () => rows }) });
  assert.deepEqual(result.entries.map(e => e.id), ["fnd:f1", "fnd:f6"]);
  const [summaryBacked, legacyBacked] = result.entries;
  // Same kind + overlapping segments: the said_on_call fact, not an independent confirmation.
  assert.deepEqual(summaryBacked.lineage, ["src:c1:said_on_call.0"]);
  assert.deepEqual(summaryBacked.locator, { source: "finding", finding_id: "f1", run_id: "run-structured", revision: 1, conversation_id: "c1" });
  assert.equal(summaryBacked.speaker, "customer");
  assert.deepEqual(legacyBacked.lineage, ["src:c2:money_and_dates"]);
  assert.deepEqual(result.manifest.map(m => [m.kind, m.id, m.version, m.lineage]),
    [["finding", "f1", "1", ["a1"]], ["finding", "f6", "1", ["r-new"]]]);
  assert.deepEqual(await selectRetainedFindings([], { reader: reader({ findings: async () => { throw new Error("not read"); } }) }), { entries: [], manifest: [] });
});

test("Owner corrections: only active applicable fields, redacted, with revisions", async () => {
  const rows = [
    { instruction_id: "i2", subject_key: "lead:FormLead:l1", field: "closure", current: { closed: true, note: "card 4111 1111 1111 1111" }, revision: 3, state: "active" },
    { instruction_id: "i1", subject_key: "lead:FormLead:l1", field: "assignment", current: { agent: "x" }, revision: 1, state: "active" },
    { instruction_id: "i3", subject_key: "lead:FormLead:l1", field: "status", current: "done", revision: 1, state: "retracted" },
  ];
  const corrections = await selectCorrections(["lead:FormLead:l1", "lead:FormLead:l1"], { reader: reader({ instructions: async keys => {
    assert.deepEqual(keys, ["lead:FormLead:l1"]); return rows; } }) });
  assert.equal(corrections.length, 1);
  assert.deepEqual(corrections[0].entry.locator, { source: "owner_correction", instruction_id: "i2", revision: 3 });
  assert.ok(!corrections[0].entry.text.includes("4111"));
  assert.deepEqual(corrections[0].manifest, { kind: "owner_correction", id: "i2", version: "3" });
});
