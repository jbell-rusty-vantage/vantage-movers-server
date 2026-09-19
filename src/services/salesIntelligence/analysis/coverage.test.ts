import assert from "node:assert/strict";
import { test } from "node:test";
import { capturedTranscriptsComplete } from "./coverage";

const coverage = { known_through: null, gaps: [], capabilities: { call_log: "unknown" as const }, ai_paused: false };
const transcriptPage = (cursor: string | undefined, nextCursor: string | null, missingRanges: string[] = []) => ({
  arguments: cursor === undefined ? {} : { cursor },
  response: {
    page: { records: [], complete: missingRanges.length === 0, next_cursor: nextCursor, missing_ranges: missingRanges },
    transcript: { conversation_id: "conversation-1", transcript_version: "version-1", source_snapshot_id: "snapshot-1", segments: [] },
    coverage, allowed_followup_ids: [], instructions: [], speaker_refs: [],
  },
});

test("number analysis cannot publish from record-only captured evidence", () => {
  const recordOnly = { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] },
    coverage, allowed_followup_ids: [], instructions: [], speaker_refs: [] };
  assert.equal(capturedTranscriptsComplete([{ response: recordOnly, arguments: {} }], null), false);
});

test("validates every captured page in a transcript cursor chain", () => {
  const first = transcriptPage(undefined, "page-2", ["segments_after:100"]);
  const second = transcriptPage("page-2", "page-3", ["segments_before:100", "segments_after:200"]);
  const final = transcriptPage("page-3", null, ["segments_before:200"]);
  const cases = [
    { name: "accepts a complete multi-page transcript", pages: [first, second, final], expected: true },
    { name: "rejects a missing middle page", pages: [first, final], expected: false },
    { name: "rejects a missing final page", pages: [first, second], expected: false },
    { name: "rejects a repeated request cursor", pages: [first, transcriptPage("page-2", null, ["segments_before:100"]), transcriptPage("page-2", null, ["segments_before:100"])], expected: false },
    { name: "accepts a partial final page with legitimate segment coverage metadata", pages: [
      transcriptPage(undefined, "page-2", ["segments_after:100"]),
      transcriptPage("page-2", null, ["segments_before:100"]),
    ], expected: true },
  ];

  for (const scenario of cases) {
    assert.equal(capturedTranscriptsComplete(scenario.pages, "conversation-1"), scenario.expected, scenario.name);
  }
});
