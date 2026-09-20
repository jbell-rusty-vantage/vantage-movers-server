import assert from "node:assert/strict";
import { test } from "node:test";
import { intelligenceCitationInventory, renderIntelligenceEvidencePrompt, type CapturedPromptPage } from "./prompt";

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
  assert.deepEqual(inventory[0].records, [{ record_type: "lead", record_id: "lead-1", field_paths: ["status", "booked"] }]);
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
});
