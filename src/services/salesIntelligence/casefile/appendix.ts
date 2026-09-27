import type { EvidenceRecord } from "../analysis/contracts";
import type { ReadContent } from "../analysis/reads";
import type { SummaryStep } from "../analysis/structuredContract";
import { handleIndex, type CitationHandleTable } from "../analysis/citationHandles";

/**
 * The findings user message's JSON appendix (spec §4.9): only what citation needs. Summary text is
 * not repeated here (it is in the Case File); `calls[]` keeps each call's `said_on_call` segment ids
 * for transcript citations, `context` is the unchanged context page minus the `job_timeline`
 * records that duplicate prior findings (§4.6, V10; `reads.ts` stays unchanged for the MCP tools),
 * and the T / P numbering resolves to `story_event_ids` / `prior_finding_ids`.
 */
export type AppendixCall = { call_index: number; segments_available: boolean;
  said_on_call: Array<{ kind: string; claim: string; speaker: string; action_status: string | null; segment_ids: number[] }> };
export type FindingsAppendix = {
  calls: AppendixCall[];
  context: { records: ReadContent["page"]["records"]; coverage: ReadContent["coverage"]; allowed_followup_ids: string[] };
  story_event_ids: string[];
  prior_finding_ids: string[];
};
/**
 * Handles mode (citation handles spec §4.2): each context record is `{ ref, record, fields }` with no
 * `record_id` (server metadata, like `snapshot_id`); `story_event` / `prior_finding` records are not
 * repeated (they are cited as T / P); the id lists are gone because the T / P numbers are the citations.
 */
export type HandleAppendixRecord = { ref: string; record: ReadContent["page"]["records"][number]["record_type"]; fields: ReadContent["page"]["records"][number]["fields"] };
export type FindingsAppendixHandles = {
  calls: AppendixCall[];
  context: { records: HandleAppendixRecord[]; coverage: ReadContent["coverage"]; allowed_followup_ids: string[] };
};

/** `reads.ts` `context()` writes each prior finding as a `job_timeline` record whose details carry the finding shape. */
export function isPriorFindingTimelineRecord(record: EvidenceRecord): boolean {
  if (record.record_type !== "job_timeline" || typeof record.fields.details !== "string") return false;
  try {
    const details = JSON.parse(record.fields.details) as Record<string, unknown>;
    return details !== null && typeof details === "object" && "kind" in details && "value" in details && "evidence" in details && "run_id" in details;
  } catch {
    // An oversized detail is truncated with a marker (`reads.ts` `detailsText`); its prefix still names the finding shape.
    return /^\{"kind":"[a-z_]+","value":/.test(record.fields.details);
  }
}

/** The records `appendix.context.records` shows, in order: the context page minus prior-finding timeline rows. R handles number these. */
export const appendixContextRecords = (context: ReadContent) => context.page.records.filter(r => !isPriorFindingTimelineRecord(r));

export function findingsAppendix(input: { calls: ReadonlyArray<{ summary: SummaryStep; segments_available: boolean } | null>; context: ReadContent;
  story_event_ids: readonly string[]; prior_finding_ids: readonly string[] }): FindingsAppendix {
  return {
    calls: input.calls.map((call, call_index) => ({ call_index, segments_available: Boolean(call?.segments_available),
      said_on_call: call?.segments_available ? call.summary.said_on_call.map(f => ({ kind: f.kind, claim: f.claim, speaker: f.speaker, action_status: f.action_status, segment_ids: [...f.segment_ids] })) : [] })),
    context: { records: appendixContextRecords(input.context), coverage: input.context.coverage, allowed_followup_ids: [...input.context.allowed_followup_ids] },
    story_event_ids: [...input.story_event_ids],
    prior_finding_ids: [...input.prior_finding_ids],
  };
}

/** The handles-mode appendix; `calls` and `context.coverage` / `allowed_followup_ids` are exactly the id-mode ones. */
export function findingsAppendixHandles(input: Omit<Parameters<typeof findingsAppendix>[0], "story_event_ids" | "prior_finding_ids">, table: CitationHandleTable): FindingsAppendixHandles {
  const { calls, context } = findingsAppendix({ ...input, story_event_ids: [], prior_finding_ids: [] });
  const { refOf } = handleIndex(table);
  return { calls, context: { ...context, records: context.records.flatMap(record => {
    const ref = refOf(record.record_type, record.record_id);
    return ref ? [{ ref, record: record.record_type, fields: record.fields }] : [];
  }) } };
}
