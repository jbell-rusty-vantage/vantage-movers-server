import assert from "node:assert/strict";
import { test } from "node:test";
import { capturedTranscriptsComplete } from "./coverage";

test("number analysis cannot publish from record-only captured evidence", () => {
  const recordOnly = { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] },
    coverage: { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false }, allowed_followup_ids: [], instructions: [], speaker_refs: [] };
  assert.equal(capturedTranscriptsComplete([{ response: recordOnly, arguments: {} }], null), false);
});
