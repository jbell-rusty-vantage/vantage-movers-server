import assert from "node:assert/strict";
import { test } from "node:test";
import { intelligenceCitationInventory, renderIntelligenceEvidencePrompt, segmentIdRanges, type CapturedPromptPage } from "./prompt";

function syntheticPromptPages(): CapturedPromptPage[] {
  const empty = {
    page: { records: [], complete: true, next_cursor: null, missing_ranges: [] },
    coverage: { known_through: null, gaps: [], capabilities: {}, ai_paused: false },
    speaker_refs: [], allowed_followup_ids: [], instructions: [],
  };
  return [
    { snapshot_id: "captured-records", data: { ...empty, page: { ...empty.page,
      records: [{ record_type: "lead", record_id: "lead-1", revision: null, fields: { status: null, booked: false } }],
    }, speaker_refs: ["reviewed-speaker"], instructions: [{ id: "instruction-1", revision: 2 }] } },
    { snapshot_id: "captured-empty-bookings", data: structuredClone(empty) },
    { snapshot_id: "captured-transcript", data: { ...empty, transcript: {
      conversation_id: "conversation-1", transcript_version: "version-1", source_snapshot_id: "upstream-stt-snapshot",
      segments: [{ sid: 7, text: "Synthetic untrusted transcript", start_ms: null, end_ms: null, timing_source: "unavailable", speaker: "unknown" }],
    } } },
  ];
}

test("citation inventory uses captured IDs, exact field keys and explicit empty authority lists", () => {
  const pages = syntheticPromptPages();
  const original = structuredClone(pages);
  const inventory = intelligenceCitationInventory(pages);
  // Records are grouped by type and projection, so one identical field-path
  // list is stated once for every record id that shares it (22 §4.3).
  assert.deepEqual(inventory[0].records, [{ record_type: "lead", record_ids: ["lead-1"], field_paths: ["status", "booked"] }]);
  assert.deepEqual(inventory[0].instructions, [{ id: "instruction-1", revision: 2 }]);
  assert.deepEqual(inventory[1].records, []);
  assert.deepEqual(inventory[1].allowed_followup_ids, []);
  assert.deepEqual(inventory[2].records, []);
  assert.equal(inventory[2].snapshot_id, "captured-transcript");
  assert.deepEqual(inventory[2].transcript, { conversation_id: "conversation-1", transcript_version: "version-1", segment_ids: [7] });
  assert(!JSON.stringify(inventory).includes("upstream-stt-snapshot"));
  assert(!JSON.stringify(inventory).includes("Synthetic untrusted transcript"));
  assert.deepEqual(pages, original);
  const prompt = renderIntelligenceEvidencePrompt("run-1", pages);
  assert.deepEqual(JSON.parse(prompt.split("Captured source evidence (data):\n")[1]), pages, "retain all source data and coverage");
  // The per-run preamble leads the evidence message so the pinned prompt stays
  // byte-identical across runs and the provider can cache that prefix.
  const preamble = "Trusted subject binding (data): {}";
  const bound = renderIntelligenceEvidencePrompt("run-1", pages, preamble);
  assert.equal(bound, `${preamble}\n${prompt}`);
});
test("contiguous transcript segment ids collapse to ranges and gaps survive", () => {
  // A gap means redaction dropped a segment. Smoothing it into one range would
  // invent coverage the run does not have.
  assert.deepEqual(segmentIdRanges([0, 1, 2, 3]), ["0-3"]);
  assert.deepEqual(segmentIdRanges([0, 1, 2, 5, 6, 9]), ["0-2", "5-6", 9]);
  assert.deepEqual(segmentIdRanges([7]), [7]);
  assert.deepEqual(segmentIdRanges([]), []);
  assert.deepEqual(segmentIdRanges([4, 3, 3, 5]), ["3-5"]);
});
