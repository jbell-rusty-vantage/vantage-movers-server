import { z } from "zod";
import { readContentSchema, type ReadContent } from "../analysis/reads";
import type { CoverageDto } from "../dto";
import { candidateRecord, granotStateRecord, storyEventRecord } from "../story/page";
import { CASE_FILE_VERSION, TRIM_STEPS, type CaseFile, type RenderedCaseFile } from "./types";

/**
 * The `case_file` run artifact (spec §4.11): one `ReadContent` page, so it lives under the same
 * retention fences, digest check and replay path as every other artifact, with no change to
 * `readContentSchema` (whose digest pins the flag-off `context` step contract).
 *
 * - `page.records`: the Case File's `story_event` records in T order (index = Tn), then each attached
 *   Lead's `granot_state` (last known values) and the candidate Leads — the citation anchors.
 * - `story`: `opening` = the header line, `tail` = the timeline tail, and `coverage.case_file` = the
 *   rendered text plus what the prompt and `step_artifacts.case_file` need (sizes, trims, digests,
 *   the C and F numbering). Replay and retry restore the text from here verbatim.
 */
const RECORDS_MAX = 200;
const RESPONSE_SOFT_BYTES = 450_000;
export const caseFileArtifactSchema = z.object({
  layout: z.literal("case_file"), version: z.string(), audience: z.enum(["findings", "assessment"]),
  text: z.string(), bytes: z.number().int().nonnegative(), digest: z.string(), customer_evidence_digest: z.string(),
  trimmed_steps: z.array(z.object({ step: z.enum(TRIM_STEPS), count: z.number().int().positive() }).strict()), over_hard_budget: z.boolean(),
  call_conversation_ids: z.array(z.string()), prior_finding_ids: z.array(z.string()), followup_ids: z.array(z.string()),
  story_events: z.number().int().nonnegative(), timeline_dropped: z.number().int().nonnegative(), truncated_sources: z.array(z.string()),
}).strict();
export type CaseFileArtifact = z.infer<typeof caseFileArtifactSchema>;

export function caseFileToReadContent(file: CaseFile, rendered: RenderedCaseFile, coverage: CoverageDto): ReadContent {
  const events = file.story_events.map(storyEventRecord);
  const granot = file.granot_states.map(granotStateRecord);
  const candidates = file.candidates.map(candidateRecord);
  const room = Math.max(0, RECORDS_MAX - events.length);
  const keptGranot = granot.slice(0, room), keptCandidates = candidates.slice(0, Math.max(0, room - keptGranot.length));
  const artifact: CaseFileArtifact = { layout: "case_file", version: CASE_FILE_VERSION, audience: file.audience, text: rendered.text, bytes: rendered.bytes, digest: rendered.digest,
    customer_evidence_digest: rendered.customer_evidence_digest, trimmed_steps: rendered.trimmed_steps, over_hard_budget: rendered.over_hard_budget,
    call_conversation_ids: file.call_conversation_ids, prior_finding_ids: file.prior_finding_ids, followup_ids: file.followup_ids, story_events: file.story_events.length,
    timeline_dropped: file.coverage.timeline_dropped, truncated_sources: file.coverage.truncated_sources };
  const build = (records: ReadContent["page"]["records"]): ReadContent => readContentSchema.parse({
    page: { records, next_cursor: null, complete: true, missing_ranges: [...file.coverage.truncated_sources.map(s => `case_file_truncated:${s}`),
      ...(granot.length > keptGranot.length ? ["case_file_granot_overflow"] : []), ...(candidates.length > keptCandidates.length ? ["case_file_candidates_overflow"] : [])].slice(0, 100) },
    story: { as_of: file.as_of, opening: file.header[0]!.slice(0, 4000), prose: "", tail: (file.tail ?? "").slice(0, 4000), coverage: { case_file: artifact },
      candidates: file.candidates.slice(0, 60).map(c => JSON.parse(JSON.stringify(c))), granot: file.granot_states.slice(0, 100).map(g => JSON.parse(JSON.stringify(g))), digest: rendered.digest },
    coverage, allowed_followup_ids: [], instructions: [], speaker_refs: [] });
  const page = build([...events, ...keptGranot, ...keptCandidates]);
  if (Buffer.byteLength(JSON.stringify(page)) <= RESPONSE_SOFT_BYTES) return page;
  // A very busy Number: the event details (redacted JSON) are the bulk; the rendered text already carries every fact.
  return build([...events.map(record => ({ ...record, fields: { ...record.fields, details: null } })), ...keptGranot, ...keptCandidates]);
}

/** The Case File recorded on a run artifact, or null when the page is not a Case File page. */
export function caseFileFromReadContent(data: ReadContent): CaseFileArtifact | null {
  const parsed = caseFileArtifactSchema.safeParse((data.story?.coverage as { case_file?: unknown } | undefined)?.case_file);
  return parsed.success ? parsed.data : null;
}
