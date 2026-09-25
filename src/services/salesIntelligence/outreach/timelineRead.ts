import mongoose from "mongoose";
import { z } from "zod";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { toObjectId } from "../../../utils/objectId";
import { csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { ownerRead } from "../../numberActivity/coverage";
import {
  TIMELINE_V2_CHIPS,
  timelineV2PageDtoSchema,
  type TimelineV2EventDto,
  type TimelineV2PageDto,
} from "../../numberActivity/dto";
import { decodeTimelineCursor, encodeTimelineCursor } from "../../numberActivity/timeline";
import type { CoverageDto } from "../dto";
import { customerLabel } from "../story/assemble";
import { renderTimelineSentence, renderTimelineTitle, type RenderContext } from "../story/prose";
import { getOutreachBandTransitionModel } from "../../../models/salesIntelligence/outreach";
import { overviewEnabled, type BandTransitionRow } from "./bandTransitions";
import {
  compareTimelineOrder,
  isAfterStoryCursor,
  keysetScan,
  readLeadRows,
  STORY_SOURCES,
  subjectKeysFor,
  TIMELINE_KINDS,
  TIMELINE_LEAD_FANOUT,
  TIMELINE_SOURCE_BY_KIND,
  timelineKindOrder,
  type LeadRow,
  type SourceResult,
  type StoryRecordRow,
  type TimelineReadContext,
} from "../story/sources";
import type { StoryEvent, StoryLeadRef, StorySubject } from "../story/types";
import { CLOSURE_CANCEL_REASONS } from "../analysis/sources";
import { SUPERSEDED_BY_SPECIFIC_PLAN } from "./store";
import { REACHED_ON_CLASSIFICATION } from "./ensure";

/**
 * Owner timeline v2 (data spec §5; final spec §10): `GET /outreach/:id/timeline` and the
 * extended `GET /numbers/:id/timeline`, served behind `SALES_INTELLIGENCE_TIMELINE_V2`.
 *
 * 1. Resolve the subject once (§5.1, D5): the Outreach record or the Number, its Leads (attached
 *    first, ≤ 100), its records and conversation keys, and the Lead rows of the first 20 Leads.
 * 2. Fan the existing story readers out in one `Promise.all` in timeline mode (exclusive keyset,
 *    slack, reader fixes, `kinds` filter before the bound). A `kinds[]` filter runs only the
 *    readers that emit those kinds (the Calls tab is `kinds[]=call`: one reader).
 * 3. Merge on `(happened_at desc, kind_order asc, id desc)` with `(kind, id)` dedupe; the cursor is
 *    the last emitted event `{happened_at, kind, id}` (same encoding as v1).
 * 4. Adapt each `StoryEvent` to the DTO with the §10.2 title and the model's own sentence.
 *
 * Read only. Every state the Owner sees (`recorded_late`, `routine`, chips, `job_no`) is computed
 * here against the response `as_of`.
 */
const DEFAULT_LIMIT = 50;
/**
 * S9-PUBLISH (addendum §6.3, T3-S9-INTERFACE §7; SALES_INTELLIGENCE_OVERVIEW): a band change from `outreach_band_transitions`.
 * Emitted only by this reader (never on the model's page or the Case File); its `kind_order` is the unknown-kind order.
 */
export const BAND_CHANGED = "band_changed";
/** Routine (under Processing details) unless a call, a recovered call or an Owner action moved the band. */
const BAND_ATTENTION_CAUSES = new Set(["call", "capture_repair", "owner"]);
const BAND_CAUSE_TEXT: Readonly<Record<string, string>> = {
  call: "a call", capture_repair: "a call recovered by a capture repair", lead_progress: "Lead progress in Granot", followup: "a follow-up change",
  owner: "an Owner action", clock: "time passing", booking: "an official Booking or closure", policy: "a policy or settings change",
};
const bandName = (band: unknown) => (typeof band === "number" ? `band ${band}` : "no band");
const MAX_LIMIT = 200;
const SUBJECT_CAP = 100;
const HOUR_MS = 60 * 60 * 1000;
const TIMEZONE = "America/New_York";
const oid = toObjectId;

const kindsInput = z.union([z.string().max(2000), z.array(z.string().max(80)).max(64)]).optional();
/** Query of both v2 routes. `kinds[]=call&kinds[]=…`, `kinds=call,…` and repeated `kinds` all parse. */
export const timelineV2QuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    kinds: kindsInput,
    "kinds[]": kindsInput,
  })
  .strict()
  .transform(({ cursor, limit, kinds, "kinds[]": bracketed }) => {
    const list = [kinds, bracketed].flatMap(v => (v === undefined ? [] : Array.isArray(v) ? v : [v])).flatMap(v => v.split(",")).map(v => v.trim()).filter(Boolean);
    return { cursor, limit, kinds: list.length ? [...new Set(list)] : null };
  })
  .superRefine((q, ctx) => {
    for (const kind of q.kinds ?? []) if (!TIMELINE_KINDS.includes(kind) && !(kind === BAND_CHANGED && overviewEnabled())) ctx.addIssue({ code: "custom", message: `unknown timeline kind ${kind}`, path: ["kinds"] });
  });
export type TimelineV2Query = z.infer<typeof timelineV2QuerySchema>;

/**
 * V-T3 M8 (S8-REP): Owner-only kinds a rep's timeline never carries: Owner→rep nudges (Messages, blanked on the
 * rep's detail too) and Owner notes. Restriction events stay: a rep must see do-not-call.
 */
export const REP_HIDDEN_TIMELINE_KINDS: readonly string[] = ["nudge_sent", "owner_note"];
/** `audience: "rep"` drops `REP_HIDDEN_TIMELINE_KINDS` inside every reader's accept (before the bound), so paging stays exact. */
export type TimelineReadOptions = { cursor?: string; limit?: number; kinds?: readonly string[] | null; audience?: "owner" | "rep" };
export type TimelineReadDeps = { now?: () => Date; coverage?: CoverageDto };

type Edge = { lead_ref: { model: "FormLead" | "CallLead"; id: unknown }; state: string };
type Resolved = {
  scope: "outreach" | "number";
  number_id: string | null;
  outreach_id: string | null;
  subject: StorySubject;
  records: StoryRecordRow[];
  attached: StoryLeadRef[];
  leads: LeadRow[];
  provider_names: string[];
  /** Resolution caps that were hit (a set larger than `SUBJECT_CAP`). */
  capped: string[];
};

const EDGE_ORDER: Record<string, number> = { attached: 0, ambiguous: 1, candidate: 2 };
const sameRef = (a: StoryLeadRef, b: StoryLeadRef) => a.model === b.model && a.id === b.id;
const uniqueRefs = (refs: StoryLeadRef[]) => refs.filter((ref, index, all) => all.findIndex(r => sameRef(r, ref)) === index);
const edgeRefs = (edges: Edge[]) => [...edges]
  .map(e => ({ ref: { model: e.lead_ref.model, id: String(e.lead_ref.id) } as StoryLeadRef, state: e.state }))
  .sort((a, b) => (EDGE_ORDER[a.state] ?? 9) - (EDGE_ORDER[b.state] ?? 9) || a.ref.id.localeCompare(b.ref.id));

async function readNumberRow(id: string | null) {
  if (!id || !mongoose.isValidObjectId(id)) return null;
  return getContactNumberModel().findOne({ _id: oid(id), purged_at: null }).select("e164 provider_names").lean();
}
const conversationIds = (filter: Record<string, unknown>, as_of: Date) =>
  getLeadConversationModel().find({ ...filter, started_at: { $lte: as_of } }).select("_id").sort({ started_at: -1, _id: -1 }).limit(SUBJECT_CAP + 1).lean();

/** Scope `number`: the Number, its non-rejected edges, its records and its conversation keys (one parallel round), then the Leads. */
async function resolveNumber(numberId: string, as_of: Date): Promise<Resolved | null> {
  if (!csiIdSchema.safeParse(numberId).success) return null;
  const id = oid(numberId);
  const [number, edges, records, conversations] = await Promise.all([
    readNumberRow(numberId),
    getNumberLeadAttachmentModel().find({ contact_number_id: id, state: { $ne: "rejected" } }).select("lead_ref state").sort({ _id: 1 }).limit(SUBJECT_CAP + 1).lean(),
    getOutreachRecordModel().find({ primary_contact_number_id: id }).select("subject move_assessment").sort({ _id: 1 }).limit(SUBJECT_CAP + 1).lean(),
    conversationIds({ contact_number_id: id }, as_of),
  ]);
  if (!number) return null;
  const ordered = edgeRefs((edges as unknown as Edge[]).slice(0, SUBJECT_CAP));
  const lead_refs = uniqueRefs(ordered.map(e => e.ref));
  const leads = await readLeadRows(lead_refs.slice(0, TIMELINE_LEAD_FANOUT));
  return {
    scope: "number", number_id: numberId, outreach_id: null,
    subject: { contact_number_id: numberId, e164: number.e164, lead_refs, outreach_record_ids: records.slice(0, SUBJECT_CAP).map(r => String(r._id)),
      conversation_ids: conversations.slice(0, SUBJECT_CAP).map(c => String(c._id)), as_of, focus: null },
    records: records.slice(0, SUBJECT_CAP) as unknown as StoryRecordRow[], attached: ordered.filter(e => e.state === "attached").map(e => e.ref), leads,
    provider_names: [...(number.provider_names ?? [])],
    capped: [...(edges.length > SUBJECT_CAP ? ["attachments"] : []), ...(records.length > SUBJECT_CAP ? ["followups"] : []), ...(conversations.length > SUBJECT_CAP ? ["conversation_keys"] : [])],
  };
}

/** Scope `outreach`: the record, then its Number, Lead row and conversation keys in one parallel round. */
async function resolveOutreach(outreachId: string, as_of: Date): Promise<Resolved | null> {
  if (!csiIdSchema.safeParse(outreachId).success) return null;
  const record = await getOutreachRecordModel().findOne({ _id: oid(outreachId) }).select("subject primary_contact_number_id move_assessment").lean();
  if (!record) return null;
  const subjectRow = record.subject as { kind: "lead" | "number"; model?: "FormLead" | "CallLead" | null; id?: unknown; contact_number_id?: unknown };
  const lead: StoryLeadRef | null = subjectRow.kind === "lead" && subjectRow.model && subjectRow.id ? { model: subjectRow.model, id: String(subjectRow.id) } : null;
  const numberRef = record.primary_contact_number_id ?? (subjectRow.kind === "number" ? subjectRow.contact_number_id : null);
  const numberId = numberRef ? String(numberRef) : null;
  const [number, leads, byNumber, byLead] = await Promise.all([
    readNumberRow(numberId),
    lead ? readLeadRows([lead]) : Promise.resolve([] as LeadRow[]),
    numberId && mongoose.isValidObjectId(numberId) ? conversationIds({ contact_number_id: oid(numberId) }, as_of) : Promise.resolve([]),
    lead && mongoose.isValidObjectId(lead.id) ? conversationIds({ "lead_ref.model": lead.model, "lead_ref.id": oid(lead.id) }, as_of) : Promise.resolve([]),
  ]);
  const conversations = [...new Set([...byNumber, ...byLead].map(c => String(c._id)))];
  return {
    scope: "outreach", number_id: number ? numberId : null, outreach_id: outreachId,
    subject: { contact_number_id: number ? numberId : null, e164: number?.e164 ?? null, lead_refs: lead ? [lead] : [], outreach_record_ids: [outreachId],
      conversation_ids: conversations.slice(0, SUBJECT_CAP), as_of, focus: null },
    records: [record as unknown as StoryRecordRow], attached: lead ? [lead] : [], leads, provider_names: [...(number?.provider_names ?? [])],
    capped: conversations.length > SUBJECT_CAP || byNumber.length > SUBJECT_CAP || byLead.length > SUBJECT_CAP ? ["conversation_keys"] : [],
  };
}

const ROUTINE_KINDS = new Set(["conversation_recorded", "granot_observed", "analysis_submitted"]);
/** Sources 1, 2, 5, 6, 8, 10, 11, 12 of data spec §5.2: prefixed `Job {n} ·` on a multi-Lead Number. */
const JOB_KINDS = new Set(["lead_received", "call_qualified", "assessment_published", "granot_priority_changed", "quoted_changed", "granot_observed", "receiver_agent_changed",
  "followup_created", "followup_completed", "followup_cancelled", "followup_superseded", "booking_recorded", "cancellation_recorded", "lead_message_sent"]);
const GROUP_BY_KIND: Readonly<Record<string, TimelineV2EventDto["group"]>> = {
  call: "calls", conversation_recorded: "calls",
  conversation_analyzed: "analysis", assessment_published: "analysis", analysis_submitted: "analysis",
  lead_received: "lead_updates", call_qualified: "lead_updates", granot_priority_changed: "lead_updates", quoted_changed: "lead_updates", granot_observed: "lead_updates",
  receiver_agent_changed: "lead_updates",
  number_attached: "lead_updates", booking_recorded: "lead_updates", cancellation_recorded: "lead_updates",
  lead_message_sent: "messages", nudge_sent: "messages",
};

type AdapterContext = {
  scope: "outreach" | "number";
  number_id: string | null;
  outreach_id: string | null;
  as_of: Date;
  render: RenderContext;
  /** Set only when the Number scope spans more than one Lead. */
  job_no_by_lead: Map<string, string | null> | null;
};

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const jsonSafe = (value: Record<string, unknown>) => JSON.parse(JSON.stringify(value)) as TimelineV2EventDto["detail"];
const leadIdOf = (e: StoryEvent): string | null => {
  const ref = e.detail.lead_ref as { id?: unknown } | null | undefined;
  if (ref && typeof ref === "object" && ref.id) return String(ref.id);
  const match = /^lead:(?:FormLead|CallLead):([a-f0-9]{24})$/.exec(e.subject_key);
  return match ? match[1]! : null;
};

/** Server-computed display rule of final spec §3.1: `Recorded {t}` only when more than an hour late. */
export function isRecordedLate(happened_at: string, observed_at: string): boolean {
  return Date.parse(observed_at) - Date.parse(happened_at) > HOUR_MS;
}

/** Chips in the final spec §10.1 order; call events only. */
export function timelineChips(e: Pick<StoryEvent, "kind" | "detail">): TimelineV2EventDto["chips"] {
  if (e.kind !== "call") return [];
  const d = e.detail;
  const chips: Array<(typeof TIMELINE_V2_CHIPS)[number]> = [];
  if (Number(d.recording_count ?? 0) > 0) chips.push("Recording");
  if (d.recording_state === "analyzed") chips.push("Analyzed");
  if (d.contact_type === "human_conversation") chips.push("Human conversation");
  if (d.contact_type === "voicemail") chips.push("Voicemail");
  return chips;
}

function conversationHref(ctx: AdapterContext, conversationId: string): string {
  return ctx.scope === "outreach" && ctx.outreach_id
    ? `/sales-intelligence/outreach/${ctx.outreach_id}?tab=analysis&conversation=${conversationId}`
    : `/sales-intelligence/numbers/${ctx.number_id}?tab=calls&conversation=${conversationId}`;
}

function timelineAction(e: StoryEvent, ctx: AdapterContext): TimelineV2EventDto["action"] {
  const d = e.detail;
  if (e.kind === "call" && str(d.analyzed_conversation_id)) return { kind: "open_conversation", href: conversationHref(ctx, str(d.analyzed_conversation_id)!) };
  if (e.kind === "conversation_analyzed" && str(d.conversation_id)) return { kind: "open_conversation", href: conversationHref(ctx, str(d.conversation_id)!) };
  if ((e.kind === "booking_recorded" || e.kind === "cancellation_recorded") && str(d.booking_id)) return { kind: "open_booking", href: `/bookings?record=${str(d.booking_id)}&database_scope=production` };
  return null;
}

function callFacts(e: StoryEvent): TimelineV2EventDto["call"] {
  if (e.kind !== "call") return null;
  const d = e.detail;
  const rep = d.rep && typeof d.rep === "object" ? d.rep as { agent_id?: unknown; name?: unknown; status?: unknown; extension?: unknown } : null;
  const state = d.recording_state === "analyzed" || d.recording_state === "recorded" ? d.recording_state : Number(d.recording_count ?? 0) > 0 ? "recorded" : "none";
  // G2: `call_log_state: null` is final unless `terminal === false`; an in-progress call has no result or duration yet.
  const terminal = d.terminal !== false;
  return {
    interaction_id: String(d.interaction_id ?? e.id.slice(e.id.indexOf(":") + 1)),
    direction: String(d.direction ?? "unknown"),
    result: terminal ? str(d.provider_result) : null,
    connected: Boolean(d.provider_connected),
    contact_type: String(d.contact_type ?? "unknown"),
    duration_seconds: terminal && typeof d.duration_seconds === "number" ? d.duration_seconds : null,
    recording_count: Math.max(0, Math.trunc(Number(d.recording_count ?? 0)) || 0),
    recording_state: state,
    conversation_id: str(d.analyzed_conversation_id) ?? str(d.conversation_id),
    rep: rep ? { agent_id: str(rep.agent_id), name: rep.status === "reviewed" ? str(rep.name) : null,
      status: rep.status === "reviewed" || rep.status === "proposed" ? rep.status : "unknown", extension: str(rep.extension) } : null,
    terminal,
    call_log_state: d.call_log_state === "provisional" || d.call_log_state === "settled" ? d.call_log_state : null,
    in_progress: !terminal,
    observed_reason: d.observed_reason === "recovered" || d.observed_reason === "late_capture" ? d.observed_reason : null,
  };
}

/** One transition row → a `band_changed` story event (timeline only). */
export function bandTransitionEvent(row: BandTransitionRow): StoryEvent {
  const id = String(row._id);
  return {
    id: `${BAND_CHANGED}:${id}`, kind: BAND_CHANGED as StoryEvent["kind"], happened_at: row.at.toISOString(), observed_at: (row.createdAt ?? row.at).toISOString(),
    subject_key: row.subject_key, actor: { kind: row.cause.kind === "owner" ? "owner" : "worker", agent_id: null, name: null, identity_status: null },
    record: { record_type: "story_event", record_id: `${BAND_CHANGED}:${id}` }, sentence: "",
    detail: { record_id: String(row.record_id), from_band: row.from_band, to_band: row.to_band, from_reason: row.from_reason, to_reason: row.to_reason,
      estimated: row.estimated, cause: { kind: row.cause.kind, event_kind: row.cause.event_kind, target_id: row.cause.target_id, audit_id: row.cause.audit_id ? String(row.cause.audit_id) : null },
      band_since: row.band_since ? { at: row.band_since.at.toISOString(), estimated: row.band_since.estimated } : null },
    evidence_refs: [`band_transition:${id}`, ...(row.cause.audit_id ? [`audit:${String(row.cause.audit_id)}`] : [])],
  };
}
function bandTitle(e: StoryEvent): string {
  const d = e.detail as { from_band?: unknown; to_band?: unknown; cause?: { kind?: string } };
  return d.cause?.kind === "baseline" ? `In ${bandName(d.to_band)} (estimated start)` : `Moved from ${bandName(d.from_band)} to ${bandName(d.to_band)}`;
}
function bandSentence(e: StoryEvent): string {
  const d = e.detail as { to_reason?: unknown; cause?: { kind?: string } };
  const reason = typeof d.to_reason === "string" ? ` (${d.to_reason.replace(/_/g, " ")})` : "";
  if (d.cause?.kind === "baseline") return `Estimated when the record entered ${bandName((e.detail as { to_band?: unknown }).to_band)}${reason}, from its history when band tracking started.`;
  return `The Attention band changed${reason} after ${BAND_CAUSE_TEXT[d.cause?.kind ?? "clock"] ?? "time passing"}.`;
}

/**
 * Timeline reader of `band_changed` (flag on): keyset on `{ record_id, at }` over the subject's records, exact under the
 * shared cursor (one event per row, `happened_at` = `at`, id order = `_id` order).
 */
async function bandTransitionSource(asOf: Date, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  if (!t.records.length) return { events: [], read: 0, truncated: false };
  const ids = t.records.map(r => r._id);
  const upper = new Date(Math.min(+asOf, t.after ? Date.parse(t.after.happened_at) : Number.POSITIVE_INFINITY));
  return keysetScan<BandTransitionRow>({
    query: (window, batch) => getOutreachBandTransitionModel().find({ record_id: { $in: ids }, ...window }).sort({ at: -1, _id: -1 }).limit(batch).lean().exec() as unknown as Promise<BandTransitionRow[]>,
    field: "at", indexed: row => row.at, toEvents: rows => rows.map(bandTransitionEvent),
    accept: e => Date.parse(e.happened_at) <= +asOf && (t.kinds === null || t.kinds.has(e.kind)) && !t.exclude?.has(e.kind) && isAfterStoryCursor(e, t.after),
    limit, upper, aheadMs: 0, tieSafe: true });
}

/** The adapter (data spec §5.2 step 4): one `StoryEvent` → one timeline v2 event DTO. Pure. */
export function storyEventToTimelineDto(e: StoryEvent, ctx: AdapterContext): TimelineV2EventDto {
  if (e.kind === (BAND_CHANGED as StoryEvent["kind"])) {
    const cause = (e.detail as { cause?: { kind?: string } }).cause?.kind ?? "clock";
    return { id: e.id, kind: e.kind, kind_order: timelineKindOrder(e.kind), group: "work", happened_at: e.happened_at, observed_at: e.observed_at,
      recorded_late: isRecordedLate(e.happened_at, e.observed_at), subject_key: e.subject_key, title: bandTitle(e), description: bandSentence(e),
      evidence_refs: [...e.evidence_refs], detail: jsonSafe(e.detail), chips: [], action: null, routine: !BAND_ATTENTION_CAUSES.has(cause), job_no: null,
      actor: { kind: e.actor.kind, agent_id: e.actor.agent_id, name: e.actor.name }, call: null };
  }
  const leadId = ctx.job_no_by_lead && JOB_KINDS.has(e.kind) ? leadIdOf(e) : null;
  const job_no = ctx.job_no_by_lead && JOB_KINDS.has(e.kind)
    ? str(e.detail.job_no) ?? (leadId ? ctx.job_no_by_lead.get(leadId) ?? null : null)
    : null;
  return {
    id: e.id,
    kind: e.kind,
    kind_order: timelineKindOrder(e.kind),
    group: GROUP_BY_KIND[e.kind] ?? "work",
    happened_at: e.happened_at,
    observed_at: e.observed_at,
    recorded_late: isRecordedLate(e.happened_at, e.observed_at),
    subject_key: e.subject_key,
    title: renderTimelineTitle(e, ctx.render, ctx.as_of),
    description: renderTimelineSentence(e, ctx.render),
    evidence_refs: [...e.evidence_refs],
    detail: jsonSafe(e.detail),
    chips: timelineChips(e),
    action: timelineAction(e, ctx),
    routine: ROUTINE_KINDS.has(e.kind),
    job_no,
    actor: { kind: e.actor.kind, agent_id: e.actor.agent_id, name: e.actor.name },
    call: callFacts(e),
  };
}

/** Pure merge (§5.3): dedupe on `(kind, id)`, total order, first `limit`; a cursor only when more remain. */
export function mergeTimelinePages(results: readonly SourceResult[], limit: number): { events: StoryEvent[]; cursor: string | null } {
  const seen = new Set<string>();
  const all: StoryEvent[] = [];
  for (const result of results) for (const e of result.events) {
    const key = `${e.kind}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(e);
  }
  all.sort(compareTimelineOrder);
  const events = all.slice(0, limit);
  const last = events[events.length - 1];
  return { events, cursor: all.length > limit && last ? encodeTimelineCursor({ happened_at: last.happened_at, kind: last.kind, id: last.id }) : null };
}

/**
 * V-T3 (M8 follow-up): a rep's timeline keeps Owner-authored events (a closure, a cancel, a snooze) but never
 * the Owner's free text. On an Owner event the note, reason and before/after values are blanked. On every event a
 * follow-up `cancel_reason` shows only when it is a machine reason (a closure, a superseding plan, a
 * classification); an Owner cancel reason (free text) is blanked. Follow-up descriptions stay: they are the rep's
 * own work items (E9). The event kind and time stay, so paging is unchanged.
 */
// Built on first use: these constants live in modules that import this one indirectly.
let machineCancelReasons: ReadonlySet<string> | null = null;
const isMachineCancelReason = (reason: string) =>
  (machineCancelReasons ??= new Set([...CLOSURE_CANCEL_REASONS, SUPERSEDED_BY_SPECIFIC_PLAN, REACHED_ON_CLASSIFICATION])).has(reason);
export function redactOwnerTextForRep<T extends { actor?: { kind?: string | null } | null; detail: Record<string, unknown> }>(event: T): T {
  const reason = event.detail.cancel_reason;
  const cancel = typeof reason === "string" && !isMachineCancelReason(reason) ? { cancel_reason: null } : {};
  if (event.actor?.kind !== "owner") return "cancel_reason" in cancel ? { ...event, detail: { ...event.detail, ...cancel } } : event;
  return { ...event, detail: { ...event.detail, ...cancel, note: null, reason: null, prior: null, current: null } };
}

async function readTimeline(resolved: Resolved, opts: TimelineReadOptions, asOf: Date, deps: TimelineReadDeps): Promise<TimelineV2PageDto> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
  const decoded = opts.cursor ? decodeTimelineCursor(opts.cursor) : null;
  const kinds = opts.kinds?.length ? [...new Set(opts.kinds)] : null;
  const { subject } = resolved;
  const ctx: TimelineReadContext = {
    scope: resolved.scope,
    after: decoded ? { happened_at: decoded.happened_at, kind_order: timelineKindOrder(decoded.kind), id: decoded.id } : null,
    kinds: kinds ? new Set(kinds) : null,
    ...(opts.audience === "rep" ? { exclude: new Set(REP_HIDDEN_TIMELINE_KINDS) } : {}),
    subject_keys: subjectKeysFor(subject, resolved.records),
    records: resolved.records,
    lead_refs: subject.lead_refs.slice(0, TIMELINE_LEAD_FANOUT),
    leads: resolved.leads,
  };
  const names = kinds ? [...new Set(kinds.filter(k => !ctx.exclude?.has(k)).map(k => TIMELINE_SOURCE_BY_KIND[k]).filter((n): n is string => Boolean(n)))] : Object.keys(STORY_SOURCES);
  // S9-PUBLISH: the band reader runs only with SALES_INTELLIGENCE_OVERVIEW on, so a flag-off timeline is byte-identical.
  const bands = overviewEnabled() && (!kinds || kinds.includes(BAND_CHANGED));
  const results = await Promise.all([...names.map(async name => [name, await STORY_SOURCES[name]!(subject, limit, { timeline: ctx })] as const),
    ...(bands ? [(async () => ["band_transitions", await bandTransitionSource(asOf, limit, ctx)] as const)()] : [])]);
  const merged = mergeTimelinePages(results.map(([, r]) => r), limit);
  const multiLead = resolved.scope === "number" && subject.lead_refs.length > 1;
  const adapter: AdapterContext = {
    scope: resolved.scope, number_id: resolved.number_id, outreach_id: resolved.outreach_id, as_of: asOf,
    render: { timezone: TIMEZONE, customer: customerLabel(resolved.leads, resolved.attached, { provider_names: resolved.provider_names }), phone: subject.e164, lead_count: subject.lead_refs.length },
    job_no_by_lead: multiLead ? new Map(resolved.leads.map(l => [String(l._id), l.job_no?.trim() || null])) : null,
  };
  const truncated_sources = [...new Set([...resolved.capped, ...results.filter(([, r]) => r.truncated).map(([name]) => name)])].sort();
  const data = {
    scope: resolved.scope, number_id: resolved.number_id, outreach_id: resolved.outreach_id,
    items: merged.events.map(e => storyEventToTimelineDto(opts.audience === "rep" ? redactOwnerTextForRep(e) : e, adapter)), cursor: merged.cursor, kinds,
    coverage: { truncated_sources },
  };
  return timelineV2PageDtoSchema.parse(await ownerRead(data, () => asOf, deps.coverage));
}

/** `GET /numbers/:id/timeline` v2. `null` when the id is malformed or the Contact Number is missing or purged. */
export async function readNumberTimelineV2(numberId: string, opts: TimelineReadOptions = {}, deps: TimelineReadDeps = {}): Promise<TimelineV2PageDto | null> {
  const asOf = (deps.now ?? (() => new Date()))();
  const resolved = await resolveNumber(numberId, asOf);
  return resolved ? readTimeline(resolved, opts, asOf, deps) : null;
}

/** `GET /outreach/:id/timeline`. `null` when the id is malformed or the record is missing. */
export async function readOutreachTimeline(outreachId: string, opts: TimelineReadOptions = {}, deps: TimelineReadDeps = {}): Promise<TimelineV2PageDto | null> {
  const asOf = (deps.now ?? (() => new Date()))();
  const resolved = await resolveOutreach(outreachId, asOf);
  return resolved ? readTimeline(resolved, opts, asOf, deps) : null;
}
