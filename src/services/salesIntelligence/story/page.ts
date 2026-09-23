import { redactTranscript } from "../../conversations/redaction";
import { readContentSchema, type ReadContent } from "../analysis/reads";
import type { EvidenceRecord } from "../analysis/contracts";
import type { CoverageDto } from "../dto";
import type { GranotLeadState, LeadCandidate, StoryEvent, SubjectStory } from "./types";

/**
 * The story as a context page (context provenance specification §5.1): one `story_event` record
 * per event, one `granot_state` per Lead, one `lead` per candidate, plus the prose block. Every
 * string is redacted and bounded; `body` keys never survive (Lead Message bodies are not story).
 */
const FIELD_MAX = 4000;
const RECORDS_MAX = 200;

const clip = (value: string) => (value.length > FIELD_MAX ? `${value.slice(0, FIELD_MAX - 1)}…` : value);
const str = (value: unknown): string | null => (typeof value === "string" ? clip(redactTranscript(value).text) : value === null || value === undefined ? null : clip(redactTranscript(String(value)).text));
const stripBodies = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripBodies);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "body").map(([key, v]) => [key, stripBodies(v)]));
  return value;
};
const detailsText = (value: unknown): string => {
  const redacted = redactTranscript(JSON.stringify(stripBodies(value) ?? null)).text;
  return redacted.length > FIELD_MAX ? `${redacted.slice(0, 3980)}…[truncated]` : redacted;
};

const STATUS_PATHS = ["state", "status", "result", "provider_result", "disposition", "review_state", "work_status"] as const;
function eventStatus(event: StoryEvent): string | null {
  for (const path of STATUS_PATHS) { const value = event.detail[path]; if (typeof value === "string" && value) return str(value); }
  if (event.kind === "quoted_changed") return event.detail.quoted === false ? "unquoted" : "quoted";
  if (event.kind === "call") return event.detail.provider_connected ? "connected" : "not_connected";
  return null;
}
const leadIdOf = (event: StoryEvent): string | null => {
  const ref = event.detail.lead_ref as { id?: unknown } | null | undefined;
  if (ref && typeof ref === "object" && ref.id) return String(ref.id);
  const match = /^lead:(?:FormLead|CallLead):([a-f0-9]{24})$/.exec(event.subject_key);
  return match ? match[1]! : null;
};

export function storyEventRecord(event: StoryEvent): EvidenceRecord {
  const conversation = typeof event.detail.conversation_id === "string" ? event.detail.conversation_id : null;
  return { record_type: "story_event", record_id: event.record.record_id, revision: null, fields: {
    kind: event.kind, happened_at: event.happened_at, occurred_at: event.happened_at, actor: event.actor.kind, agent_id: event.actor.agent_id,
    agent_name: str(event.actor.name), description: str(event.sentence), ...(conversation ? { conversation_id: conversation } : {}),
    ...(leadIdOf(event) ? { lead_id: leadIdOf(event) } : {}), status: eventStatus(event), details: detailsText(event.detail) } };
}

const money = (value: string | null) => (value ? `$${value.replace(/^\$/, "")}` : null);
export function granotStateRecord(state: GranotLeadState): EvidenceRecord {
  const parts = [`Priority ${state.granot_priority ?? "not set"} (${state.priority_label})`, ...(state.money.estimate ? [`estimate ${money(state.money.estimate)}`] : []),
    ...(state.money.payment ? [`payment ${money(state.money.payment)}`] : []), ...(state.money.balance ? [`balance ${money(state.money.balance)}`] : []),
    ...(state.booking_action ? [`booking action ${state.booking_action}`] : []), ...(state.quoted ? ["quoted"] : []), ...(state.booked ? ["booked"] : []), ...(state.cancelled ? ["cancelled"] : [])];
  return { record_type: "granot_state", record_id: `${state.lead_ref.model}:${state.lead_ref.id}`, revision: null, fields: {
    model: state.lead_ref.model, lead_id: state.lead_ref.id, job_no: str(state.job_no), granot_priority: state.granot_priority, priority_label: state.priority_label, status: state.disposition,
    quoted: state.quoted, booked: state.booked, cancelled: state.cancelled, duplicate: state.duplicate, bad_lead: state.bad_lead, no_sync: state.no_sync, agent_name: str(state.receiver_agent_name),
    estimate: str(state.money.estimate), payment: str(state.money.payment), balance: str(state.money.balance), pickup: str(state.move.pickup), delivery: str(state.move.delivery),
    move_date: state.move.move_date, move_size: state.move.move_size ?? state.move.granot_move_size, occurred_at: state.observation?.captured_at ?? null,
    description: clip(redactTranscript(parts.join(", ")).text), details: detailsText(state) } };
}

export function candidateRecord(candidate: LeadCandidate): EvidenceRecord {
  return { record_type: "lead", record_id: candidate.lead_ref.id, revision: null, fields: {
    model: candidate.lead_ref.model, name: str(candidate.name), job_no: str(candidate.job_no), source: str(candidate.source_company_label), received_at: candidate.received_at,
    booked: candidate.booked, cancelled: candidate.cancelled, duplicate: candidate.duplicate, bad_lead: candidate.bad_lead,
    certainty: `candidate:${candidate.basis.join("|")}`, status: "not_attached" } };
}

/**
 * `assembleContextPage` is not used here: the page is bounded by the story itself, so missing
 * ranges name the truncated sources. Records stay ≤ 200 by dropping candidates, then Granot
 * states; the story events already carry the model-page bound.
 */
export function storyToReadContent(story: SubjectStory, coverage: CoverageDto): ReadContent {
  const events = story.events.map(storyEventRecord);
  const granot = story.granot.map(granotStateRecord);
  const candidates = story.candidates.map(candidateRecord);
  const room = Math.max(0, RECORDS_MAX - events.length);
  const keptGranot = granot.slice(0, room);
  const keptCandidates = candidates.slice(0, Math.max(0, room - keptGranot.length));
  const truncated = Object.entries(story.coverage.sources).filter(([, s]) => s.truncated).map(([name]) => `story_truncated:${name}`);
  const result: ReadContent = {
    page: { records: [...events, ...keptGranot, ...keptCandidates], next_cursor: null, complete: true,
      missing_ranges: [...truncated, ...(granot.length > keptGranot.length ? ["story_granot_overflow"] : []), ...(candidates.length > keptCandidates.length ? ["story_candidates_overflow"] : [])].slice(0, 100) },
    story: { as_of: story.as_of, opening: clip(story.opening), prose: story.prose.length > 60_000 ? story.prose.slice(0, 60_000) : story.prose, tail: clip(story.tail),
      // `storyBlockSchema` bounds: 60 candidates, 100 Granot states; the records above carry the same overflow markers.
      coverage: JSON.parse(JSON.stringify(story.coverage)), candidates: story.candidates.slice(0, 60).map(c => JSON.parse(JSON.stringify(c))),
      granot: story.granot.slice(0, 100).map(g => JSON.parse(JSON.stringify(stripBodies(g)))), digest: story.digest },
    coverage, allowed_followup_ids: [], instructions: [], speaker_refs: [],
  };
  return readContentSchema.parse(result);
}
