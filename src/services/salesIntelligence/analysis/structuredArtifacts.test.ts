import assert from "node:assert/strict";
import { test } from "node:test";
import { payloadHash } from "../transactions";
import { assembleContextPage, restoreAnalysisArtifact } from "./structuredArtifacts";
import { capturedTranscriptsComplete } from "./coverage";
import { measuredCents } from "./structuredGeneration";
import type { ReadContent } from "./reads";
import { ownerRead } from "../../numberActivity/coverage";

function page(): ReadContent {
  return { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] },
    coverage: { known_through: null, gaps: [{ from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z",
      reason: "call_log_unavailable" }], capabilities: { call_log: "unknown" }, ai_paused: false },
    instructions: [], speaker_refs: [], allowed_followup_ids: [] };
}
function summaryPage(): ReadContent {
  return { ...page(), transcript: { conversation_id: "call-1", transcript_version: "v1",
    source_snapshot_id: "transcript-source", segments: [] },
  analysis_summary: { summary: { overview: "Synthetic call", customer_wanted: "", money_and_dates: "",
    outcome: "", commitments: "", discrepancies: "" }, said_on_call: [{
    kind: "intent", claim: "Moving inquiry", value: { intent: "moving_inquiry" }, actor: "unknown",
    clarity: "uncertain", action_status: null, speaker: "unknown", segment_ids: [4], quote: null,
  }] } };
}

test("context page wrappers reuse the captured coverage without another database read", async () => {
  const coverage = page().coverage;
  const result = await ownerRead({ items: [] }, () => new Date("2026-09-22T00:00:00Z"), coverage);
  assert.equal(result.coverage, coverage);
  assert.equal(result.as_of, "2026-09-22T00:00:00.000Z");
});

test("persisted summary restoration checks digest and both retention markers before returning content", () => {
  const response = summaryPage();
  const row = { _id: "summary-copy", response, content_digest: payloadHash(response) };
  assert.deepEqual(restoreAnalysisArtifact(row), { snapshot_id: "summary-copy", data: response });
  for (const change of [{ purged_at: new Date() }, { purge_started_at: new Date() }, { content_digest: "invented" }])
    assert.throws(() => restoreAnalysisArtifact({ ...row, ...change }), /ORIGINAL_EVIDENCE_UNAVAILABLE/);
  const altered = structuredClone(response);
  altered.analysis_summary!.summary.overview = "Modified after persistence";
  assert.throws(() => restoreAnalysisArtifact({ ...row, response: altered }), /ORIGINAL_EVIDENCE_UNAVAILABLE/);
});

test("context compaction retains attachment certainty and later official fields without duplicate citation handles", () => {
  const attachment = page(), official = page();
  attachment.page.records.push({ record_type: "lead", record_id: "lead-1", revision: "2",
    fields: { model: "FormLead", certainty: "likely", status: "active", booked: false } });
  official.page.records.push({ record_type: "lead", record_id: "lead-1", revision: "3",
    fields: { model: "FormLead", booked: true } });
  attachment.instructions = [{ id: "instruction", revision: 1 }];
  official.instructions = [{ id: "instruction", revision: 2 }];
  attachment.speaker_refs = ["agent:reviewed"];
  official.speaker_refs = ["agent:reviewed"];
  attachment.allowed_followup_ids = ["followup-1"];
  official.allowed_followup_ids = ["followup-1"];
  const merged = assembleContextPage([attachment, official]);
  assert.equal(merged.page.records.length, 1);
  assert.deepEqual(merged.page.records[0].fields, { model: "FormLead", certainty: "likely", status: "active", booked: true });
  assert.deepEqual(merged.instructions, [{ id: "instruction", revision: 2 }]);
  assert.deepEqual(merged.speaker_refs, ["agent:reviewed"]);
  assert.deepEqual(merged.allowed_followup_ids, ["followup-1"]);
  assert.deepEqual(merged.coverage, attachment.coverage, "unknown capture coverage must not become absence evidence");
  assert.equal(attachment.page.records[0].fields.booked, false, "does not mutate the source page");
});

test("context compaction fails closed for missing source ranges and schema-breaking inventories", () => {
  const incomplete = page();
  incomplete.page.missing_ranges.push("lead_projection_cap");
  assert.throws(() => assembleContextPage([incomplete]), /EVIDENCE_LIMIT_REACHED/);
  const oversized = page();
  oversized.allowed_followup_ids = Array.from({ length: 101 }, (_, index) => `followup-${index}`);
  assert.throws(() => assembleContextPage([oversized]), /EVIDENCE_LIMIT_REACHED/);
  assert.throws(() => assembleContextPage([]), /EVIDENCE_SCOPE_INVALID/);
});

test("summary artifacts meet transcript coverage without returning transcript text, while mixed sources are refused", () => {
  const response = summaryPage();
  assert.equal(capturedTranscriptsComplete([{ response, arguments: {} }], "call-1"), true);
  assert.equal(capturedTranscriptsComplete([{ response, arguments: {} }], null), true);
  assert.equal(capturedTranscriptsComplete([{ response, arguments: {} }], "different-call"), false);
  const conflicting = structuredClone(response);
  conflicting.transcript!.source_snapshot_id = "different-source";
  assert.equal(capturedTranscriptsComplete([{ response, arguments: {} }, { response: conflicting, arguments: {} }], "call-1"), false);
});

test("step accounting uses reported Gateway cost and does not label missing tokens complete", () => {
  const usage: Parameters<typeof measuredCents>[0] = {
    inputTokens: 10_000, outputTokens: 2_000, totalTokens: 12_000,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  };
  const pricing = { version: "synthetic", input_cents_per_million: 100, output_cents_per_million: 500 };
  assert.deepEqual(measuredCents(usage, undefined, pricing), { cents: 2, complete: true });
  assert.deepEqual(measuredCents(usage, { gateway: { cost: "0.013" } }, pricing), { cents: 2, complete: true });
  assert.deepEqual(measuredCents({ ...usage, inputTokens: undefined }, { gateway: { cost: 0.01 } }, pricing), { cents: 1, complete: false });
  assert.deepEqual(measuredCents({ ...usage, inputTokens: undefined, outputTokens: undefined }, undefined, pricing), { cents: 0, complete: false });
});
