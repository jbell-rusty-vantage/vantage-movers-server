import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareTranscript, transcriptionEstimate } from "./transcript";

test("text-only transcript retains unknown speakers and unavailable timing", () => {
  const result = prepareTranscript({ text: "Hello there. We can move Tuesday.", actualCents: 1 });
  assert.deepEqual(result.segments.map(s => [s.sid, s.start_ms, s.end_ms, s.timing_source, s.speaker]), [[1, null, null, "unavailable", "unknown"], [2, null, null, "unavailable", "unknown"]]);
});
test("provider timing and actual speaker survive cross-boundary payment redaction", () => {
  const result = prepareTranscript({ text: "ignored raw cache", actualCents: 2, segments: [
    { text: "Card 4111 1111", start_ms: 125, end_ms: 1000, speaker: "customer" },
    { text: "1111 1111. one two three", start_ms: 1500, end_ms: 2000 },
    { text: "four five six seven. CVV 123", start_ms: 2100, end_ms: 3000 },
  ] });
  assert.doesNotMatch(result.text, /4111|1111|one two|four five|123/);
  assert.deepEqual(result.segments.map(s => [s.start_ms, s.end_ms]), [[125, 1000], [1500, 2000], [2100, 3000]]);
  assert.equal(result.segments[0]?.speaker, "customer");
  assert.equal(result.segments[1]?.speaker, "unknown");
  assert.equal(result.redactions, 3);
});
test("invalid provider timing is unavailable; pricing is configured and rounded to integer cents", () => {
  const result = prepareTranscript({ text: "", actualCents: 1, segments: [{ text: "Hello.", start_ms: 9, end_ms: 3 }] });
  assert.equal(result.segments[0]?.start_ms, null);
  assert.equal(result.segments[0]?.timing_source, "unavailable");
  const partial = prepareTranscript({ text: "", actualCents: 1, segments: [{ text: "Hello.", start_ms: 12 }] });
  assert.equal(partial.segments[0]?.start_ms, 12); assert.equal(partial.segments[0]?.end_ms, null);
  assert.equal(partial.segments[0]?.timing_source, "provider");
  assert.equal(transcriptionEstimate(90, .005), 1);
  assert.equal(transcriptionEstimate(null, .005), null);
  assert.equal(transcriptionEstimate(90, NaN), null);
});
