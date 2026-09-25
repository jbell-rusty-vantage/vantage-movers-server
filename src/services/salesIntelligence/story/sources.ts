import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getGranotObservationModel, type GranotObservationDocument } from "../../../models/GranotObservation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getLeadMessageModel } from "../../../models/LeadMessage";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { toObjectId } from "../../../utils/objectId";
import { normalizePhoneNumberForMatch } from "../../../utils/phone";
import { redactTranscript } from "../../conversations/redaction";
import { moveViewsForLead, type LeadMoveSource, type MoveEndpoint } from "../assessment/views";
import { dispositionFor, normalizePriority, priorityLabel } from "../outreach/leadProgress";
import { subjectKey } from "../outreach/types";
import { leadInstant } from "../outreach/leadInstant";
import { resolveRepIdentityAt, type TemporalRepLink } from "../repIdentity/resolve";
import { auditActorKind, auditEventStoryKind, EXCLUDED_AUDIT_EVENT_KINDS, followupActorKind } from "./catalog";
import type { StoryActor, StoryEvent, StoryEventKind, StoryLeadRef, StorySubject } from "./types";

/**
 * One bounded, indexed reader per source (context provenance specification §3, §4.3). Every
 * reader returns raw events newest first, honours `subject.as_of`, and never writes. Sentences
 * are rendered later by the assembler, after collapse, so readers leave `sentence` empty.
 *
 * No transcript text, no Lead Message body and no email address ever enters an event.
 *
 * **Timeline mode** (data spec §5, `options.timeline`): the same readers serve the Owner
 * timeline with an exclusive keyset `after`, the slack rule for readers whose indexed field is
 * not `happened_at`, the three reader fixes, a `kinds` filter applied before the bound, and the
 * subject resolved once by the caller (D5). Each reader then returns up to `limit + 1` events
 * strictly after the cursor in the timeline order `(happened_at desc, kind_order asc, id desc)`,
 * and `truncated` means a bounded whole-set read hit its cap (coverage), not "more pages".
 * Without `options.timeline` every reader runs exactly the story code path (B22).
 */
export type SourceResult = { events: StoryEvent[]; read: number; truncated: boolean };
export type StorySource = (subject: StorySubject, limit: number, options?: SourceOptions) => Promise<SourceResult>;

/** Exclusive keyset position: the last emitted event of the previous page. */
export type StoryCursor = { happened_at: string; kind_order: number; id: string };

type RecordRow = { _id: mongoose.Types.ObjectId; subject: { kind: "lead" | "number"; model?: "FormLead" | "CallLead" | null; id?: unknown; contact_number_id?: unknown };
  move_assessment?: { artifact_id?: unknown; stale?: boolean } | null };
export type StoryRecordRow = RecordRow;

/** What the timeline caller resolved once (§5.1) and hands every reader. */
export type TimelineReadContext = {
  scope: "outreach" | "number";
  after: StoryCursor | null;
  /** Kinds to emit; null emits every kind. Applied before the bound so paging stays exact. */
  kinds: ReadonlySet<string> | null;
  /** V-T3 M8: kinds never emitted (a rep's Owner-only kinds). Applied with `kinds`, before the bound, so paging stays exact. */
  exclude?: ReadonlySet<string> | null;
  /** Every subject key the timeline spans (number, Leads, records, conversations). */
  subject_keys: string[];
  /** The subject's Outreach records (`subject`, `move_assessment`). */
  records: RecordRow[];
  /** Lead refs the per-Lead sources fan out over (≤ `TIMELINE_LEAD_FANOUT`). */
  lead_refs: StoryLeadRef[];
  /** Those Leads' rows (`LEAD_PROJECTION`), read once by the caller. */
  leads: LeadRow[];
};
export type SourceOptions = { timeline?: TimelineReadContext };

/** Per-Lead sources stop fanning out after this many Leads and report `truncated_sources` (§5.3). */
export const TIMELINE_LEAD_FANOUT = 20;

const db = () => mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
const oid = toObjectId;
const iso = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(+value) ? null : value.toISOString();
  if (typeof value === "string" && value) { const d = new Date(value); return Number.isNaN(+d) ? null : d.toISOString(); }
  return null;
};
const text = (value: unknown, max = 400): string | null => {
  if (value === null || value === undefined) return null;
  const s = redactTranscript(String(value)).text.trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
};
const bool = (value: unknown) => Boolean(value);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const leadKey = (ref: StoryLeadRef) => `lead:${ref.model}:${ref.id}`;
const numberKey = (subject: StorySubject) => (subject.contact_number_id ? `number:${subject.contact_number_id}` : null);
const empty = (): SourceResult => ({ events: [], read: 0, truncated: false });
const bounded = <T>(rows: T[], limit: number) => ({ rows: rows.slice(0, limit), read: Math.min(rows.length, limit), truncated: rows.length > limit });
const byNewest = (a: StoryEvent, b: StoryEvent) => Date.parse(b.happened_at) - Date.parse(a.happened_at) || (a.id < b.id ? 1 : -1);
const withinAsOf = (subject: StorySubject) => (event: StoryEvent) => Date.parse(event.happened_at) <= +subject.as_of;
const dateWindow = (subject: StorySubject) => ({ $lte: subject.as_of });
/** Bounded JSON for audit/instruction payloads: whole records are display caches, not story. */
const smallJson = (value: unknown, max = 1000): unknown => {
  if (value === null || value === undefined) return null;
  try { const s = JSON.stringify(value); return s.length <= max ? JSON.parse(redactTranscript(s).text) : { truncated: true, keys: typeof value === "object" ? Object.keys(value as object).slice(0, 40) : [] }; }
  catch { return null; }
};

const actor = (kind: StoryActor["kind"], name: string | null = null, agent_id: string | null = null, identity_status: StoryActor["identity_status"] = null): StoryActor =>
  ({ kind, agent_id, name, identity_status });

type EventInput = { kind: StoryEventKind; id: string; happened_at: string; observed_at: string | null; subject_key: string; actor: StoryActor;
  detail: Record<string, unknown>; evidence_refs: string[] };
const event = (input: EventInput): StoryEvent => ({
  id: `${input.kind}:${input.id}`, kind: input.kind, happened_at: input.happened_at, observed_at: input.observed_at ?? input.happened_at,
  subject_key: input.subject_key, actor: input.actor, record: { record_type: "story_event", record_id: `${input.kind}:${input.id}` },
  sentence: "", detail: input.detail, evidence_refs: input.evidence_refs,
});

// ---------------------------------------------------------------------------------------------
// Timeline order, keyset and slack (data spec §5.2, §5.3)
// ---------------------------------------------------------------------------------------------

/**
 * Kinds the Owner timeline emits beyond the story catalog. They are never on the model's page:
 * a snooze and an analysis submission are audit rows the story skips.
 */
export const TIMELINE_ONLY_KINDS = ["followup_snoozed", "analysis_submitted", "receiver_agent_changed"] as const;
export type TimelineEventKind = StoryEventKind | (typeof TIMELINE_ONLY_KINDS)[number];

/** `kind_order` = the data spec §5.2 row number. Replaces the string comparison of the old merge. */
export const TIMELINE_KIND_ORDER: Readonly<Record<string, number>> = {
  lead_received: 1,
  call_qualified: 2,
  call: 3,
  conversation_analyzed: 4, conversation_recorded: 4,
  assessment_published: 5,
  granot_priority_changed: 6, quoted_changed: 6, granot_observed: 6, receiver_agent_changed: 6,
  number_attached: 7,
  followup_created: 8, followup_completed: 8, followup_cancelled: 8, followup_superseded: 8,
  assigned: 9, owner_note: 9, closed: 9, reopened: 9, waiting_set: 9, review_opened: 9, review_resolved: 9, restriction_set: 9,
  restriction_resolved: 9, nudge_sent: 9, followup_snoozed: 9, call_started: 9, call_ended: 9, analysis_submitted: 9, owner_correction: 9,
  booking_recorded: 10,
  cancellation_recorded: 11,
  lead_message_sent: 12,
};
export const TIMELINE_KINDS: readonly string[] = Object.keys(TIMELINE_KIND_ORDER);
const UNKNOWN_KIND_ORDER = 99;
export const timelineKindOrder = (kind: string): number => TIMELINE_KIND_ORDER[kind] ?? UNKNOWN_KIND_ORDER;

type Ordered = { happened_at: string; kind: string; id: string };
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function comparePositions(at: number, order: number, id: string, bt: number, border: number, bid: string): number {
  if (at !== bt) return at < bt ? 1 : -1;
  if (order !== border) return order - border;
  return compareIds(bid, id);
}
/** Timeline total order: `happened_at` desc, `kind_order` asc, `id` desc. Negative means `a` first. */
export function compareTimelineOrder(a: Ordered, b: Ordered): number {
  return comparePositions(Date.parse(a.happened_at), timelineKindOrder(a.kind), a.id, Date.parse(b.happened_at), timelineKindOrder(b.kind), b.id);
}
/** Strictly after the cursor in the timeline order; the cursor event itself is excluded. */
export function isAfterStoryCursor(e: Ordered, after: StoryCursor | null): boolean {
  if (!after) return true;
  return comparePositions(Date.parse(e.happened_at), timelineKindOrder(e.kind), e.id, Date.parse(after.happened_at), after.kind_order, after.id) > 0;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Granot `captured_at` precedes `applied_at` by at most this (data spec §5.2 source 6). */
export const GRANOT_CHANGE_SLACK_MS = DAY_MS;
/** Lead Message `sent_at` vs `createdAt` (source 12): up to 1 h before, and (quiet hours, retries) up to 24 h after. */
export const LEAD_MESSAGE_SLACK_BEFORE_MS = HOUR_MS;
export const LEAD_MESSAGE_SLACK_AFTER_MS = DAY_MS;
const MAX_SCAN_BATCHES = 20;
const WHOLE_SET_CAP = 100;
const FOLLOWUP_CAP = 500;
const CORRECTION_CAP = 200;

const acceptor = (subject: StorySubject, t: TimelineReadContext) => (e: StoryEvent) => {
  const at = Date.parse(e.happened_at);
  return !Number.isNaN(at) && at <= +subject.as_of && (t.kinds === null || t.kinds.has(e.kind)) && !t.exclude?.has(e.kind) && isAfterStoryCursor(e, t.after);
};
/** Newest instant a row's indexed field may hold and still yield an event after the cursor. */
const upperBound = (subject: StorySubject, t: TimelineReadContext, slackBeforeMs = 0) =>
  new Date(Math.min(+subject.as_of, t.after ? Date.parse(t.after.happened_at) : Number.POSITIVE_INFINITY) + slackBeforeMs);
/** The first `limit + 1` events in timeline order, deduped on `(kind, id)`. */
function timelineTop(events: StoryEvent[], limit: number): StoryEvent[] {
  const seen = new Set<string>();
  const out: StoryEvent[] = [];
  for (const e of events) { const key = `${e.kind}:${e.id}`; if (seen.has(key)) continue; seen.add(key); out.push(e); }
  return out.sort(compareTimelineOrder).slice(0, limit + 1);
}
const timelineUnion = (results: SourceResult[], limit: number): SourceResult =>
  ({ events: timelineTop(results.flatMap(r => r.events), limit), read: results.reduce((n, r) => n + r.read, 0), truncated: results.some(r => r.truncated) });
const whole = (events: StoryEvent[], accept: (e: StoryEvent) => boolean, limit: number, read: number, truncated: boolean): SourceResult =>
  ({ events: timelineTop(events.filter(accept), limit), read, truncated });

export type ScanInput<R extends { _id: mongoose.Types.ObjectId }> = {
  /** Runs the source query with `window` spread into its filter, sorted `{ [field]: -1, _id: -1 }`, limited to `batch`. */
  query: (window: Record<string, unknown>, batch: number) => Promise<R[]>;
  field: string;
  indexed: (row: R) => Date | null | undefined;
  toEvents: (rows: R[]) => StoryEvent[] | Promise<StoryEvent[]>;
  accept: (e: StoryEvent) => boolean;
  limit: number;
  upper: Date;
  /** How far an event's `happened_at` may run ahead of its row's indexed time. */
  aheadMs: number;
  /** One event per row, `happened_at` = the indexed time, id order = `_id` order. */
  tieSafe?: boolean;
};
/**
 * Keyset scan of one indexed query. Reads `limit + 1` rows at a time (keyset on the indexed
 * field and `_id`) until the `(limit + 1)`-th accepted event is provably ahead of every unread
 * row: unread rows have indexed time ≤ the last row's, so their events happen no later than that
 * plus `aheadMs`. Slack rows that fall before the cursor are filtered in memory and never cost an
 * event, which keeps the page exact without per-source watermarks.
 */
export async function keysetScan<R extends { _id: mongoose.Types.ObjectId }>(input: ScanInput<R>): Promise<SourceResult> {
  const upper = { [input.field]: { $lte: input.upper } };
  let window: Record<string, unknown> = upper;
  let kept: StoryEvent[] = [];
  let read = 0;
  const batch = input.limit + 1;
  for (let round = 0; round < MAX_SCAN_BATCHES; round++) {
    const rows = await input.query(window, batch);
    read += rows.length;
    kept = timelineTop([...kept, ...(await input.toEvents(rows)).filter(input.accept)], input.limit);
    const last = rows[rows.length - 1];
    const lastAt = last ? input.indexed(last) : null;
    if (rows.length < batch || !last || !(lastAt instanceof Date)) return { events: kept, read, truncated: false };
    if (kept.length > input.limit) {
      const boundary = Date.parse(kept[input.limit]!.happened_at), reach = +lastAt + input.aheadMs;
      if (boundary > reach || (input.tieSafe && boundary >= reach)) return { events: kept, read, truncated: false };
    }
    window = { $and: [upper, { $or: [{ [input.field]: { $lt: lastAt } }, { [input.field]: lastAt, _id: { $lt: last._id } }] }] };
  }
  return { events: kept, read, truncated: true };
}

const endpoint = (e: MoveEndpoint): string | null => {
  const place = [e.city, e.state].filter(Boolean).join(", ");
  const full = [place, e.zip].filter(Boolean).join(" ");
  return full || null;
};

/** Lean Lead projection shared by the Lead readers, `granot.ts` and `candidates.ts`. */
export type LeadRow = LeadMoveSource & {
  _id: mongoose.Types.ObjectId; model: "FormLead" | "CallLead";
  name?: string | null; timestamp?: Date | null; createdAt?: Date | null; updatedAt?: Date | null;
  source_company?: string | null; source_company_label_snapshot?: string | null; source_granularity_label_snapshot?: string | null;
  job_no?: string | null; normalized_job_no?: string | null; ingestion_origin?: string | null;
  granot_priority?: string | null; granot_service_type?: string | null; quoted?: boolean | null;
  duplicate?: boolean | null; bad_lead?: string | boolean | null; no_sync?: boolean | null;
  booked?: mongoose.Types.ObjectId | null; cancelled?: mongoose.Types.ObjectId | null;
  receiver_agent?: mongoose.Types.ObjectId | null; receiver_agent_name_snapshot?: string | null;
  granot_contact_snapshot?: { name?: string | null } | null; normalized_phone_number?: string | null;
  ringcentral?: { telephony_session_id?: string | null; qualification_reason?: string | null; start_time?: Date | null;
    original_caller?: { captured_at?: Date | null } | null } | null;
};
export const LEAD_PROJECTION = {
  name: 1, timestamp: 1, createdAt: 1, updatedAt: 1, source_company: 1, source_company_label_snapshot: 1, source_granularity_label_snapshot: 1,
  job_no: 1, normalized_job_no: 1, ingestion_origin: 1, pickup_city: 1, pickup_state: 1, pickup_zip: 1, delivery_city: 1, delivery_state: 1,
  destination_zip: 1, delivery_zip: 1, move_size: 1, move_date: 1, cubic_feet: 1, granot_move_size: 1, granot_service_type: 1, granot_priority: 1,
  quoted: 1, duplicate: 1, bad_lead: 1, no_sync: 1, booked: 1, cancelled: 1, receiver_agent: 1, receiver_agent_name_snapshot: 1,
  "granot_contact_snapshot.name": 1, normalized_phone_number: 1, "ringcentral.telephony_session_id": 1, "ringcentral.qualification_reason": 1,
  "ringcentral.start_time": 1, "ringcentral.original_caller.captured_at": 1, current_move_provenance: 1, ingested_move_snapshot: 1,
} as const;
export const leadCollection = (model: "FormLead" | "CallLead") => (model === "FormLead" ? "form_leads" : "call_leads");
export const leadSourceLabel = (row: LeadRow) => row.source_company_label_snapshot ?? row.source_company ?? null;
export const leadCustomerName = (row: LeadRow) => row.name?.trim() || row.granot_contact_snapshot?.name?.trim() || null;

/** The subject's Leads by `_id`, in `lead_refs` order; missing Leads are skipped. */
export async function readLeadRows(lead_refs: readonly StoryLeadRef[]): Promise<LeadRow[]> {
  const out = new Map<string, LeadRow>();
  for (const model of ["FormLead", "CallLead"] as const) {
    const ids = lead_refs.filter(r => r.model === model && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (!ids.length) continue;
    const rows = await db().collection(leadCollection(model)).find({ _id: { $in: ids } }, { projection: LEAD_PROJECTION }).limit(ids.length).toArray();
    for (const row of rows) out.set(`${model}:${row._id}`, { ...(row as unknown as LeadRow), model });
  }
  return lead_refs.flatMap(r => { const row = out.get(`${r.model}:${r.id}`); return row ? [row] : []; });
}

/** Newest Granot observation per Lead: by Job Number, else by the Lead's normalized phone. */
export async function newestObservations(leads: readonly LeadRow[], as_of: Date): Promise<Map<string, GranotObservationDocument>> {
  const out = new Map<string, GranotObservationDocument>();
  for (const lead of leads) {
    const filter = lead.normalized_job_no ? { "identity.normalized_job_no": lead.normalized_job_no }
      : lead.normalized_phone_number ? { "contact.normalized_phone": lead.normalized_phone_number } : null;
    if (!filter) continue;
    const [row] = await getGranotObservationModel().find({ ...filter, captured_at: { $lte: as_of } }).sort({ captured_at: -1 }).limit(1).lean();
    if (row) out.set(`${lead.model}:${lead._id}`, row as GranotObservationDocument);
  }
  return out;
}

export async function readOutreachRecords(ids: readonly string[]): Promise<RecordRow[]> {
  const valid = ids.filter(id => mongoose.isValidObjectId(id)).map(oid);
  if (!valid.length) return [];
  return (await getOutreachRecordModel().find({ _id: { $in: valid } }).select("subject move_assessment").limit(valid.length).lean()) as unknown as RecordRow[];
}

/** Every subject key the story spans: the number, its Leads, its Outreach records, its conversations. */
export async function storySubjectKeys(subject: StorySubject): Promise<string[]> {
  return subjectKeysFor(subject, await readOutreachRecords(subject.outreach_record_ids));
}
/** Pure form of `storySubjectKeys` for a caller that already holds the records. */
export function subjectKeysFor(subject: StorySubject, records: readonly RecordRow[]): string[] {
  return [...new Set([numberKey(subject), ...subject.lead_refs.map(leadKey), ...records.map(r => subjectKey(r.subject as Parameters<typeof subjectKey>[0])),
    ...subject.conversation_ids.map(id => `conversation:${id}`)].filter((k): k is string => k !== null))];
}

/**
 * `timeline`: S11-TIME (TL-AUDIT N1), the Owner timeline's `lead_received` is the real arrival instant
 * (`leadInstant`; ingested Leads store ET wall clock). The model's story keeps `lead.timestamp` (B22,
 * DECISIONS 2026-09-23 "Reader fixes apply to the Owner timeline only for now").
 */
const leadEvents = (lead: LeadRow, timeline = false): StoryEvent[] => {
  const ref: StoryLeadRef = { model: lead.model, id: String(lead._id) };
  const views = moveViewsForLead(lead, lead.model).canonical_current;
  const received = iso(timeline ? leadInstant(lead) : lead.timestamp) ?? iso(lead.createdAt);
  if (!received) return [];
  const customer = leadCustomerName(lead);
  const events = [event({ kind: "lead_received", id: String(lead._id), happened_at: received, observed_at: iso(lead.createdAt), subject_key: leadKey(ref),
    actor: actor("customer", text(customer, 120)),
    detail: { model: lead.model, lead_ref: ref, customer_name: text(customer, 120), source_company_label: text(leadSourceLabel(lead), 80),
      source_granularity_label: text(lead.source_granularity_label_snapshot, 80), job_no: text(lead.job_no, 40), ingestion_origin: lead.ingestion_origin ?? null,
      pickup: endpoint(views.pickup), delivery: endpoint(views.delivery), move_date: views.move_date, move_size: views.move_size,
      granot_move_size: views.granot_move_size, cubic_feet: views.cubic_feet, duplicate: bool(lead.duplicate), bad_lead: bool(lead.bad_lead),
      no_sync: bool(lead.no_sync), receiver_agent_name: text(lead.receiver_agent_name_snapshot, 80), receiver_agent_id: lead.receiver_agent ? String(lead.receiver_agent) : null },
    evidence_refs: [leadKey(ref)] })];
  const rc = lead.model === "CallLead" ? lead.ringcentral : null;
  const qualifiedAt = rc ? iso(rc.original_caller?.captured_at) ?? iso(rc.start_time) ?? received : null;
  if (rc && qualifiedAt) events.push(event({ kind: "call_qualified", id: String(lead._id), happened_at: qualifiedAt, observed_at: iso(lead.createdAt), subject_key: leadKey(ref),
    actor: actor("vantage"), detail: { lead_ref: ref, qualification_reason: text(rc.qualification_reason, 120), telephony_session_id: rc.telephony_session_id ?? null },
    evidence_refs: [leadKey(ref), ...(rc.telephony_session_id ? [`telephony_session:${rc.telephony_session_id}`] : [])] }));
  return events;
};

/** `lead_received` (+ `call_qualified`) for every Lead in scope. */
export const leadReceivedSource: StorySource = async (subject, limit, options) => {
  const t = options?.timeline;
  if (t) return whole(t.leads.flatMap(lead => leadEvents(lead, true)), acceptor(subject, t), limit, t.leads.length, subject.lead_refs.length > t.lead_refs.length);
  if (!subject.lead_refs.length) return empty();
  const leads = await readLeadRows(subject.lead_refs.slice(0, limit));
  const events = leads.flatMap(lead => leadEvents(lead)).filter(withinAsOf(subject)).sort(byNewest);
  return { events, read: leads.length, truncated: subject.lead_refs.length > limit };
};

type LeadMessageRow = { _id: mongoose.Types.ObjectId; purpose: string; status: string; sent_at?: Date | null; delivered_at?: Date | null; origin?: string | null;
  lead_ref?: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId } | null; createdAt: Date };
const LEAD_MESSAGE_SELECT = "purpose status sent_at delivered_at origin lead_ref createdAt";
const leadMessageEvent = (subject: StorySubject, row: LeadMessageRow): StoryEvent[] => {
  const happened = iso(row.sent_at) ?? iso(row.createdAt);
  if (!happened) return [];
  const ref = row.lead_ref ? { model: row.lead_ref.model, id: String(row.lead_ref.id) } : null;
  return [event({ kind: "lead_message_sent", id: String(row._id), happened_at: happened, observed_at: iso(row.createdAt),
    subject_key: numberKey(subject) ?? (ref ? leadKey(ref) : "number:unknown"), actor: actor("vantage"),
    detail: { purpose: row.purpose, status: row.status, delivered_at: iso(row.delivered_at), origin: row.origin ?? null, lead_ref: ref },
    evidence_refs: [`lead_message:${row._id}`] })];
};
const messageAddresses = (subject: StorySubject): string[] => {
  if (!subject.e164) return [];
  const ten = normalizePhoneNumberForMatch(subject.e164);
  return [subject.e164, ...(ten && ten.length === 10 ? [ten, `1${ten}`] : [])];
};

/** Source 12, timeline mode: index-ordered finds on `createdAt` with slack (D8); no computed sort. */
async function timelineLeadMessages(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  const model = getLeadMessageModel();
  const accept = acceptor(subject, t);
  const upper = upperBound(subject, t, LEAD_MESSAGE_SLACK_BEFORE_MS);
  const scan = (filter: Record<string, unknown>) => keysetScan<LeadMessageRow>({
    query: (window, batch) => model.find({ ...filter, ...window }).select(LEAD_MESSAGE_SELECT).sort({ createdAt: -1, _id: -1 }).limit(batch).lean().exec() as unknown as Promise<LeadMessageRow[]>,
    field: "createdAt", indexed: row => row.createdAt, toEvents: rows => rows.flatMap(row => leadMessageEvent(subject, row)), accept, limit, upper,
    aheadMs: LEAD_MESSAGE_SLACK_AFTER_MS });
  const scans: Array<Promise<SourceResult>> = [];
  for (const m of ["FormLead", "CallLead"] as const) {
    const ids = t.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (ids.length) scans.push(scan({ "lead_ref.model": m, "lead_ref.id": { $in: ids } }));
  }
  const addresses = messageAddresses(subject);
  // Scope outreach reads its Lead's messages; a Number (or a Lead-less record) reads the phone's.
  if (addresses.length && (t.scope === "number" || !t.lead_refs.length)) scans.push(scan({ to: { $in: addresses } }));
  if (!scans.length) return empty();
  return timelineUnion(await Promise.all(scans), limit);
}

/** Texts by `lead_ref` ∪ `to` (both indexed). Body is never selected. */
export const leadMessageSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineLeadMessages(subject, limit, options.timeline);
  const model = getLeadMessageModel();
  const select = LEAD_MESSAGE_SELECT;
  const queries: Array<Promise<unknown[]>> = [];
  for (const m of ["FormLead", "CallLead"] as const) {
    const ids = subject.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (ids.length) queries.push(model.find({ "lead_ref.model": m, "lead_ref.id": { $in: ids }, createdAt: dateWindow(subject) }).select(select).sort({ createdAt: -1 }).limit(limit + 1).lean());
  }
  if (subject.e164) {
    const addresses = messageAddresses(subject);
    queries.push(model.find({ to: { $in: addresses }, createdAt: dateWindow(subject) }).select(select).sort({ createdAt: -1 }).limit(limit + 1).lean());
  }
  if (!queries.length) return empty();
  const merged = new Map<string, LeadMessageRow>();
  let truncated = false;
  for (const rows of await Promise.all(queries)) { truncated ||= rows.length > limit; for (const row of rows.slice(0, limit) as LeadMessageRow[]) merged.set(String(row._id), row); }
  const events = [...merged.values()].flatMap(row => leadMessageEvent(subject, row)).filter(withinAsOf(subject)).sort(byNewest);
  const page = bounded(events, limit);
  return { events: page.rows, read: page.read, truncated: truncated || page.truncated };
};

type LinkRow = TemporalRepLink & { agent_name_snapshot?: string | null };
type CallRow = Awaited<ReturnType<typeof readCallRows>>[number];
const readCallRows = (filter: Record<string, unknown>, limit: number) =>
  getCallInteractionModel().find(filter).sort({ started_at: -1, _id: -1 }).limit(limit).lean();

// ---------------------------------------------------------------------------------------------
// Call capture state (reconciliation addendum §3.1, §3.3; G2, G4)
// ---------------------------------------------------------------------------------------------

/** `first_observed_at − started_at` above this is a late capture (the timeline `Recorded {t}` hour). */
export const LATE_CAPTURE_MS = 60 * 60 * 1000;
export type CallObservedReason = "recovered" | "late_capture" | null;
export type CallCaptureState = {
  /** Stored `terminal`; a row without the field is final. */
  terminal: boolean;
  /** `null` means final unless `terminal === false` (historical rows keep `null` forever). */
  call_log_state: "provisional" | "settled" | null;
  in_progress: boolean;
  observed_reason: CallObservedReason;
  capture_recovery: { kind: "added" | "completed"; at: string } | null;
};
type CaptureFields = { terminal?: boolean | null; call_log_state?: string | null; started_at: Date; first_observed_at?: Date | null;
  capture_recovery?: { kind?: string | null; at?: Date | string | null } | null };
/** The capture facts every Owner call DTO carries. Pure. */
export function callCaptureState(call: CaptureFields): CallCaptureState {
  const terminal = call.terminal !== false;
  const state = call.call_log_state === "provisional" || call.call_log_state === "settled" ? call.call_log_state : null;
  const at = iso(call.capture_recovery?.at);
  const kind = call.capture_recovery?.kind;
  const capture_recovery = at && (kind === "added" || kind === "completed") ? { kind: kind as "added" | "completed", at } : null;
  const observed = call.first_observed_at instanceof Date ? +call.first_observed_at : NaN;
  const observed_reason: CallObservedReason = capture_recovery ? "recovered"
    : !Number.isNaN(observed) && observed - +call.started_at > LATE_CAPTURE_MS ? "late_capture" : null;
  return { terminal, call_log_state: state, in_progress: !terminal, observed_reason, capture_recovery };
}

/**
 * The capture keys of a `call` event's detail. They are for Owner surfaces only: the model's story
 * page and the Case File strip them (`modelCallEvent`), so a Number with no in-progress call keeps a
 * byte-identical model payload (addendum §3.1, the no-paid-job-storm rule).
 */
export const OWNER_ONLY_CALL_DETAIL_KEYS = ["terminal", "call_log_state", "in_progress", "sources", "observed_reason", "capture_recovery"] as const;
/** True for a `call` event whose call is still in progress (`terminal: false`). */
export const isInProgressCall = (e: Pick<StoryEvent, "kind" | "detail">) => e.kind === "call" && e.detail.terminal === false;
/** The event as the model reads it: a `call` without the Owner-only capture keys; other kinds unchanged. Pure. */
export function modelCallEvent(e: StoryEvent): StoryEvent {
  if (e.kind !== "call" || !OWNER_ONLY_CALL_DETAIL_KEYS.some(key => key in e.detail)) return e;
  const detail = { ...e.detail };
  for (const key of OWNER_ONLY_CALL_DETAIL_KEYS) delete detail[key];
  return { ...e, detail };
}

/** One `call` event per row, in row order, with the rep resolved through one batched link read. */
async function callEvents(rows: CallRow[], subject: StorySubject): Promise<StoryEvent[]> {
  const userParty = (call: CallRow) => call.parties.find(p => p.role === "user" && p.connected && p.extension_id) ?? call.parties.find(p => p.role === "user" && p.extension_id) ?? null;
  const pairs = new Map<string, { account: string; extension: string }>();
  for (const call of rows) { const party = userParty(call); if (party?.extension_id) pairs.set(`${call.provider_account_id}:${party.extension_id}`, { account: call.provider_account_id, extension: party.extension_id }); }
  const links = pairs.size ? (await getRepIdentityLinkModel().find({ rc_account_id: { $in: [...new Set([...pairs.values()].map(p => p.account))] },
    rc_extension_id: { $in: [...new Set([...pairs.values()].map(p => p.extension))] } }).limit(500).lean()) as unknown as LinkRow[] : [];
  return rows.map(call => {
    const party = userParty(call);
    const resolution = party?.extension_id ? resolveRepIdentityAt(links, call.provider_account_id, party.extension_id, call.started_at) : null;
    const link = resolution?.link_id ? links.find(l => String(l._id) === resolution.link_id) : null;
    const reviewed = resolution?.status === "reviewed";
    const rep = { agent_id: reviewed ? resolution!.agent_id : null, name: reviewed ? text(link?.agent_name_snapshot, 80) : null,
      status: resolution ? (resolution.status === "reviewed" ? "reviewed" : resolution.status === "proposed_only" ? "proposed" : "unknown") : "unknown",
      extension: party?.extension_number ?? party?.extension_id ?? null };
    const identity: StoryActor["identity_status"] = rep.status === "reviewed" ? "reviewed" : rep.status === "proposed" ? "proposed" : "unknown";
    const recordings = call.recordings ?? [];
    const capture = callCaptureState(call as CallRow & CaptureFields);
    // An in-progress call has no final result or duration yet (G2): both stay null until it settles.
    return event({ kind: "call", id: String(call._id), happened_at: call.started_at.toISOString(), observed_at: iso(call.first_observed_at), subject_key: `number:${subject.contact_number_id}`,
      actor: call.direction === "Inbound" ? actor("customer") : actor("rep", rep.name, rep.agent_id, identity),
      detail: { interaction_id: String(call._id), direction: call.direction, provider_result: capture.terminal ? text(call.provider_result, 60) : null, provider_connected: bool(call.provider_connected),
        contact_type: call.contact_type, contact_type_basis: call.contact_type_basis ?? null, duration_seconds: capture.terminal ? num(call.duration_seconds) : null, recording_count: recordings.length,
        rep, transfer: bool(call.transfer), queue_fanout: bool(call.queue_fanout), account_id: call.provider_account_id,
        conversation_id: recordings.find(r => r.lead_conversation_id)?.lead_conversation_id ? String(recordings.find(r => r.lead_conversation_id)!.lead_conversation_id) : null,
        terminal: capture.terminal, call_log_state: capture.call_log_state, in_progress: capture.in_progress, sources: [...((call as { sources?: string[] }).sources ?? [])],
        observed_reason: capture.observed_reason, capture_recovery: capture.capture_recovery },
      evidence_refs: [`interaction:${call._id}`, ...recordings.map(r => `recording:${r.provider_recording_id}`)] });
  });
}

/**
 * Source 3, timeline mode. Adds, for the Owner only, the analyzed state of each call's
 * conversations from one `$in` over the batch (`detail.analyzed_conversation_id`,
 * `detail.recording_state`); the model's `call` detail is unchanged.
 */
async function timelineCalls(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  if (!subject.contact_number_id) return empty();
  const numberId = oid(subject.contact_number_id);
  return keysetScan<CallRow>({
    query: (window, batch) => readCallRows({ contact_number_id: numberId, merged_into_id: null, purged_at: null, ...window }, batch).exec(),
    field: "started_at", indexed: row => row.started_at,
    toEvents: async rows => {
      const events = await callEvents(rows, subject);
      const linked = [...new Set(rows.flatMap(row => (row.recordings ?? []).map(r => r.lead_conversation_id).filter(Boolean).map(String)))];
      const analyzed = new Set(linked.length ? (await getLeadConversationModel().find({ _id: { $in: linked.map(oid) }, latest_completed_run_id: { $ne: null } })
        .select("_id").limit(linked.length).lean()).map(row => String(row._id)) : []);
      rows.forEach((row, index) => {
        const recordings = row.recordings ?? [];
        const done = recordings.map(r => (r.lead_conversation_id ? String(r.lead_conversation_id) : null)).find((id): id is string => id !== null && analyzed.has(id)) ?? null;
        const detail = events[index]!.detail;
        detail.analyzed_conversation_id = done;
        detail.recording_state = recordings.length === 0 ? "none" : done ? "analyzed" : "recorded";
      });
      return events;
    },
    accept: acceptor(subject, t), limit, upper: upperBound(subject, t), aheadMs: 0, tieSafe: true,
  });
}

/** Canonical `call_interactions` on the number with the rep resolved through reviewed identity links. */
export const callSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineCalls(subject, limit, options.timeline);
  if (!subject.contact_number_id) return empty();
  const rows = await readCallRows({ contact_number_id: oid(subject.contact_number_id), merged_into_id: null, purged_at: null, started_at: dateWindow(subject) }, limit + 1);
  const page = bounded(rows, limit);
  const events = await callEvents(page.rows, subject);
  return { events, read: page.read, truncated: page.truncated };
};

type ConversationRow = { _id: mongoose.Types.ObjectId; call_interaction_id?: mongoose.Types.ObjectId | null; state: string; direction: string; contact_type?: string | null;
  duration_seconds?: number | null; started_at: Date; createdAt?: Date; updatedAt?: Date; provider_recording_id: string; latest_transcript_version?: string | null;
  latest_completed_run_id?: mongoose.Types.ObjectId | null; summary?: { sections?: { overview?: string | null } | null; created_at?: Date | null } | null;
  lead_ref?: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId } | null };
const CONVERSATION_SELECT = "call_interaction_id state direction contact_type duration_seconds started_at createdAt updatedAt provider_recording_id latest_transcript_version latest_completed_run_id summary.sections.overview summary.created_at lead_ref";

const firstSentence = (value: unknown): string | null => {
  const clean = text(value, 400);
  if (!clean) return null;
  const first = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
};

/** `conversation_recorded` (+ `conversation_analyzed` for analyzed rows), in row order; two batched side reads. */
async function conversationEvents(rows: ConversationRow[]): Promise<StoryEvent[]> {
  const analyzed = rows.filter(row => row.latest_completed_run_id);
  const [snapshots, findings] = await Promise.all([
    analyzed.length ? getIntelligenceEvidenceSnapshotModel().find({ ...csiDataset(), source_type: "summary", artifact_key: { $type: "string" }, run_id: null,
      conversation_id: { $in: analyzed.map(row => row._id) }, purged_at: null, purge_started_at: null }).select("conversation_id response").sort({ _id: -1 }).limit(analyzed.length * 3).lean() : Promise.resolve([]),
    analyzed.length ? getIntelligenceFindingModel().aggregate<{ _id: mongoose.Types.ObjectId; count: number; next_steps: unknown[] }>([
      { $match: { run_id: { $in: analyzed.map(row => row.latest_completed_run_id) }, purged_at: null } },
      { $group: { _id: "$run_id", count: { $sum: 1 }, next_steps: { $push: { $cond: [{ $eq: ["$kind", "next_step"] }, "$assertion.value", "$$REMOVE"] } } } },
      { $limit: analyzed.length + 1 }]) : Promise.resolve([]),
  ]);
  const overviewByConversation = new Map<string, { id: string; overview: unknown }>();
  for (const snapshot of snapshots as Array<{ _id: unknown; conversation_id?: unknown; response?: unknown }>) {
    const key = String(snapshot.conversation_id);
    if (overviewByConversation.has(key)) continue;
    const response = snapshot.response as { analysis_summary?: { summary?: { overview?: unknown } } } | null;
    overviewByConversation.set(key, { id: String(snapshot._id), overview: response?.analysis_summary?.summary?.overview ?? null });
  }
  const findingsByRun = new Map(findings.map(f => [String(f._id), f]));
  const events: StoryEvent[] = [];
  for (const row of rows) {
    const id = String(row._id), key = `conversation:${id}`;
    events.push(event({ kind: "conversation_recorded", id, happened_at: row.started_at.toISOString(), observed_at: iso(row.createdAt), subject_key: key, actor: actor("vantage"),
      detail: { conversation_id: id, call_interaction_id: row.call_interaction_id ? String(row.call_interaction_id) : null, state: row.state, direction: row.direction,
        contact_type: row.contact_type ?? null, duration_seconds: num(row.duration_seconds), transcript_version: row.latest_transcript_version ?? null, recording: row.provider_recording_id,
        lead_ref: row.lead_ref ? { model: row.lead_ref.model, id: String(row.lead_ref.id) } : null },
      evidence_refs: [key, `recording:${row.provider_recording_id}`] }));
    if (!row.latest_completed_run_id) continue;
    const runId = String(row.latest_completed_run_id);
    const snapshot = overviewByConversation.get(id) ?? null;
    const summary = findingsByRun.get(runId);
    const nextStep = summary?.next_steps.find(v => v && typeof v === "object") as { action_kind?: unknown; kind?: unknown } | undefined;
    events.push(event({ kind: "conversation_analyzed", id, happened_at: row.started_at.toISOString(), observed_at: iso(row.summary?.created_at) ?? iso(row.updatedAt), subject_key: key,
      actor: actor("intelligence"),
      detail: { conversation_id: id, run_id: runId, summary_snapshot_id: snapshot?.id ?? null,
        overview_first_sentence: firstSentence(snapshot?.overview ?? row.summary?.sections?.overview ?? null), findings_count: summary?.count ?? 0,
        next_step_kind: typeof nextStep?.action_kind === "string" ? nextStep.action_kind : typeof nextStep?.kind === "string" ? nextStep.kind : null },
      evidence_refs: [key, `run:${runId}`, ...(snapshot ? [`snapshot:${snapshot.id}`] : [])] }));
  }
  return events;
}

/**
 * Source 4, timeline mode: the Number's conversations (scope `outreach` adds the Lead's, deduped
 * on `_id`). A `conversation_recorded` whose call is on the timeline (`call_interaction_id` set)
 * is dropped, because the `call` event already carries it; legacy rows without an interaction
 * stay as routine events.
 */
async function timelineConversations(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  const model = getLeadConversationModel();
  const base = acceptor(subject, t);
  const accept = (e: StoryEvent) => !(e.kind === "conversation_recorded" && e.detail.call_interaction_id) && base(e);
  const upper = upperBound(subject, t);
  const scan = (filter: Record<string, unknown>) => keysetScan<ConversationRow>({
    query: (window, batch) => model.find({ ...filter, ...window }).select(CONVERSATION_SELECT).sort({ started_at: -1, _id: -1 }).limit(batch).lean().exec() as unknown as Promise<ConversationRow[]>,
    field: "started_at", indexed: row => row.started_at, toEvents: conversationEvents, accept, limit, upper, aheadMs: 0 });
  const scans: Array<Promise<SourceResult>> = [];
  if (subject.contact_number_id) scans.push(scan({ contact_number_id: oid(subject.contact_number_id) }));
  if (t.scope === "outreach" || !subject.contact_number_id) for (const m of ["FormLead", "CallLead"] as const) {
    const ids = t.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (ids.length) scans.push(scan({ "lead_ref.model": m, "lead_ref.id": { $in: ids } }));
  }
  if (!scans.length) return empty();
  return timelineUnion(await Promise.all(scans), limit);
}

/** `conversation_recorded` and `conversation_analyzed` for the number's, the Leads' and the listed conversations. */
export const conversationSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineConversations(subject, limit, options.timeline);
  const model = getLeadConversationModel();
  const queries: Array<Promise<unknown[]>> = [];
  if (subject.contact_number_id) queries.push(model.find({ contact_number_id: oid(subject.contact_number_id), started_at: dateWindow(subject) }).select(CONVERSATION_SELECT).sort({ started_at: -1, _id: -1 }).limit(limit + 1).lean());
  for (const m of ["FormLead", "CallLead"] as const) {
    const ids = subject.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (ids.length) queries.push(model.find({ "lead_ref.model": m, "lead_ref.id": { $in: ids }, started_at: dateWindow(subject) }).select(CONVERSATION_SELECT).sort({ started_at: -1 }).limit(limit + 1).lean());
  }
  const listed = subject.conversation_ids.filter(id => mongoose.isValidObjectId(id)).map(oid);
  if (listed.length) queries.push(model.find({ _id: { $in: listed.slice(0, limit) }, started_at: dateWindow(subject) }).select(CONVERSATION_SELECT).limit(limit + 1).lean());
  if (!queries.length) return empty();
  const merged = new Map<string, ConversationRow>();
  let truncated = false;
  for (const rows of await Promise.all(queries)) { truncated ||= rows.length > limit; for (const row of rows.slice(0, limit) as ConversationRow[]) merged.set(String(row._id), row); }
  const page = bounded([...merged.values()].sort((a, b) => +b.started_at - +a.started_at || (String(a._id) < String(b._id) ? 1 : -1)), limit);
  const events = await conversationEvents(page.rows);
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: page.read, truncated: truncated || page.truncated };
};

/**
 * Fold each `conversation_recorded` into the `call` it belongs to (matching interaction id) so
 * one call is one event; only legacy rows without an interaction stay standalone. Pure.
 */
export function mergeConversationsIntoCalls(events: StoryEvent[]): StoryEvent[] {
  const calls = new Map<string, StoryEvent>();
  for (const e of events) if (e.kind === "call") calls.set(String(e.detail.interaction_id ?? e.id.slice(5)), e);
  const dropped = new Set<string>();
  for (const e of events) {
    if (e.kind !== "conversation_recorded") continue;
    const call = typeof e.detail.call_interaction_id === "string" ? calls.get(e.detail.call_interaction_id) : undefined;
    if (!call) continue;
    call.detail = { ...call.detail, conversation_id: e.detail.conversation_id, recording: e.detail.recording, transcript_version: e.detail.transcript_version,
      conversation_state: e.detail.state, recording_count: Math.max(Number(call.detail.recording_count ?? 0), 1) };
    call.evidence_refs = [...new Set([...call.evidence_refs, ...e.evidence_refs])];
    if (e.focus) call.focus = true;
    dropped.add(e.id);
  }
  return events.filter(e => !dropped.has(e.id));
}

const OWNER_LABELS = new Set(["automatic", "system", "evidence", "worker", "auto", "vantage", "intelligence"]);
const decidedBy = (by: unknown): StoryActor => (typeof by === "string" && by.trim() && !OWNER_LABELS.has(by.trim().toLowerCase()) ? actor("owner", null, text(by, 60)) : actor("vantage"));

type AttachmentRow = Awaited<ReturnType<typeof readAttachmentRows>>[number];
const readAttachmentRows = (filter: Record<string, unknown>, sort: Record<string, 1 | -1>, limit: number) =>
  getNumberLeadAttachmentModel().find(filter).sort(sort).limit(limit).lean();

/** One event per edge transition into attached/rejected/ambiguous; an edge without history yields its current state. */
function attachmentEvents(edges: AttachmentRow[]): StoryEvent[] {
  const events: StoryEvent[] = [];
  for (const edge of edges) {
    const ref: StoryLeadRef = { model: edge.lead_ref.model, id: String(edge.lead_ref.id) };
    const base = { attachment_id: String(edge._id), lead_ref: ref, certainty: edge.certainty, lead_name: text(edge.lead_snapshot?.name, 80),
      evidence_sources: [...new Set((edge.evidence ?? []).map(e => e.source))] };
    const history = (edge.history ?? []).filter(h => h.to === "attached" || h.to === "rejected" || h.to === "ambiguous");
    if (history.length) {
      history.forEach((h, n) => {
        const at = iso(h.at) ?? iso(edge.updatedAt);
        if (!at) return;
        events.push(event({ kind: "number_attached", id: `${edge._id}:${n}`, happened_at: at, observed_at: iso(edge.updatedAt), subject_key: leadKey(ref), actor: decidedBy(h.by),
          detail: { ...base, state: h.to, from_state: h.from ?? null, decided_by: text(h.by, 60), reason: text(h.reason, 200) }, evidence_refs: [`attachment:${edge._id}`] }));
      });
      continue;
    }
    const at = iso(edge.decided_at) ?? iso(edge.auto_decision?.decided_at) ?? iso(edge.createdAt);
    if (!at) continue;
    events.push(event({ kind: "number_attached", id: String(edge._id), happened_at: at, observed_at: iso(edge.updatedAt), subject_key: leadKey(ref),
      actor: edge.decided_at ? decidedBy(edge.decided_by) : actor("vantage"),
      detail: { ...base, state: edge.state, from_state: null, decided_by: text(edge.decided_by, 60) ?? (edge.auto_decision ? "automatic" : null),
        reason: text(edge.decision_reason, 200) ?? text(edge.auto_decision?.reason, 200) ?? (base.evidence_sources.length ? base.evidence_sources.join(", ") : null),
        confidence: num(edge.auto_decision?.confidence) }, evidence_refs: [`attachment:${edge._id}`] }));
  }
  return events;
}

/**
 * Source 7, timeline mode: the whole bounded edge set (≤ 100), by Lead in scope `outreach` and
 * by number in scope `number`. Reader fix: newest transitions first (`updatedAt` desc), so a
 * truncated set keeps the newest edges rather than the oldest.
 */
async function timelineAttachments(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  const sort = { updatedAt: -1, _id: -1 } as const;
  const byLead = t.scope === "outreach" && t.lead_refs.length > 0;
  const batches = byLead
    ? await Promise.all((["FormLead", "CallLead"] as const).map(m => {
      const ids = t.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
      return ids.length ? readAttachmentRows({ "lead_ref.model": m, "lead_ref.id": { $in: ids } }, sort, WHOLE_SET_CAP + 1) : Promise.resolve([]);
    }))
    : subject.contact_number_id ? [await readAttachmentRows({ contact_number_id: oid(subject.contact_number_id) }, sort, WHOLE_SET_CAP + 1)] : [];
  const rows = batches.flatMap(b => b.slice(0, WHOLE_SET_CAP));
  return whole(attachmentEvents(rows), acceptor(subject, t), limit, rows.length, batches.some(b => b.length > WHOLE_SET_CAP));
}

/** One event per attachment edge transition; edges without history yield one event for the current state. */
export const attachmentSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineAttachments(subject, limit, options.timeline);
  const rows = subject.contact_number_id
    ? await readAttachmentRows({ contact_number_id: oid(subject.contact_number_id) }, { _id: 1 }, limit + 1)
    : subject.lead_refs.length ? (await Promise.all((["FormLead", "CallLead"] as const).map(m => {
      const ids = subject.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
      return ids.length ? readAttachmentRows({ "lead_ref.model": m, "lead_ref.id": { $in: ids } }, { _id: 1 }, limit + 1) : Promise.resolve([]);
    }))).flat() : [];
  const page = bounded(rows, limit);
  return { events: attachmentEvents(page.rows).filter(withinAsOf(subject)).sort(byNewest), read: page.read, truncated: page.truncated };
};

type ChangeRow = { _id: mongoose.Types.ObjectId; entity: { model: string; id: string }; changed_paths: string[]; fields: Array<{ path: string; before?: unknown; after?: unknown }>;
  applied_at: Date; provenance?: { source_system?: string; observation_id?: unknown } | null; revision_before?: number };
/** S6-AGENT: the Owner-timeline `receiver_agent_changed` event (timeline mode only; never on the model's page). */
const receiverTimelineEnabled = () => csiFlag("RECEIVER_ASSIGNMENT");
const CHANGE_PROJECTION = { entity: 1, changed_paths: 1, fields: 1, applied_at: 1, "provenance.source_system": 1, "provenance.observation_id": 1 } as const;

/** Priority/Quoted events from Lead changes, timed by the observation paired through `provenance.observation_id` (one `$in`). */
async function granotChangeEvents(changes: ChangeRow[], receiverEvents = false): Promise<StoryEvent[]> {
  const observationIds = [...new Set(changes.map(c => c.provenance?.observation_id).filter(Boolean).map(String))].filter(id => mongoose.isValidObjectId(id));
  const observations = new Map<string, GranotObservationDocument>();
  if (observationIds.length) for (const row of await getGranotObservationModel().find({ _id: { $in: observationIds.map(oid) } }).select("captured_at agent_identity").limit(observationIds.length).lean())
    observations.set(String(row._id), row as GranotObservationDocument);
  const events: StoryEvent[] = [];
  for (const change of changes) {
    const ref: StoryLeadRef = { model: change.entity.model as StoryLeadRef["model"], id: change.entity.id };
    const observation = change.provenance?.observation_id ? observations.get(String(change.provenance.observation_id)) ?? null : null;
    const happened = iso(observation?.captured_at) ?? change.applied_at.toISOString();
    const source = change.provenance?.source_system ?? "granot";
    const who: StoryActor = source === "granot" ? actor("granot", text(observation?.agent_identity?.rep_raw, 60)) : actor("vantage");
    const common = { change_id: String(change._id), observation_id: observation ? String(observation._id) : null, source_system: source, applied_at: change.applied_at.toISOString() };
    const refs = [`change:${change._id}`, ...(observation ? [`observation:${observation._id}`] : [])];
    const priority = change.fields.find(f => f.path === "granot_priority");
    if (priority && change.changed_paths.includes("granot_priority")) {
      const from = normalizePriority(priority.before), to = normalizePriority(priority.after);
      events.push(event({ kind: "granot_priority_changed", id: String(change._id), happened_at: happened, observed_at: change.applied_at.toISOString(), subject_key: leadKey(ref), actor: who,
        detail: { ...common, lead_ref: ref, from, to, label_from: priorityLabel(from), label_to: priorityLabel(to), disposition_to: dispositionFor(to), granot_rep_raw: text(observation?.agent_identity?.rep_raw, 60) },
        evidence_refs: refs }));
    }
    const quoted = change.fields.find(f => f.path === "quoted");
    // A creation change carrying quoted:false is not a change of mind; only a real flip is an event.
    if (quoted && change.changed_paths.includes("quoted") && (quoted.after === true || quoted.before === true)) events.push(event({ kind: "quoted_changed", id: String(change._id), happened_at: happened, observed_at: change.applied_at.toISOString(),
      subject_key: leadKey(ref), actor: who, detail: { ...common, lead_ref: ref, quoted: quoted.after === true, quoted_before: quoted.before === true }, evidence_refs: refs }));
    // S6-AGENT: `Rep changed in Granot: {old} → {new}`. A creation change is the Lead's arrival, not a rep change.
    const creation = change.revision_before === 0 && change.changed_paths.includes("timestamp");
    const receiver = receiverEvents && change.changed_paths.includes("receiver_agent") && !creation ? change.fields.find(f => f.path === "receiver_agent") : undefined;
    if (receiver) {
      const name = (side: "before" | "after") => text(change.fields.find(f => f.path === "receiver_agent_name_snapshot")?.[side], 60);
      const agentId = (value: unknown) => (value == null ? null : String(value));
      events.push(event({ kind: "receiver_agent_changed" as StoryEventKind, id: String(change._id), happened_at: happened, observed_at: change.applied_at.toISOString(), subject_key: leadKey(ref), actor: who,
        detail: { ...common, lead_ref: ref, from: { agent_id: agentId(receiver.before), name: name("before") }, to: { agent_id: agentId(receiver.after), name: name("after") },
          receiver_agent_source: text(change.fields.find(f => f.path === "receiver_agent_source")?.after, 40) }, evidence_refs: refs }));
    }
  }
  return events;
}

/**
 * Source 6, timeline mode: keyset on `applied_at` per Lead with the 24 h slack, then the paired
 * `happened_at` (captured ≤ applied) filtered in memory. Paired: `captured_at` / `applied_at`;
 * unpaired: `applied_at` for both (B13).
 */
async function timelineGranotChanges(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  if (!t.lead_refs.length) return empty();
  const accept = acceptor(subject, t);
  const upper = upperBound(subject, t, GRANOT_CHANGE_SLACK_MS);
  // S6-AGENT (§3.1, E3): with RECEIVER_ASSIGNMENT on, the Owner timeline also reads `receiver_agent` changes.
  const receiver = receiverTimelineEnabled() && (t.kinds === null || t.kinds.has("receiver_agent_changed"));
  const paths = receiver ? ["granot_priority", "quoted", "receiver_agent"] : ["granot_priority", "quoted"];
  const projection = receiver ? { ...CHANGE_PROJECTION, revision_before: 1 } : CHANGE_PROJECTION;
  const scans = t.lead_refs.map(ref => keysetScan<ChangeRow>({
    query: (window, batch) => db().collection("entity_changes").find({ "entity.model": ref.model, "entity.id": ref.id, changed_paths: { $in: paths }, ...window },
      { projection }).sort({ applied_at: -1, _id: -1 }).limit(batch).toArray() as unknown as Promise<ChangeRow[]>,
    field: "applied_at", indexed: row => row.applied_at, toEvents: rows => granotChangeEvents(rows, receiver), accept, limit, upper, aheadMs: 0 }));
  const result = timelineUnion(await Promise.all(scans), limit);
  return { ...result, truncated: result.truncated || subject.lead_refs.length > t.lead_refs.length };
}

/** `granot_priority_changed` / `quoted_changed` from append-only Lead changes, timed by the paired observation. */
export const granotChangeSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineGranotChanges(subject, limit, options.timeline);
  if (!subject.lead_refs.length) return empty();
  const batches = await Promise.all(subject.lead_refs.slice(0, limit).map(ref => db().collection("entity_changes")
    .find({ "entity.model": ref.model, "entity.id": ref.id, changed_paths: { $in: ["granot_priority", "quoted"] }, applied_at: dateWindow(subject) },
      { projection: CHANGE_PROJECTION })
    .sort({ applied_at: -1 }).limit(limit + 1).toArray()));
  const truncated = batches.some(rows => rows.length > limit);
  const changes = batches.flatMap(rows => rows.slice(0, limit) as unknown as ChangeRow[]);
  const events = await granotChangeEvents(changes);
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: changes.length, truncated: truncated || subject.lead_refs.length > limit };
};

const moneyRaw = (amount: { raw?: string; canonical?: string } | undefined | null) => ({ raw: text(amount?.raw, 40), canonical: text(amount?.canonical, 40) });
const observationLocation = (loc: { city?: string; state?: string; zip?: string } | undefined) => loc ? endpoint({ city: loc.city ?? null, state: loc.state ?? null, zip: loc.zip ?? null }) : null;

function granotObservedEvents(leads: readonly LeadRow[], observations: Map<string, GranotObservationDocument>): StoryEvent[] {
  return leads.flatMap(lead => {
    const observation = observations.get(`${lead.model}:${lead._id}`);
    if (!observation) return [];
    const ref: StoryLeadRef = { model: lead.model, id: String(lead._id) };
    const priority = normalizePriority(observation.priority?.canonical ?? observation.priority?.raw);
    const estimate = moneyRaw(observation.display_money?.estimate), payment = moneyRaw(observation.display_money?.payment), balance = moneyRaw(observation.display_money?.balance);
    return [event({ kind: "granot_observed", id: String(observation._id), happened_at: observation.captured_at.toISOString(), observed_at: iso(observation.createdAt), subject_key: leadKey(ref),
      actor: actor("granot", text(observation.agent_identity?.rep_raw, 60)),
      detail: { lead_ref: ref, observation_kind: observation.kind, source_label: observation.normalized_source_label ?? null, job_no: text(observation.identity?.job_no_raw, 40),
        priority, priority_label: priorityLabel(priority), disposition: dispositionFor(priority), priority_valid: bool(observation.priority?.valid),
        booking_action: observation.booking_action?.normalized ?? null, booking_action_raw: text(observation.booking_action?.raw, 40),
        estimate: estimate.raw, payment: payment.raw, balance: balance.raw, estimate_canonical: estimate.canonical, payment_canonical: payment.canonical, balance_canonical: balance.canonical,
        move: { pickup: observationLocation(observation.move?.origin), delivery: observationLocation(observation.move?.destination), move_date: iso(observation.move?.move_date)?.slice(0, 10) ?? text(observation.move?.move_date_raw, 40),
          granot_move_size: text(observation.move?.granot_move_size_raw, 40), service_type: text(observation.move?.service_type_raw, 40), cubic_feet: num(observation.move?.estimated_cubic_feet) },
        rep_raw: text(observation.agent_identity?.rep_raw, 60), user_raw: text(observation.agent_identity?.user_raw, 60) },
      evidence_refs: [`observation:${observation._id}`] })];
  });
}

/** ONE `granot_observed` per Lead: the newest observation, i.e. Granot's current display state. */
export const granotObservedSource: StorySource = async (subject, limit, options) => {
  const t = options?.timeline;
  if (t) {
    const observations = await newestObservations(t.leads, subject.as_of);
    return whole(granotObservedEvents(t.leads, observations), acceptor(subject, t), limit, t.leads.length, subject.lead_refs.length > t.lead_refs.length);
  }
  if (!subject.lead_refs.length) return empty();
  const leads = await readLeadRows(subject.lead_refs.slice(0, limit));
  const observations = await newestObservations(leads, subject.as_of);
  const events = granotObservedEvents(leads, observations).filter(withinAsOf(subject)).sort(byNewest);
  return { events, read: leads.length, truncated: subject.lead_refs.length > limit };
};

type BookingDoc = Record<string, unknown> & { _id: mongoose.Types.ObjectId; lead_ref_snapshot?: { model?: unknown; id?: unknown } | null };
const BOOKING_PROJECTION = { book_date: 1, job_no: 1, deposit_amount: 1, total_binder_amount: 1, source: 1, lead_ref: 1, lead_model: 1, cancelled: 1, createdAt: 1 } as const;
const CANCELLATION_PROJECTION = { cancel_date: 1, reason: 1, refund_amount: 1, booked_lead: 1, lead_ref: 1, lead_model: 1, lead_ref_snapshot: 1, job_no: 1, job_no_snapshot: 1, createdAt: 1 } as const;

function bookingEvents(subject: StorySubject, leads: readonly LeadRow[], bookings: BookingDoc[], cancellations: BookingDoc[]): StoryEvent[] {
  const leadRefFor = (row: BookingDoc): StoryLeadRef | null => {
    const id = row.lead_ref_snapshot?.id ?? row.lead_ref, model = row.lead_ref_snapshot?.model ?? row.lead_model;
    if (!id) return null;
    const match = leads.find(l => String(l._id) === String(id));
    return { model: (match?.model ?? (model === "CallLead" ? "CallLead" : "FormLead")) as StoryLeadRef["model"], id: String(id) };
  };
  const events: StoryEvent[] = [];
  for (const row of bookings) {
    const happened = iso(row.book_date) ?? iso(row.createdAt);
    if (!happened) continue;
    const ref = leadRefFor(row);
    events.push(event({ kind: "booking_recorded", id: String(row._id), happened_at: happened, observed_at: iso(row.createdAt), subject_key: ref ? leadKey(ref) : numberKey(subject) ?? "number:unknown",
      actor: actor("vantage"), detail: { booking_id: String(row._id), lead_ref: ref, job_no: text(row.job_no, 40), deposit_amount: num(row.deposit_amount), total_binder_amount: num(row.total_binder_amount),
        source: text(row.source, 60), cancelled: Boolean(row.cancelled) }, evidence_refs: [`booking:${row._id}`] }));
  }
  for (const row of cancellations) {
    const happened = iso(row.cancel_date) ?? iso(row.createdAt);
    if (!happened) continue;
    const ref = leadRefFor(row);
    events.push(event({ kind: "cancellation_recorded", id: String(row._id), happened_at: happened, observed_at: iso(row.createdAt), subject_key: ref ? leadKey(ref) : numberKey(subject) ?? "number:unknown",
      actor: actor("vantage"), detail: { cancellation_id: String(row._id), booking_id: row.booked_lead ? String(row.booked_lead) : null, lead_ref: ref, job_no: text(row.job_no_snapshot ?? row.job_no, 40),
        reason: text(row.reason, 200), refund_amount: num(row.refund_amount) }, evidence_refs: [`cancellation:${row._id}`, ...(row.booked_lead ? [`booking:${row.booked_lead}`] : [])] }));
  }
  return events;
}

const bookingClauses = (leads: readonly LeadRow[]): Record<string, unknown>[] => {
  const jobNos = [...new Set(leads.map(l => l.job_no?.trim()).filter((j): j is string => Boolean(j)))];
  return [{ lead_ref: { $in: leads.map(l => l._id) } }, ...(jobNos.length ? [{ job_no: { $in: jobNos } }] : [])];
};

/**
 * Sources 10–11, timeline mode: whole bounded sets (≤ 100 each). Reader fix: a Booking (or a
 * Cancellation) with a null date falls back to `createdAt` for both times, so it is never
 * `recorded_late`, and says so in `detail.book_date_missing` / `detail.cancel_date_missing`.
 * The Booking's agent comes from its first allocation snapshot (no extra read).
 */
async function timelineBookings(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  if (!t.leads.length) return empty();
  const asOf = subject.as_of;
  const bookings = await db().collection("booked_leads").find({ $and: [{ $or: bookingClauses(t.leads) },
    { $or: [{ book_date: { $lte: asOf } }, { book_date: null, createdAt: { $lte: asOf } }] }] },
  { projection: { ...BOOKING_PROJECTION, "agent_allocations.agent_name_snapshot": 1 } }).sort({ book_date: -1, _id: -1 }).limit(WHOLE_SET_CAP + 1).toArray() as BookingDoc[];
  const bookingRows = bookings.slice(0, WHOLE_SET_CAP);
  const cancellations = await db().collection("cancelled_leads").find({ $and: [{ $or: [{ booked_lead: { $in: bookingRows.map(b => b._id) } }, { lead_ref: { $in: t.leads.map(l => l._id) } }] },
    { $or: [{ cancel_date: { $lte: asOf } }, { cancel_date: null, createdAt: { $lte: asOf } }] }] },
  { projection: CANCELLATION_PROJECTION }).sort({ cancel_date: -1, _id: -1 }).limit(WHOLE_SET_CAP + 1).toArray() as BookingDoc[];
  const cancellationRows = cancellations.slice(0, WHOLE_SET_CAP);
  const events = bookingEvents(subject, t.leads, bookingRows, cancellationRows);
  const bookingById = new Map(bookingRows.map(row => [String(row._id), row]));
  const cancellationById = new Map(cancellationRows.map(row => [String(row._id), row]));
  for (const e of events) {
    if (e.kind === "booking_recorded") {
      const row = bookingById.get(String(e.detail.booking_id));
      if (!row) continue;
      const allocations = Array.isArray(row.agent_allocations) ? row.agent_allocations as Array<{ agent_name_snapshot?: unknown }> : [];
      e.detail.agent_name = text(allocations[0]?.agent_name_snapshot, 80);
      if (!iso(row.book_date)) e.detail.book_date_missing = true;
    } else if (e.kind === "cancellation_recorded") {
      const row = cancellationById.get(String(e.detail.cancellation_id));
      if (row && !iso(row.cancel_date)) e.detail.cancel_date_missing = true;
    }
  }
  return whole(events, acceptor(subject, t), limit, bookingRows.length + cancellationRows.length,
    bookings.length > WHOLE_SET_CAP || cancellations.length > WHOLE_SET_CAP || subject.lead_refs.length > t.lead_refs.length);
}

/** `booking_recorded` by `lead_ref`/`job_no`, and `cancellation_recorded` by `booked_lead`/`lead_ref`. */
export const bookingSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineBookings(subject, limit, options.timeline);
  if (!subject.lead_refs.length) return empty();
  const leads = await readLeadRows(subject.lead_refs.slice(0, limit));
  const leadIds = leads.map(l => l._id);
  const bookings = await db().collection("booked_leads").find({ $or: bookingClauses(leads), book_date: dateWindow(subject) },
    { projection: BOOKING_PROJECTION })
    .sort({ book_date: -1 }).limit(limit + 1).toArray();
  const bookingPage = bounded(bookings as BookingDoc[], limit);
  const cancellations = await db().collection("cancelled_leads").find({ $or: [{ booked_lead: { $in: bookingPage.rows.map(b => b._id) } }, { lead_ref: { $in: leadIds } }], cancel_date: dateWindow(subject) },
    { projection: CANCELLATION_PROJECTION })
    .sort({ cancel_date: -1 }).limit(limit + 1).toArray();
  const cancellationPage = bounded(cancellations as BookingDoc[], limit);
  const events = bookingEvents(subject, leads, bookingPage.rows, cancellationPage.rows);
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: bookingPage.read + cancellationPage.read, truncated: bookingPage.truncated || cancellationPage.truncated };
};

type FollowupRow = Awaited<ReturnType<typeof readFollowupRows>>[number];
const readFollowupRows = (filter: Record<string, unknown>, sort: Record<string, 1 | -1>, limit: number) =>
  getOutreachFollowupModel().find(filter).sort(sort).limit(limit).lean();

/**
 * Follow-up lifecycle events, in row order. `transitionAt` (timeline mode) holds the audit time
 * of a cancel/supersede keyed `<followup id>:<status>`; without it `updatedAt` stands in.
 */
function followupEvents(rows: FollowupRow[], keyByRecord: Map<string, string>, subject: StorySubject, transitionAt?: Map<string, string>): StoryEvent[] {
  const events: StoryEvent[] = [];
  for (const row of rows) {
    const id = String(row._id), key = keyByRecord.get(String(row.outreach_record_id)) ?? numberKey(subject) ?? "number:unknown";
    const who = actor(followupActorKind(row.origin), null, row.promised_by_agent_id ? String(row.promised_by_agent_id) : null);
    const detail = { followup_id: id, outreach_record_id: String(row.outreach_record_id), kind: row.kind, description: text(row.description, 300), due_at: iso(row.due_at), date_text: text(row.date_text, 60),
      origin: row.origin, promised_by: row.promised_by_agent_id ? String(row.promised_by_agent_id) : null, source_finding_ids: (row.source_finding_ids ?? []).map(String),
      completion_basis: row.completion_basis ?? null, disposition: row.disposition ?? null, cancel_reason: text(row.cancel_reason, 200), status: row.status };
    const refs = [`followup:${id}`, ...(row.source_interaction_id ? [`interaction:${row.source_interaction_id}`] : []), ...(row.source_finding_ids ?? []).map(f => `finding:${f}`)];
    const created = iso((row as { createdAt?: Date }).createdAt);
    if (created) events.push(event({ kind: "followup_created", id, happened_at: created, observed_at: created, subject_key: key, actor: who, detail, evidence_refs: refs }));
    const updated = iso((row as { updatedAt?: Date }).updatedAt);
    if (row.status === "completed" && (iso(row.completed_at) ?? updated)) events.push(event({ kind: "followup_completed", id, happened_at: iso(row.completed_at) ?? updated!, observed_at: updated, subject_key: key,
      actor: row.completion_basis === "owner" ? actor("owner", null, text(row.completed_by, 60)) : row.completion_basis === "customer_confirmation" ? actor("customer") : row.completion_basis === "rep_confirmation" ? actor("rep") : actor("vantage"),
      detail, evidence_refs: [...refs, ...(row.evidence_interaction_id ? [`interaction:${row.evidence_interaction_id}`] : []), ...(row.completion_finding_id ? [`finding:${row.completion_finding_id}`] : [])] }));
    const cancelledAt = transitionAt?.get(`${id}:cancelled`) ?? updated;
    if (row.status === "cancelled" && cancelledAt) events.push(event({ kind: "followup_cancelled", id, happened_at: cancelledAt, observed_at: cancelledAt, subject_key: key, actor: actor("owner"), detail, evidence_refs: refs }));
    const supersededAt = transitionAt?.get(`${id}:superseded`) ?? updated;
    if (row.status === "superseded" && supersededAt) events.push(event({ kind: "followup_superseded", id, happened_at: supersededAt, observed_at: supersededAt, subject_key: key, actor: actor("intelligence"), detail, evidence_refs: refs }));
  }
  return events;
}

/**
 * Source 8, timeline mode: the whole bounded set (every event of a follow-up happens at or after
 * its `createdAt`, so `createdAt ≤ cursor` is a complete pre-filter). Reader fix: a cancel or a
 * supersede is timed by the first audit row that moved the follow-up into that status (one
 * batched read), falling back to `updatedAt` when no audit row exists.
 */
async function timelineFollowups(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  const ids = t.records.map(r => r._id);
  if (!ids.length) return empty();
  const keyByRecord = new Map(t.records.map(r => [String(r._id), subjectKey(r.subject as Parameters<typeof subjectKey>[0])]));
  const rows = await readFollowupRows({ outreach_record_id: { $in: ids }, createdAt: { $lte: upperBound(subject, t) } }, { createdAt: -1, _id: -1 }, FOLLOWUP_CAP + 1);
  const page = rows.slice(0, FOLLOWUP_CAP);
  const moved = page.filter(row => row.status === "cancelled" || row.status === "superseded").map(row => String(row._id));
  const transitionAt = new Map<string, string>();
  if (moved.length) {
    const audits = await getSalesIntelligenceAuditEventModel().find({ subject_key: { $in: t.subject_keys }, "invalidation.kind": "followup", "invalidation.target_id": { $in: moved },
      "current.status": { $in: ["cancelled", "superseded"] } }).select("invalidation.target_id current.status happened_at").sort({ happened_at: 1, _id: 1 }).limit(moved.length * 4).lean();
    for (const row of audits as unknown as Array<{ invalidation: { target_id: string }; current?: { status?: unknown }; happened_at: Date }>) {
      const key = `${row.invalidation.target_id}:${String(row.current?.status)}`;
      if (!transitionAt.has(key) && iso(row.happened_at)) transitionAt.set(key, iso(row.happened_at)!);
    }
  }
  return whole(followupEvents(page, keyByRecord, subject, transitionAt), acceptor(subject, t), limit, page.length, rows.length > FOLLOWUP_CAP);
}

/** Follow-up lifecycle from `outreach_followups`: created, completed, cancelled, superseded. */
export const followupSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineFollowups(subject, limit, options.timeline);
  const ids = subject.outreach_record_ids.filter(id => mongoose.isValidObjectId(id)).map(oid);
  if (!ids.length) return empty();
  const records = await readOutreachRecords(subject.outreach_record_ids);
  const keyByRecord = new Map(records.map(r => [String(r._id), subjectKey(r.subject as Parameters<typeof subjectKey>[0])]));
  const rows = await readFollowupRows({ outreach_record_id: { $in: ids }, createdAt: dateWindow(subject) }, { createdAt: -1 }, limit + 1);
  const page = bounded(rows, limit);
  return { events: followupEvents(page.rows, keyByRecord, subject).filter(withinAsOf(subject)).sort(byNewest), read: page.read, truncated: page.truncated };
};

type AuditRow = { _id: mongoose.Types.ObjectId; subject_key: string; event_kind: string; happened_at: Date; recorded_at: Date; prior?: unknown; current?: unknown;
  actor: { kind: string; id: string; run_id?: unknown }; invalidation: { kind: string; target_id: string } };
const pick = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);

/** Audit kinds the Owner timeline maps beyond the story catalog (data spec §5.2 source 9). */
const TIMELINE_AUDIT_KINDS: Readonly<Record<string, (typeof TIMELINE_ONLY_KINDS)[number]>> = {
  snooze_followup: "followup_snoozed", "intelligence.submitted": "analysis_submitted",
};
/** The story's exclusions, minus the submission row (kept as a routine event), plus per-call bookkeeping. */
export const TIMELINE_EXCLUDED_AUDIT_EVENT_KINDS: readonly string[] = [
  ...EXCLUDED_AUDIT_EVENT_KINDS.filter(kind => kind !== "intelligence.submitted"), "outreach_call_applied",
];

function auditEvent(row: AuditRow, timeline: boolean): StoryEvent | null {
  const kind = auditEventStoryKind(row.event_kind, row.invalidation?.kind) ?? (timeline ? (TIMELINE_AUDIT_KINDS[row.event_kind] as unknown as StoryEventKind | undefined) ?? null : null);
  if (!kind) return null;
  const current = row.current, prior = row.prior;
  const detail: Record<string, unknown> = { event_kind: row.event_kind, invalidation_kind: row.invalidation?.kind ?? null, target_id: row.invalidation?.target_id ?? null,
    actor: row.actor?.id ?? null, actor_kind: row.actor?.kind ?? null, run_id: row.actor?.run_id ? String(row.actor.run_id) : null,
    note: text(pick(current, "note"), 400), reason: text(pick(current, "reason") ?? pick(current, "closed_reason") ?? pick(current, "cancel_reason") ?? pick(current, "wait_reason"), 300),
    agent_id: pick(current, "responsible_agent_id") ? String(pick(current, "responsible_agent_id")) : null, agent_name: text(pick(current, "agent_name") ?? pick(current, "agent_name_snapshot"), 80),
    until: iso(pick(current, "until") ?? pick(current, "wait_until")), channels: Array.isArray(pick(current, "channels")) ? (pick(current, "channels") as unknown[]).map(String) : null,
    channel: text(pick(current, "channel"), 30), cause_kind: text(pick(current, "cause_kind"), 40), state: text(pick(current, "state"), 40), state_before: text(pick(prior, "state"), 40), closure_origin: text(pick(current, "closure_origin"), 30),
    prior: smallJson(prior), current: smallJson(current) };
  if (kind === "closed" && !detail.reason) detail.reason = text(pick(current, "closed_reason"), 300);
  if (kind === "call_ended") detail.note = text(pick(current, "call_progress.note") ?? pick(current, "note"), 300);
  if ((kind as string) === "followup_snoozed") detail.until = iso(pick(current, "snoozed_until")) ?? detail.until;
  return event({ kind, id: String(row._id), happened_at: row.happened_at.toISOString(), observed_at: iso(row.recorded_at), subject_key: row.subject_key,
    actor: actor(auditActorKind(row.actor?.kind), null, row.actor?.kind === "owner" ? text(row.actor.id, 60) : null),
    detail, evidence_refs: [`audit:${row._id}`, ...(row.invalidation?.target_id ? [`${row.invalidation.kind}:${row.invalidation.target_id}`] : [])] });
}

/** Source 9, timeline mode: keyset on `happened_at` over the subject keys resolved once (D5). */
async function timelineAudit(subject: StorySubject, limit: number, t: TimelineReadContext): Promise<SourceResult> {
  if (!t.subject_keys.length) return empty();
  const model = getSalesIntelligenceAuditEventModel();
  return keysetScan<AuditRow>({
    query: (window, batch) => model.find({ subject_key: { $in: t.subject_keys }, event_kind: { $nin: [...TIMELINE_EXCLUDED_AUDIT_EVENT_KINDS] }, ...window })
      .sort({ happened_at: -1, _id: -1 }).limit(batch).lean().exec() as unknown as Promise<AuditRow[]>,
    field: "happened_at", indexed: row => row.happened_at, toEvents: rows => rows.flatMap(row => auditEvent(row, true) ?? []),
    accept: acceptor(subject, t), limit, upper: upperBound(subject, t), aheadMs: 0 });
}

/** Owner actions and worker transitions from the append-only audit stream, mapped like `outreach/timeline.ts`. */
export const auditSource: StorySource = async (subject, limit, options) => {
  if (options?.timeline) return timelineAudit(subject, limit, options.timeline);
  const keys = await storySubjectKeys(subject);
  if (!keys.length) return empty();
  const rows = (await getSalesIntelligenceAuditEventModel().find({ subject_key: { $in: keys }, happened_at: dateWindow(subject), event_kind: { $nin: [...EXCLUDED_AUDIT_EVENT_KINDS] } })
    .sort({ happened_at: -1, _id: -1 }).limit(limit + 1).lean()) as unknown as AuditRow[];
  const page = bounded(rows, limit);
  const events: StoryEvent[] = [];
  for (const row of page.rows) { const e = auditEvent(row, false); if (e) events.push(e); }
  return { events, read: page.read, truncated: page.truncated };
};

type AssessmentRow = { _id: mongoose.Types.ObjectId; subject_key: string; scores?: unknown; engagement?: unknown; published_at?: Date | null; createdAt?: Date };
const readAssessmentRows = (keys: string[], subject: StorySubject, sort: Record<string, 1 | -1>, limit: number) =>
  getMoveAssessmentArtifactModel().find({ subject_key: { $in: keys }, status: "ready", shadow: false, purged_at: null, published_at: dateWindow(subject) })
    .select("subject_key scores engagement published_at createdAt").sort(sort).limit(limit).lean() as unknown as Promise<AssessmentRow[]>;

function assessmentEvents(rows: AssessmentRow[], records: readonly RecordRow[]): StoryEvent[] {
  const current = new Set(records.map(r => r.move_assessment?.artifact_id).filter(Boolean).map(String));
  const staleById = new Map(records.filter(r => r.move_assessment?.artifact_id).map(r => [String(r.move_assessment!.artifact_id), Boolean(r.move_assessment!.stale)]));
  return rows.flatMap(row => {
    const happened = iso(row.published_at) ?? iso(row.createdAt);
    if (!happened) return [];
    const id = String(row._id);
    const scores = row.scores as { transaction_intent?: { score?: unknown }; move_likelihood?: { score?: unknown } } | null;
    return [event({ kind: "assessment_published", id, happened_at: happened, observed_at: happened, subject_key: row.subject_key, actor: actor("intelligence"),
      detail: { artifact_id: id, transaction_intent: num(scores?.transaction_intent?.score), move_likelihood: num(scores?.move_likelihood?.score),
        work_status: text((row.engagement as { work_status?: unknown } | null)?.work_status, 40), stale: current.has(id) ? staleById.get(id) ?? false : current.size > 0 },
      evidence_refs: [`assessment:${id}`] })];
  });
}

/** Published, non-shadow Move assessments for every subject key in scope. */
export const assessmentSource: StorySource = async (subject, limit, options) => {
  const t = options?.timeline;
  if (t) {
    // Source 5, timeline mode: `published_at` is not the indexed field, so the whole bounded set is read and ordered in memory.
    if (!t.subject_keys.length) return empty();
    const rows = await readAssessmentRows(t.subject_keys, subject, { createdAt: -1, _id: -1 }, WHOLE_SET_CAP + 1);
    const page = rows.slice(0, WHOLE_SET_CAP);
    return whole(assessmentEvents(page, t.records), acceptor(subject, t), limit, page.length, rows.length > WHOLE_SET_CAP);
  }
  const [keys, records] = await Promise.all([storySubjectKeys(subject), readOutreachRecords(subject.outreach_record_ids)]);
  if (!keys.length) return empty();
  const rows = await readAssessmentRows(keys, subject, { createdAt: -1 }, limit + 1);
  const page = bounded(rows, limit);
  return { events: assessmentEvents(page.rows, records).filter(withinAsOf(subject)), read: page.read, truncated: page.truncated };
};

type CorrectionRow = Awaited<ReturnType<typeof readCorrectionRows>>[number];
const readCorrectionRows = (keys: string[], upper: Date, sort: Record<string, 1 | -1>, limit: number) =>
  getSalesIntelligenceOwnerInstructionModel().find({ subject_key: { $in: keys }, state: "active", happened_at: { $lte: upper } }).sort(sort).limit(limit).lean();
const correctionEvent = (row: CorrectionRow): StoryEvent => event({ kind: "owner_correction", id: `${row.instruction_id}:${row.revision}`, happened_at: row.happened_at.toISOString(), observed_at: row.happened_at.toISOString(),
  subject_key: row.subject_key, actor: actor("owner", null, text(row.actor?.id, 60)),
  detail: { instruction_id: String(row.instruction_id), revision: row.revision, field: row.field, current: smallJson(row.current, 600), prior: smallJson(row.prior, 600),
    followup_id: row.followup_id ? String(row.followup_id) : null, finding_id: row.finding_id ? String(row.finding_id) : null },
  evidence_refs: [`instruction:${row.instruction_id}`] });

/** Active Owner instructions (corrections) on any subject key in scope. */
export const correctionSource: StorySource = async (subject, limit, options) => {
  const t = options?.timeline;
  if (t) {
    if (!t.subject_keys.length) return empty();
    const rows = await readCorrectionRows(t.subject_keys, upperBound(subject, t), { happened_at: -1, _id: -1 }, CORRECTION_CAP + 1);
    const page = rows.slice(0, CORRECTION_CAP);
    return whole(page.map(correctionEvent), acceptor(subject, t), limit, page.length, rows.length > CORRECTION_CAP);
  }
  const keys = await storySubjectKeys(subject);
  if (!keys.length) return empty();
  const rows = await readCorrectionRows(keys, subject.as_of, { happened_at: -1 }, limit + 1);
  const page = bounded(rows, limit);
  const events = page.rows.map(correctionEvent);
  return { events, read: page.read, truncated: page.truncated };
};

/** Every reader, keyed by its coverage name. */
export const STORY_SOURCES: Readonly<Record<string, StorySource>> = {
  lead_received: leadReceivedSource, lead_messages: leadMessageSource, calls: callSource, conversations: conversationSource, attachments: attachmentSource,
  granot_changes: granotChangeSource, granot_observed: granotObservedSource, bookings: bookingSource, followups: followupSource, audit: auditSource,
  assessments: assessmentSource, corrections: correctionSource,
};

/** Which reader emits each timeline kind, so a `kinds[]` filter runs only the readers it needs. */
export const TIMELINE_SOURCE_BY_KIND: Readonly<Record<string, keyof typeof STORY_SOURCES & string>> = {
  lead_received: "lead_received", call_qualified: "lead_received", call: "calls", conversation_analyzed: "conversations", conversation_recorded: "conversations",
  assessment_published: "assessments", granot_priority_changed: "granot_changes", quoted_changed: "granot_changes", receiver_agent_changed: "granot_changes", granot_observed: "granot_observed",
  number_attached: "attachments", followup_created: "followups", followup_completed: "followups", followup_cancelled: "followups", followup_superseded: "followups",
  assigned: "audit", owner_note: "audit", closed: "audit", reopened: "audit", waiting_set: "audit", review_opened: "audit", review_resolved: "audit",
  restriction_set: "audit", restriction_resolved: "audit", nudge_sent: "audit", followup_snoozed: "audit", call_started: "audit", call_ended: "audit",
  analysis_submitted: "audit", owner_correction: "corrections", booking_recorded: "bookings", cancellation_recorded: "bookings", lead_message_sent: "lead_messages",
};

/** The Contact Number fields the story needs; null when purged or missing. */
export async function readStoryContactNumber(id: string): Promise<{ e164: string; provider_names: string[] } | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const row = await getContactNumberModel().findOne({ _id: oid(id), purged_at: null }).select("e164 provider_names").lean();
  return row ? { e164: row.e164, provider_names: [...(row.provider_names ?? [])] } : null;
}
