import { redactTranscript } from "../../conversations/redaction";
import type { SttResult } from "../../conversations/transcriptionProvider";

export type TranscriptSegment = { sid: number; start_ms: number | null; end_ms: number | null; timing_source: "provider" | "unavailable"; speaker: "rep" | "customer" | "unknown"; text: string };
export class EmptyTranscriptionError extends Error {
  constructor() { super("empty_transcription"); }
}

/** Only redacted text leaves this function. Text-only STT has no invented audio positions. */
export function prepareTranscript(result: SttResult) {
  let redactions = 0;
  const redact = (text: string) => { const result = redactTranscript(text); redactions += result.redactions; return result.text; };
  const segments: TranscriptSegment[] = [];
  if (result.segments?.length) {
    const joined = result.segments.map(s => s.text).join(" ");
    const masks: Array<{ start: number; end: number; token: string }> = [];
    // A provider boundary is not a privacy boundary. Mask every occurrence of detected content,
    // including each fragment of a value split over two segments, retaining genuine timing.
    const whole = redactTranscript(joined, (value, token) => {
      for (let from = 0; from < joined.length;) {
        const start = joined.indexOf(value, from);
        if (start < 0) break;
        masks.push({ start, end: start + value.length, token });
        from = start + value.length;
      }
    });
    redactions += whole.redactions;
    let offset = 0;
    for (const segment of result.segments) {
      const end = offset + segment.text.length;
      let text = "", cursor = offset;
      for (const mask of masks.filter(m => m.start < end && m.end > offset).sort((a, b) => a.start - b.start || b.end - a.end)) {
        const start = Math.max(offset, mask.start), stop = Math.min(end, mask.end);
        if (stop <= cursor) continue;
        text += joined.slice(cursor, Math.max(cursor, start)) + mask.token;
        cursor = stop;
      }
      text += joined.slice(cursor, end);
      offset = end + 1;
      // Run the existing redactor on every sentence, even with provider segmentation.
      text = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)].map(s => redact(s.segment)).join("").trim();
      if (!text) continue;
      const validTime = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
      let start = validTime(segment.start_ms), endTime = validTime(segment.end_ms);
      if (start !== null && endTime !== null && endTime < start) { start = null; endTime = null; }
      const timed = start !== null || endTime !== null;
      segments.push({ sid: segments.length + 1, text,
        start_ms: start, end_ms: endTime,
        timing_source: timed ? "provider" : "unavailable", speaker: segment.speaker ?? "unknown" });
    }
  } else {
    // Redact before sentence splitting too: punctuation in a spoken digit run cannot evade masking.
    const text = redact(result.text);
    for (const sentence of new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)) {
      const redacted = redact(sentence.segment).trim();
      if (redacted) segments.push({ sid: segments.length + 1, text: redacted, start_ms: null, end_ms: null, timing_source: "unavailable", speaker: "unknown" });
    }
  }
  if (!segments.length) throw new EmptyTranscriptionError();
  return { text: segments.map(s => s.text).join(" "), segments, redactions };
}

export function transcriptionEstimate(duration: number | null | undefined, rate: number): number | null {
  if (duration == null || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(rate) || rate <= 0) return null;
  const cents = Math.ceil(duration * rate);
  return Number.isSafeInteger(cents) ? cents : null;
}
export const transcriptVersion = (digest: string) => `csi-transcript-v1:${digest}`;
